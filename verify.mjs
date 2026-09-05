#!/usr/bin/env node
/**
 * Consistency check for the CV site.
 *
 * index.html and cv_print.html are each standalone single files with no imports —
 * that is what lets them open from disk with no server and no network. The cost is
 * that the sea service record exists in both, and nothing in the browser can keep
 * the two honest. This script does.
 *
 *   node verify.mjs
 *
 * Exits non-zero on any failure, so it works as a pre-commit hook.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = 'index.html';
const PRINT = 'cv_print.html';
const PDF = 'ADLAWAN_RICHARD_CV.pdf';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const failures = [];
const notes = [];
/* A third outcome, between "fine" and "stop". Some things are worth saying out loud
   without failing the run -- a PDF a couple of days old is still an accurate CV, and a
   check that exits non-zero over it is one people learn to skip with --no-verify. Warnings
   print in their own block and never touch the exit code. */
const warnings = [];

function fail(msg){ failures.push(msg); }
function ok(msg){ notes.push(msg); }
function warn(msg){ warnings.push(msg); }

/* ---------- sea service ---------- */

function extractService(src, file){
  const block = src.match(/const SERVICE = \[([\s\S]*?)\n\];/);
  if (!block) { fail(`${file}: could not find the SERVICE array`); return null; }
  const rows = block[1].match(/\{[^}]*\}/g) || [];
  return rows.map(row => {
    const str = k => (row.match(new RegExp(k + ":\\s*'([^']*)'")) || [])[1] ?? null;
    const nullable = k => {
      const m = row.match(new RegExp(k + ":\\s*(?:'([^']*)'|null)"));
      return m ? (m[1] ?? null) : undefined;
    };
    return {
      vessel: str('vessel'),
      type: str('type'),
      rank: str('rank'),
      from: str('from'),
      to: nullable('to'),
      /* `note` was outside this diff and had already drifted -- the site said "Contract to
         Oct 2026" while the print CV said "to Oct 2026". It is the availability signal, so
         it is worth as much as the dates. */
      note: nullable('note')
    };
  });
}

const siteSrc = read(SITE);
const printSrc = read(PRINT);

const a = extractService(siteSrc, SITE);
const b = extractService(printSrc, PRINT);

if (a && b){
  if (a.length !== b.length){
    fail(`sea service row count differs: ${SITE} has ${a.length}, ${PRINT} has ${b.length}`);
  } else {
    let drift = 0;
    a.forEach((row, i) => {
      const other = b[i];
      for (const k of Object.keys(row)){
        if (row[k] !== other[k]){
          fail(`sea service row ${i + 1} (${row.vessel}) differs on "${k}": ` +
               `${SITE}=${JSON.stringify(row[k])} vs ${PRINT}=${JSON.stringify(other[k])}`);
          drift++;
        }
      }
    });
    if (!drift) ok(`sea service: ${a.length} contracts, identical in both files`);
  }

  /* An open contract must be the newest one, or the "Present" row renders mid-list. */
  const openIdx = a.findIndex(r => r.to === null);
  if (openIdx > 0) fail(`the open contract (${a[openIdx].vessel}) is not first; list must be newest-first`);

  /* There were three checks here policing a stored `dur` string per row — that a closed
     contract had one, that an open one did not, and that it was formatted sanely. They
     could not check the only thing that mattered, which is whether the string agreed with
     the dates on the same row; all six had quietly drifted a couple of days high. The
     field is gone and both pages derive the duration with fmtMD(spanDays(c)), so there is
     no second copy left to disagree. Do not reintroduce it. */
}

/* ---------- vessel particulars ---------- */

/* Same duplication problem as SERVICE, and the same reason it needs checking here: the
   particulars are the part a recruiter verifies against a registry, so the two files
   disagreeing about an IMO number is worse than them disagreeing about a date. */

const VESSEL_FIELDS = ['imo', 'built', 'size', 'dims', 'flag'];

function extractVessels(src, file){
  const block = src.match(/const VESSELS = \{([\s\S]*?)\n\};/);
  if (!block) { fail(`${file}: could not find the VESSELS table`); return null; }
  const out = {};
  for (const row of block[1].match(/'([^']+)':\s*\{[^}]*\}/g) || []){
    const name = row.match(/^'([^']+)'/)[1];
    const rec = {};
    for (const k of VESSEL_FIELDS){
      rec[k] = (row.match(new RegExp(k + ":\\s*'([^']*)'")) || [])[1] ?? null;
    }
    out[name] = rec;
  }
  return out;
}

const va = extractVessels(siteSrc, SITE);
const vb = extractVessels(printSrc, PRINT);

if (va && vb){
  const names = [...new Set([...Object.keys(va), ...Object.keys(vb)])];
  let drift = 0;
  for (const name of names){
    if (!va[name] || !vb[name]){
      fail(`vessel particulars for "${name}" exist only in ${va[name] ? SITE : PRINT}`);
      drift++;
      continue;
    }
    for (const k of VESSEL_FIELDS){
      if (va[name][k] !== vb[name][k]){
        fail(`vessel particulars for "${name}" differ on "${k}": ` +
             `${SITE}=${JSON.stringify(va[name][k])} vs ${PRINT}=${JSON.stringify(vb[name][k])}`);
        drift++;
      }
      /* A blank field renders as a gap mid-sentence — "IMO 9431812 · Built ·  · Liberia". */
      if (!va[name][k]) { fail(`vessel particulars for "${name}" are missing "${k}"`); drift++; }
    }
  }

  if (a){
    /* Every ship in the record must state itself, and nothing may state a ship that is
       no longer in the record. */
    const sailed = new Set(a.map(r => r.vessel));
    for (const v of sailed){
      if (!va[v]) { fail(`${v} appears in the sea service but has no vessel particulars`); drift++; }
    }
    for (const v of Object.keys(va)){
      if (!sailed.has(v)) { fail(`vessel particulars list ${v}, which is not in the sea service`); drift++; }
    }
    if (!drift) ok(`vessel particulars: ${names.length} ships, identical in both files`);
  }
}

/* ---------- static register mirror ---------- */

/* #timeline used to be an empty div filled in by JS, which meant the most important
   section on the page rendered as nothing at all wherever scripts were blocked. It now
   ships as static markup. That buys a second copy of the record inside the same file, so
   it gets the same treatment every other duplicate here gets: checked, not trusted.

   Note what is deliberately NOT mirrored — the duration. A stored duration is what let
   all six rows drift from their own dates in the first place, so the markup carries only
   data-from/data-to and the span is derived at render time. This check enforces that too:
   a duration written into the markup is a failure, not a convenience. */

function extractMirror(src){
  const host = src.match(/<div class="timeline" id="timeline">([\s\S]*?)\n        <\/div>/);
  if (!host) { fail(`${SITE}: could not find the #timeline register`); return null; }
  const out = [];
  for (const group of host[1].match(/<article class="vgroup">[\s\S]*?<\/article>/g) || []){
    const g = re => (group.match(re) || [])[1] ?? null;
    const vessel = g(/class="vessel">([^<]*)</);
    const type   = g(/class="flagtype">([^<]*)</);
    const specs  = g(/class="svc-specs">([^<]*)</);
    for (const row of group.match(/<li class="svc[\s\S]*?<\/li>/g) || []){
      const pick = re => (row.match(re) || [])[1] ?? null;
      out.push({
        vessel, type, specs,
        rank: pick(/class="rank-chip">([^<]*)</),
        from: pick(/data-from="([^"]*)"/),
        to:   pick(/data-to="([^"]*)"/),
        note: pick(/class="svc-note">([^<]*)</),
        live: /<li class="svc[^"]*\blive\b/.test(row),
        storedDur: (row.match(/class="dur-badge[^"]*">\s*([^<\s][^<]*)</) || [])[1] ?? null
      });
    }
  }
  return out;
}

const mirror = extractMirror(siteSrc);

if (mirror && a){
  /* The SERVICE array keeps `note`; extractService drops it, so re-read it here. */
  const notes = (siteSrc.match(/const SERVICE = \[([\s\S]*?)\n\];/)[1].match(/\{[^}]*\}/g) || [])
    .map(r => (r.match(/note:\s*'([^']*)'/) || [])[1] ?? null);

  if (mirror.length !== a.length){
    fail(`register mirror has ${mirror.length} rows but SERVICE has ${a.length}`);
  } else {
    let drift = 0;
    mirror.forEach((m, i) => {
      const c = a[i];
      for (const k of ['vessel','type','rank','from']){
        if (m[k] !== c[k]){
          fail(`register mirror row ${i + 1} (${c.vessel}) differs on "${k}": ` +
               `markup=${JSON.stringify(m[k])} vs SERVICE=${JSON.stringify(c[k])}`);
          drift++;
        }
      }
      if ((m.to ?? null) !== (c.to ?? null)){
        fail(`register mirror row ${i + 1} (${c.vessel}) differs on "to": ` +
             `markup=${JSON.stringify(m.to)} vs SERVICE=${JSON.stringify(c.to)}`);
        drift++;
      }
      if ((m.note ?? null) !== (notes[i] ?? null)){
        fail(`register mirror row ${i + 1} (${c.vessel}) differs on "note": ` +
             `markup=${JSON.stringify(m.note)} vs SERVICE=${JSON.stringify(notes[i])}`);
        drift++;
      }
      /* The open contract carries the accent rule and reads "Present"; the class is what
         drives both, so a mismatch here shows the wrong contract as current. */
      if (m.live !== (c.to === null)){
        fail(`register mirror row ${i + 1} (${c.vessel}) is ${m.live ? '' : 'not '}marked live, ` +
             `but its contract is ${c.to === null ? 'open' : 'closed'}`);
        drift++;
      }
      if (m.storedDur){
        fail(`register mirror row ${i + 1} (${c.vessel}) has a duration written into the ` +
             `markup ("${m.storedDur}") — durations are derived from the dates, never stored`);
        drift++;
      }
      /* Particulars are the part a recruiter checks against a registry. */
      if (m.specs){
        const v = va && va[m.vessel];
        if (v){
          const want = `IMO ${v.imo} &middot; Built ${v.built} &middot; ${v.size} ` +
                       `&middot; ${v.dims} &middot; ${v.flag} flag`;
          if (m.specs !== want){
            fail(`register mirror row ${i + 1} (${c.vessel}) particulars differ from VESSELS:\n` +
                 `       markup: ${m.specs}\n       VESSELS: ${want}`);
            drift++;
          }
        }
      }
    });
    if (!drift) ok(`register mirror: ${mirror.length} static rows match SERVICE and VESSELS`);
  }
}

/* ---------- the seatime claim ---------- */

const claimRe = /(\d+(?:\.\d+)?)\+ years&rsquo; officer watchkeeping/;
const siteClaim = (siteSrc.match(claimRe) || [])[1];
const printClaim = (printSrc.match(claimRe) || [])[1];

if (!siteClaim || !printClaim){
  fail('could not find the "N+ years\' officer watchkeeping" claim in both files');
} else if (siteClaim !== printClaim){
  fail(`seatime claim differs: ${SITE} says ${siteClaim}+ years, ${PRINT} says ${printClaim}+ years`);
} else {
  /* The claim must still be true against the live computation. */
  const MS = 86400000, MONTH = 30.4375;
  const total = a.reduce((sum, r) => {
    const from = Date.parse(r.from + 'T00:00:00Z');
    const to = r.to ? Date.parse(r.to + 'T00:00:00Z') : Date.now();
    return sum + Math.round((to - from) / MS) + 1;
  }, 0);
  const years = total / MONTH / 12;
  if (years < Number(siteClaim)){
    fail(`the page claims ${siteClaim}+ years but the data computes ${years.toFixed(2)} years`);
  } else {
    ok(`seatime claim: "${siteClaim}+ years" holds — data computes ${years.toFixed(2)} years`);
  }
}

/* ---------- things that must never appear ---------- */

/* The MISMO (MARINA) account is the source for the credentials on these pages, and syncing
   against it means that record sits open in a browser beside these files. Everything below
   is a field on that same page that must never be pasted across.

   The SRN is the deliberate exception — it is published as the verification handle for the
   certificates, so it gets no rule. Note the birth-date rule matches a formatted date only
   (12/14/1987); it must not match the bare digits inside the SRN, whose first six encode
   the same date. */
const banned = [
  [/\bUS\s+visa\b/i, 'US visa (not valid — must never be listed)'],
  [/\btel:/i, 'a telephone link'],
  [/\bphone\b/i, 'a phone number'],
  [/@(?:gmail|yahoo|outlook|hotmail)\./i, 'a personal email address'],
  [/\bEC\d{7}\b/, 'a passport number'],
  [/\b\d{2}\/\d{2}\/(?:19|20)\d{2}\b/, 'a formatted birth date'],
  [/\bSOFIA\s+LOUISSE\b/i, "the emergency contact's name (a third party)"],
  [/\bCASA\s+MIRA\b/i, 'a home address'],
  [/\bUPPER\s+PAKIGNE\b/i, 'a home address'],
  /* Name plus a live certificate number is the raw material for impersonation and for
     fraudulent verification lookups. Titles, issuer and dates only. */
  /* The separator class is not decoration: real MISMO numbers are written with a space
     or a hyphen as often as not, and `MECA 123456789` / `MECA-123456789` both walked past
     the glued-together version of this pattern when they were injected and re-run. */
  [/\b(?:CCM|COICNW|GOC|BTB|SCRB|PSCRB|AFF|SSO|MECA)[\s\-‐-―._]?\d{9,}\b/,
   'a certificate number']
];
/* Scanned on the decoded text as well as the raw. `me&#64;gmail.com` renders as an
   ordinary address and walked straight past the raw-source patterns when it was injected
   and re-run; so did `&commat;`. A privacy guard that only catches the unencoded form
   catches the careful mistake and misses the copy-pasted one. */
function decodeEntities(t){
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&commat;/gi, '@').replace(/&period;/gi, '.')
    .replace(/&plus;/gi, '+').replace(/&lpar;/gi, '(').replace(/&rpar;/gi, ')')
    .replace(/&sol;/gi, '/').replace(/&amp;/gi, '&');
}

for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
  const decoded = decodeEntities(src);
  for (const [re, what] of banned){
    if (re.test(src)) fail(`${file} contains ${what}`);
    else if (re.test(decoded)) fail(`${file} contains ${what}, written as HTML entities`);
  }
}

/* The apps are published too, and for a while nothing checked them. A contact watermark
   carrying a personal email and mobile number shipped inside the draft survey app and sat
   live, while this script reported all clear — it only ever read the two CV pages.
   Anything served is in scope now.

   The word-"phone" rule is dropped for the apps: they legitimately discuss phones in UI
   copy, and a false positive there teaches people to ignore the check. The patterns that
   match actual contact details still apply. */
const appBanned = [
  [/@(?:gmail|yahoo|outlook|hotmail)\./i, 'a personal email address'],
  [/\btel:/i, 'a telephone link'],
  [/\+\d{1,3}[\s-]?\d{7,12}\b/, 'what looks like a phone number']
];
for (const dir of readdirSync(new URL('apps/', import.meta.url), { withFileTypes: true })){
  if (!dir.isDirectory()) continue;
  const rel = `apps/${dir.name}/index.html`;
  let src;
  try { src = read(rel); } catch { fail(`${rel} is missing`); continue; }
  let clean = true;
  const decodedApp = decodeEntities(src);
  for (const [re, what] of appBanned){
    const hit = src.match(re) || decodedApp.match(re);
    /* The value itself is never echoed -- this output is read in terminals, pasted into
       issues and scrolled past by other people. Naming the file and the kind of detail is
       enough to go and look. */
    if (hit){ fail(`${rel} contains ${what}`); clean = false; }
  }
  if (clean) ok(`${rel}: no contact details`);
}

/* ---------- the PDF goes stale on its own ---------- */

/* The PDF is a frozen snapshot of numbers the two pages compute live. While a contract
   is open, its duration and every seatime total grow by a day, every day -- so a PDF
   that was correct when it was exported quietly stops matching the site. Nothing in the
   browser can notice that, and a recruiter reads the PDF, not the site.

   This used to compare mtimes. It cannot: git does not preserve mtimes, so on any fresh
   clone both files carry the checkout time and whichever landed first is declared "older"
   -- this script failed on a clean clone for that reason, 32ms apart -- while `touch`ing a
   genuinely stale PDF made it pass. It was testing the filesystem, not the document.

   A PDF states when it was made, inside itself, in its Info dictionary. Git cannot destroy
   that, a copy cannot fake it, and it is the exact moment the figures were frozen. */

function pdfCreationDate(buf){
  /* D:YYYYMMDDHHmmSS+HH'mm'  (PDF 32000-1, 7.9.4). The offset is what makes this the
     author's local calendar day, which is the clock the page's own figures were frozen
     against -- both pages derive "today" from the local date. */
  const m = buf.toString('latin1').match(/\/CreationDate\s*\(\s*D:(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?(?:([+-Z])(\d{2})'?(\d{2})?)?/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mi = '00', ss = '00', sign, oh = '00', om = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss);
  if (sign === '+') t -= (+oh * 60 + +om) * 60000;
  else if (sign === '-') t += (+oh * 60 + +om) * 60000;
  /* Local calendar day at the point of export. */
  return { exportedDay: Date.UTC(+y, +mo - 1, +d) / 86400000, iso: `${y}-${mo}-${d}`, ms: t };
}

{
  let buf = null;
  try { buf = readFileSync(new URL(PDF, import.meta.url)); }
  catch { fail(`${PDF} is missing -- regenerate it from ${PRINT} (see README)`); }

  if (buf){
    const made = pdfCreationDate(buf);
    if (!made){
      fail(`${PDF} carries no /CreationDate, so there is no way to tell whether it is stale ` +
           `-- re-export it with a real PDF writer (see README)`);
    } else {
      const localDay = dt => Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000;
      const daysOld = localDay(new Date()) - made.exportedDay;

      if (daysOld < 0){
        fail(`${PDF} claims it was exported on ${made.iso}, which is in the future -- check the clock`);
      } else if (a && a.some(r => r.to === null) && daysOld > 0){
        /* While a contract is open the PDF drifts by a day, every day. Failing on day one
           is technically right and practically useless: it would go red every morning, and
           a check that is always red stops being read. A CV one day out is accurate; a CV
           a week out understates the record by a week, which is the point at which a
           recruiter is reading something wrong.

           Thresholds, not a slope, so the policy is legible and testable. */
        const PDF_WARN_DAYS = 3;
        const PDF_FAIL_DAYS = 7;
        const drift = `its durations and totals understate the record by ${daysOld} day(s)`;
        if (daysOld >= PDF_FAIL_DAYS){
          fail(`${PDF} was exported ${daysOld} days ago (${made.iso}) and a contract is ` +
               `still open, so ${drift} -- regenerate it (see README)`);
        } else if (daysOld >= PDF_WARN_DAYS){
          warn(`${PDF} was exported ${daysOld} days ago (${made.iso}) and a contract is ` +
               `still open, so ${drift}. Not failing yet, but regenerate it before you ` +
               `send this CV to anyone.`);
        } else {
          ok(`${PDF} exported ${made.iso}, ${daysOld} day(s) ago -- within tolerance ` +
             `(warns at ${PDF_WARN_DAYS}, fails at ${PDF_FAIL_DAYS})`);
        }
      } else if (daysOld > 0){
        /* No open contract: the figures are fixed, so age alone is harmless. What is not
           harmless is the source page having changed since. git is the only record of that
           which survives a clone; if it is unavailable the check says so rather than
           quietly passing. */
        let edited = null;
        try {
          edited = execFileSync('git', ['log', '-1', '--format=%cI', '--', PRINT],
                                { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim();
        } catch { /* not a checkout, or no git */ }
        if (!edited){
          ok(`${PDF} exported ${made.iso}; no open contract, and ${PRINT}'s history is ` +
             `unavailable here, so its age could not be checked against it`);
        } else if (Date.parse(edited) > made.ms){
          fail(`${PRINT} was last changed ${edited.slice(0,10)} but ${PDF} was exported ` +
               `${made.iso} -- regenerate the PDF (see README)`);
        } else {
          ok(`${PDF} exported ${made.iso}, after the last change to ${PRINT}; no open contract`);
        }
      } else {
        ok(`${PDF} is current (exported today, ${made.iso})`);
      }
    }
  }
}

/* ---------- offline guarantee ---------- */

/* What this is really guarding is resources the browser fetches on its own to paint the
   page -- stylesheets, scripts, fonts, images. rel="canonical"/"alternate" and <a href>
   carry absolute URLs but are declarative: nothing is requested until a reader clicks, and
   the page renders identically with no network. Those are dropped before scanning.

   The old version matched only  (src|href)="http(s)://" , which let six regressions
   through when they were injected and re-run -- among them the one that matters most:

     @font-face{ src:url(https://fonts.gstatic.com/...) }

   Both pages embed their typefaces as src:url(data:font/woff2;base64,...). Swapping one
   for a Google Fonts URL is the single most plausible future edit, it looks perfect on a
   laptop, and it takes the page bare-faced on a ship with no signal. CSS url() was
   invisible here. So were @import, srcset, unquoted attributes and protocol-relative
   //host URLs. All are covered below. */

const REMOTE = '(?:https?:)?//';

for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
  const scanned = src
    .replace(/<link\b[^>]*\brel\s*=\s*["'](?:canonical|alternate)["'][^>]*>/gi, '')
    .replace(/<a\b[^>]*>/gi, '')
    /* ld+json and the og:/twitter: tags state URLs as data, not as things to fetch. */
    .replace(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][\s\S]*?<\/script>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '');

  const hits = [];
  const add = (what, m) => { if (m) for (const h of m) hits.push(`${what}: ${h.slice(0, 70)}`); };

  /* Fetched attributes, quoted or bare. srcset and poster were both unguarded. */
  add('attribute', scanned.match(new RegExp(
    `(?:src|href|srcset|poster|data|formaction|action)\\s*=\\s*(?:["']\\s*)?${REMOTE}[^"'\\s>]+`, 'gi')));
  /* Anything CSS pulls in itself -- fonts, backgrounds, masks, cursors. */
  add('css url()', scanned.match(new RegExp(`url\\(\\s*["']?${REMOTE}[^)"']+`, 'gi')));
  add('css @import', scanned.match(new RegExp(`@import\\s+(?:url\\(\\s*)?["']?${REMOTE}[^)"';]+`, 'gi')));
  /* A remote font declared the long way round. */
  add('@font-face src', scanned.match(new RegExp(`src\\s*:\\s*[^;}]*${REMOTE}[^;}]*`, 'gi')));

  const uniq = [...new Set(hits)];
  if (uniq.length){
    fail(`${file} loads ${uniq.length} remote resource(s) -- breaks offline use:\n       ` +
         uniq.join('\n       '));
  } else {
    ok(`${file}: no remote resources -- opens with no network`);
  }
}

/* ---------- the tools list ---------- */

/* Two of the five linked, shipped apps -- Draft Survey and Ballast Voyage Planner -- were
   missing from the print CV and nothing noticed, so the PDF a recruiter files advertised
   less than the site did. */

function extractTools(src, re){
  return (src.match(re) || []).map(m => m.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&')
    .replace(/&ldquo;|&rdquo;/g,'"').replace(/&nbsp;/g,' ').trim());
}
const toolsSite  = extractTools(siteSrc,  /<h3>[^<]*<\/h3>/g);
const toolsPrint = extractTools(printSrc, /<li><b>[^<]*<\/b>/g);

if (toolsSite.length && toolsPrint.length){
  /* The site's <h3>s include the competency run-in headings, so compare only the ones the
     print CV also claims to list: every tool named in print must exist on the site, and
     every tool card on the site must be in print. */
  const cards = extractTools(
    (siteSrc.match(/<div class="tools-grid">[\s\S]*?<\/div>\s*<p class="tech-line/) || [''])[0],
    /<h3>[^<]*<\/h3>/g);
  let drift = 0;
  for (const t of cards){
    if (!toolsPrint.includes(t)){ fail(`tool "${t}" is on the site but missing from ${PRINT}`); drift++; }
  }
  for (const t of toolsPrint){
    if (!cards.includes(t)){ fail(`tool "${t}" is in ${PRINT} but not on the site`); drift++; }
  }
  if (!drift) ok(`tools: ${cards.length} projects, identical in both files`);
}

/* ---------- the hero sentence restates the record ---------- */

/* The line "Sails as 2nd Officer on MV FG Eucalyptus - a 50,011 DWT Supramax bulk carrier
   under the Singapore flag" is a hand-typed join of SERVICE[0] and VESSELS[...]. Nothing
   checked it, so signing the next contract would leave it quietly wrong while every other
   rendering of the same facts updated itself. */

if (a && a.length && va){
  const lede = (siteSrc.match(/<p class="lede rise">([\s\S]*?)<\/p>/) || [])[1];
  if (!lede){
    fail(`${SITE}: could not find the hero sentence`);
  } else {
    const txt = lede.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&mdash;/g,'—');
    const cur = a[0], v = va[cur.vessel];
    let drift = 0;
    const want = [
      [cur.vessel.replace(/\b(\w)(\w*)/g, (_,x,y) => x + y.toLowerCase()), 'the current vessel'],
      [cur.rank, 'the current rank'],
      [v && v.size.split(' /')[0], 'the current vessel’s tonnage'],
      [v && v.flag, 'the current vessel’s flag']
    ];
    for (const [needle, what] of want){
      if (needle && !txt.toLowerCase().includes(String(needle).toLowerCase())){
        fail(`the hero sentence does not state ${what} ("${needle}") — it has drifted from the record`);
        drift++;
      }
    }
    if (!drift) ok('hero sentence: vessel, rank, tonnage and flag all match the record');
  }
}

/* ---------- the print CV mirrors the register too ---------- */

/* cv_print.html built its whole Sea Service table with innerHTML, so with scripts off it
   rendered an empty <tbody>, a blank particulars line and three em-dashes where the
   seatime totals go -- measured, not guessed. index.html was fixed for exactly this and
   got the mirror check above; the page that becomes the PDF a recruiter files never was.
   The rows are static now, which buys a third copy of the record, so it gets the same
   treatment as every other copy here: checked, not trusted. */

function extractPrintRows(src){
  const host = src.match(/<tbody id="svcBody">([\s\S]*?)<\/tbody>/);
  if (!host) { fail(`${PRINT}: could not find the #svcBody register`); return null; }
  return (host[1].match(/<tr[\s\S]*?<\/tr>/g) || []).map(row => {
    const pick = re => (row.match(re) || [])[1] ?? null;
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])
      .map(c => c.replace(/<[^>]*>/g, '').replace(/&ndash;/g, '–').replace(/&middot;/g, '·').trim());
    return {
      from: pick(/data-from="([^"]*)"/),
      to:   pick(/data-to="([^"]*)"/),
      vessel: cells[0] ?? null,
      type:   cells[1] ?? null,
      rank:   cells[2] ?? null,
      period: cells[3] ?? null,
      storedDur: cells[4] || null
    };
  });
}

const prows = extractPrintRows(printSrc);

if (prows && b){
  const pnotes = (printSrc.match(/const SERVICE = \[([\s\S]*?)\n\];/)[1].match(/\{[^}]*\}/g) || [])
    .map(r => (r.match(/note:\s*'([^']*)'/) || [])[1] ?? null);

  if (prows.length !== b.length){
    fail(`${PRINT} register has ${prows.length} static rows but its SERVICE has ${b.length}`);
  } else {
    let drift = 0;
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const human = d => { const [y,m,dd] = d.split('-'); return `${dd} ${MON[+m-1]} ${y}`; };
    prows.forEach((m, i) => {
      const c = b[i];
      for (const k of ['vessel','type','rank','from']){
        if (m[k] !== c[k]){
          fail(`${PRINT} register row ${i + 1} (${c.vessel}) differs on "${k}": ` +
               `markup=${JSON.stringify(m[k])} vs SERVICE=${JSON.stringify(c[k])}`);
          drift++;
        }
      }
      if ((m.to ?? null) !== (c.to ?? null)){
        fail(`${PRINT} register row ${i + 1} (${c.vessel}) differs on "to": ` +
             `markup=${JSON.stringify(m.to)} vs SERVICE=${JSON.stringify(c.to)}`);
        drift++;
      }
      /* The period cell is hand-written text; it must restate the row's own dates and the
         note, or the printed CV says something the data does not. */
      const want = human(c.from) + ' – ' + (c.to ? human(c.to) : 'present') +
                   (pnotes[i] ? ' · ' + pnotes[i] : '');
      if (m.period !== want){
        fail(`${PRINT} register row ${i + 1} (${c.vessel}) period cell reads\n` +
             `       "${m.period}"\n       but its dates imply "${want}"`);
        drift++;
      }
      /* Same rule as the site: a duration in the markup is the bug, not a convenience. */
      if (m.storedDur){
        fail(`${PRINT} register row ${i + 1} (${c.vessel}) has a duration written into the ` +
             `markup ("${m.storedDur}") — durations are derived from the dates, never stored`);
        drift++;
      }
    });
    if (!drift) ok(`${PRINT} register: ${prows.length} static rows match its SERVICE`);
  }

  /* The particulars line is static too, and states the same IMO numbers a recruiter checks. */
  const vpar = (printSrc.match(/<p class="vparticulars" id="vparticulars">([\s\S]*?)<\/p>/) || [])[1];
  if (!vpar){
    fail(`${PRINT}: could not find the vessel particulars line`);
  } else if (vb){
    let drift = 0;
    for (const name of Object.keys(vb)){
      const v = vb[name];
      const want = `${name}: IMO ${v.imo}, built ${v.built}, ${v.size}, ${v.dims}, ${v.flag} flag.`;
      if (!vpar.includes(want)){
        fail(`${PRINT} particulars line does not state ${name} as its VESSELS entry implies:\n` +
             `       expected: ${want}`);
        drift++;
      }
    }
    if (!drift) ok(`${PRINT} particulars: ${Object.keys(vb).length} ships match VESSELS`);
  }
}

/* ---------- the certificates ---------- */

/* The credentials are stated three times: the ld+json a search engine reads, the visible
   register with its serials, and the print CV. They are what a recruiter actually checks
   against MARINA, which makes them worth more than the dates -- and until now nothing
   compared them. They agreed; that was luck, and luck is not a check. */

function extractLdCerts(src){
  const blk = src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!blk) { fail(`${SITE}: could not find the structured-data block`); return null; }
  let data;
  try { data = JSON.parse(blk[1]); }
  catch (e){ fail(`${SITE}: the ld+json block is not valid JSON (${e.message})`); return null; }
  const creds = data.hasCredential || [];
  if (!creds.length){ fail(`${SITE}: the ld+json block lists no credentials`); return null; }
  return creds.map(c => ({ id: String(c.identifier ?? ''), from: c.validFrom ?? null,
                           to: c.expires ?? null, name: c.name ?? '' }));
}

function extractVisibleCerts(src){
  const blk = src.match(/<ul class="creg-list">([\s\S]*?)<\/ul>/);
  if (!blk) { fail(`${SITE}: could not find the certificate register`); return null; }
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const iso = t => {
    const m = t.match(/(\d{2}) (\w{3}) (\d{4})/);
    return m ? `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1]}` : null;
  };
  return (blk[1].match(/<li class="creg[\s\S]*?<\/li>/g) || []).map(li => {
    const dates = ((li.match(/<p class="creg-dates">([\s\S]*?)<\/p>/) || [])[1] || '')
      .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    const tail = dates.replace(/^\d{2} \w{3} \d{4}\s*/, '');
    return {
      id: (li.match(/data-sn="(\d+)"/) || [])[1] ?? null,
      name: ((li.match(/<p class="creg-name">([^<]*)/) || [])[1] || '').trim(),
      from: iso(dates),
      to: /no expiry/i.test(tail) ? null : iso(tail)
    };
  });
}

const ldCerts  = extractLdCerts(siteSrc);
const vizCerts = extractVisibleCerts(siteSrc);

if (ldCerts && vizCerts){
  let drift = 0;
  if (ldCerts.length !== vizCerts.length){
    fail(`certificates: ld+json lists ${ldCerts.length} but the page shows ${vizCerts.length}`);
    drift++;
  }
  for (const v of vizCerts){
    if (!v.id){ fail(`a certificate row on ${SITE} carries no serial number`); drift++; continue; }
    const l = ldCerts.find(x => x.id === v.id);
    if (!l){
      fail(`certificate SN ${v.id} (${v.name}) is on the page but missing from the ld+json`);
      drift++; continue;
    }
    if (v.from !== l.from){
      fail(`certificate SN ${v.id} (${v.name}) issue date differs: page=${v.from} vs ld+json=${l.from}`);
      drift++;
    }
    if ((v.to ?? null) !== (l.to ?? null)){
      fail(`certificate SN ${v.id} (${v.name}) expiry differs: page=${v.to} vs ld+json=${l.to}`);
      drift++;
    }
  }
  for (const l of ldCerts){
    if (!vizCerts.find(x => x.id === l.id)){
      fail(`the ld+json claims certificate ${l.id} (${l.name}) with no visible row to back it`);
      drift++;
    }
  }

  /* And the print CV must state the same dates for the same certificate. Matched on the
     visible name, which is a prefix of the printed line in every case. */
  const printLines = ((printSrc.match(/<div class="certs">([\s\S]*?)<\/div>\s*<p class="certfoot"/) || [])[1] || '')
    .match(/<div class="cert">[\s\S]*?<\/div>/g) || [];
  const flat = printLines.map(d => d.replace(/<[^>]*>/g, '')
    .replace(/&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
  if (!flat.length){
    fail(`${PRINT}: could not find the certificate list`);
    drift++;
  } else {
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const human = d => { const [y,m,dd] = d.split('-'); return `${dd} ${MON[+m-1]} ${y}`; };
    for (const v of vizCerts){
      const key = v.name.replace(/&rsquo;/g, "'").replace(/&amp;/g, '&').trim();
      const line = flat.find(t => t.startsWith(key));
      if (!line){
        fail(`certificate "${key}" is on the site but no matching line in ${PRINT}`);
        drift++; continue;
      }
      if (v.from && !line.includes(human(v.from))){
        fail(`certificate "${key}" is issued ${human(v.from)} on the site, but ${PRINT} says:\n       ${line}`);
        drift++;
      }
      if (v.to && !line.includes(human(v.to))){
        fail(`certificate "${key}" expires ${human(v.to)} on the site, but ${PRINT} says:\n       ${line}`);
        drift++;
      }
      if (!v.to && !/no expiry/i.test(line)){
        fail(`certificate "${key}" has no expiry on the site, but ${PRINT} states one:\n       ${line}`);
        drift++;
      }
    }
  }

  /* A certificate that has lapsed is worse than one that is missing: the page presents
     every row as current. */
  const todayISO = new Date().toISOString().slice(0, 10);
  for (const v of vizCerts){
    if (v.to && v.to < todayISO){
      fail(`certificate SN ${v.id} (${v.name}) expired on ${v.to} — remove it or mark it lapsed`);
      drift++;
    }
  }

  if (!drift) ok(`certificates: ${vizCerts.length} registered, identical in the ld+json, ` +
                 `the page and ${PRINT}, none expired`);
}

/* ---------- hand-written validity claims go stale silently ---------- */

/* Two claims on these pages are prose, not data: the PEME validity and the contract note.
   Nothing derives them, so nothing notices when they pass. */
{
  const now = new Date();
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const endOfMonth = (mon, yr) => Date.UTC(yr, mon + 1, 0);
  for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
    const re = /(?:valid to|Contract to)\s+([A-Z][a-z]{2})[a-z]*\s+((?:19|20)\d{2})/gi;
    let m;
    while ((m = re.exec(src))){
      const mon = MON.indexOf(m[1].toLowerCase());
      if (mon < 0) continue;
      const expires = endOfMonth(mon, +m[2]);
      const daysLeft = Math.round((expires - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
      const claim = `"${m[0]}"`;
      if (daysLeft < 0) fail(`${file} still states ${claim}, which lapsed ${-daysLeft} day(s) ago`);
      else if (daysLeft <= 45) ok(`${file}: ${claim} expires in ${daysLeft} day(s) — plan the update`);
    }
  }
}

/* ---------- report ---------- */

for (const n of notes) console.log(`  ok   ${n}`);
if (warnings.length){
  console.log('');
  for (const w of warnings) console.log(`  WARN ${w}`);
}
if (!failures.length){
  console.log('\nAll checks passed.');
  process.exit(0);
}
console.error('');
for (const f of failures) console.error(`  FAIL ${f}`);
console.error(`\n${failures.length} check(s) failed.`);
process.exit(1);

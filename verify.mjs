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

import { readFileSync, statSync, readdirSync } from 'node:fs';

const SITE = 'index.html';
const PRINT = 'cv_print.html';
const PDF = 'ADLAWAN_RICHARD_CV.pdf';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const failures = [];
const notes = [];

function fail(msg){ failures.push(msg); }
function ok(msg){ notes.push(msg); }

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
  [/\b(?:CCM|COICNW|GOC|BTB|SCRB|PSCRB|AFF|SSO|MECA)\d{9,}\b/, 'a certificate number']
];
for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
  for (const [re, what] of banned){
    if (re.test(src)) fail(`${file} contains ${what}`);
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
  for (const [re, what] of appBanned){
    const hit = src.match(re);
    if (hit){ fail(`${rel} contains ${what}: "${hit[0]}"`); clean = false; }
  }
  if (clean) ok(`${rel}: no contact details`);
}

/* ---------- the PDF goes stale on its own ---------- */

/* The PDF is a frozen snapshot of numbers the two pages compute live. While a contract
   is open, its duration and every seatime total grow by a day, every day — so a PDF
   that was correct when it was exported quietly stops matching the site. Nothing in the
   browser can notice that, and a recruiter reads the PDF, not the site. */
{
  let pdf = null;
  try { pdf = statSync(new URL(PDF, import.meta.url)); }
  catch { fail(`${PDF} is missing — regenerate it from ${PRINT} (see README)`); }

  if (pdf){
    const printStat = statSync(new URL(PRINT, import.meta.url));
    if (pdf.mtimeMs < printStat.mtimeMs){
      fail(`${PDF} is older than ${PRINT} — regenerate the PDF (see README)`);
    } else if (a && a.some(r => r.to === null)){
      /* Compare *local* calendar days, not UTC ones. Both pages derive "today" from
         new Date().getFullYear/getMonth/getDate — the local date — so that is the clock
         the PDF's numbers were frozen against. Diffing UTC day floors instead reported a
         PDF exported this morning as a day stale for anyone east of UTC. */
      const localDay = d =>
        Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
      const days = localDay(new Date()) - localDay(pdf.mtime);
      if (days > 0){
        fail(`${PDF} was exported ${days} day(s) ago and a contract is still open, ` +
             `so its durations and totals now understate the record — regenerate it`);
      } else {
        ok(`${PDF} is current (exported today, open contract still counting)`);
      }
    } else {
      ok(`${PDF} is newer than ${PRINT}`);
    }
  }
}

/* ---------- offline guarantee ---------- */

for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
  /* rel="canonical" and rel="alternate" carry an absolute URL but are declarative
     metadata — the browser never fetches them, so they cost nothing offline. Drop those
     tags before scanning; everything else with an http(s) src/href does get fetched. */
  const scanned = src.replace(/<link\b[^>]*\brel\s*=\s*["'](?:canonical|alternate)["'][^>]*>/gi, '');
  const remote = scanned.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
  if (remote.length){
    fail(`${file} loads ${remote.length} remote resource(s) — breaks offline use: ` +
         remote.map(r => r.slice(0, 60)).join(', '));
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

/* ---------- report ---------- */

for (const n of notes) console.log(`  ok   ${n}`);
if (!failures.length){
  console.log('\nAll checks passed.');
  process.exit(0);
}
console.error('');
for (const f of failures) console.error(`  FAIL ${f}`);
console.error(`\n${failures.length} check(s) failed.`);
process.exit(1);

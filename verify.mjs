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
      dur: nullable('dur')
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

  /* Every closed contract needs its stated duration; the open one is computed. */
  a.forEach((r, i) => {
    if (r.to !== null && !r.dur) fail(`row ${i + 1} (${r.vessel}) is closed but has no duration`);
    if (r.to === null && r.dur) fail(`row ${i + 1} (${r.vessel}) is open, so dur must be null`);
    /* "0m 15d" reads like a broken field; a sub-month contract is just "15d". */
    if (r.dur && /^0m\s/.test(r.dur)){
      fail(`row ${i + 1} (${r.vessel}) has duration "${r.dur}" — drop the empty month, write "${r.dur.replace(/^0m\s*/, '').replace(/^0+/, '')}"`);
    }
  });
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

const banned = [
  [/\bUS\s+visa\b/i, 'US visa (not valid — must never be listed)'],
  [/\btel:/i, 'a telephone link'],
  [/\bphone\b/i, 'a phone number'],
  [/@(?:gmail|yahoo|outlook|hotmail)\./i, 'a personal email address']
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

/* ---------- the small things ---------- */

/* Three checks that all exist for the same reason: a CV is read by someone looking for a
   reason to stop reading, and an inconsistency between the two files is exactly that. They
   are cheap to introduce (one file gets edited, the other does not) and invisible until a
   recruiter has both open. */

/* Section order. The two files disagreed for a long time — the site ran Certifications
   after Safety, the print CV ran it third — and nothing noticed, because each file is
   internally consistent. Only a comparison catches it. */
{
  const headings = src => (src.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi) || [])
    .map(h => h.replace(/<[^>]+>/g, '')
               .replace(/&amp;/g, '&').replace(/&mdash;/g, '—')
               .replace(/\s+/g, ' ').trim().toLowerCase())
    /* The print CV states the certificate status in the heading ("Certifications — All
       Valid") where the site uses a separate badge element, so compare the stem. */
    .map(h => h.split(/\s+—\s+/)[0]);

  const ha = headings(siteSrc), hb = headings(printSrc);
  /* The site opens with the name in an <h1> and carries an extra "About" heading the print
     CV renders as "Professional Summary"; align those two names before comparing. */
  const norm = list => list.map(h => (h === 'about' || h === 'professional summary') ? 'summary' : h);
  const na = norm(ha), nb = norm(hb);

  if (na.join('|') !== nb.join('|')){
    fail(`section order differs between the two files:\n` +
         `        ${SITE}:  ${na.join(' → ')}\n` +
         `        ${PRINT}: ${nb.join(' → ')}`);
  } else {
    ok(`section order: ${na.length} sections, same order in both files`);
  }

  /* Education, if it is ever added, must sit below Sea Service. Putting it above the
     record is the single most common CV mistake for someone who has one. */
  for (const [list, file] of [[na, SITE], [nb, PRINT]]){
    const edu = list.indexOf('education'), svc = list.indexOf('sea service');
    if (edu > -1 && svc > -1 && edu < svc){
      fail(`${file}: Education is above Sea Service — the record comes first`);
    }
  }
}

/* Rank naming. "Designated Medical Officer (2/O)" sat one line below a table that spells
   the same rank "2nd Officer". Pick one; the abbreviations survive only inside the seatime
   bar, where a segment is too narrow for the long form. */
{
  const abbrev = /\((?:2\/O|3\/O|C\/O)\)|\b(?:2\/O|3\/O|C\/O)\s+(?:rank|officer)\b/gi;
  for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
    /* The seatime bar labels are built in JS as '3/O ' + duration — that is the one
       sanctioned use, so it is cut out before scanning rather than special-cased below. */
    const scanned = src.replace(/'[23]\/O '/g, "''");
    const hits = scanned.match(abbrev);
    if (hits) fail(`${file} writes a rank as ${[...new Set(hits)].join(', ')} — use the full form ("2nd Officer")`);
  }
}

/* Placeholder guard. The impact bullets are written to carry real figures, and a figure
   that has not been supplied yet must not ship — not as a guess, and not as a visible
   «N» that a recruiter reads as an unfinished CV. */
{
  const markers = [/«[^»]*»/g, /\bTODO\b/g, /\bTBD\b/g, /\[\[[^\]]+\]\]/g, /\bXX+\b/g];
  for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
    for (const re of markers){
      const hits = src.match(re);
      if (hits) fail(`${file} still contains placeholder text: ${[...new Set(hits)].slice(0, 5).join(', ')}`);
    }
  }
}

/* Metric coverage — a note, never a failure. Bullets that state an outcome without a
   number are weaker but not wrong, and there is no threshold worth failing a build over.
   Printing the ratio keeps it visible, which is the whole point: it is the number that
   quietly slides back down as sections get edited over time.

   Two things this got wrong when it was first written, both of which made the figure lie:

   It tested for a digit rather than for quantification, so "6 contracts" counted and
   "six contracts" did not — and the pages were full of the second kind. A spelled-out
   number is still a number; the reader cannot tell the difference and neither should this.

   And it counted certificate rows, which are not accomplishments. index.html renders those
   as <li> and the print CV renders them as <div class="cert">, so the same certificates
   landed in one denominator and not the other — which is why the two files reported
   different totals despite carrying the same content. The certificate block is cut out
   before scanning, the way the rank check cuts out the seatime-bar labels, rather than
   being filtered back out afterwards. */
{
  const WORD_NUM = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;

  for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
    const body = src.slice(src.indexOf('<body'))
      .replace(/<ul class="cert-list">[\s\S]*?<\/ul>/gi, '')
      .replace(/<div class="certs">[\s\S]*?<\/div>\s*<\/section>/gi, '');

    /* The site states its tools as cards and the print CV states the same tools as a
       list, so counting only <li> and .grp scored the same eight tools in one file and
       not the other. Pull the card copy in too, or the two ratios are not comparable. */
    const toolsGrid = (body.match(/<div class="tools-grid">[\s\S]*?\n        <\/div>/i) || [''])[0];

    const bullets = (body.match(/<li\b[^>]*>([\s\S]*?)<\/li>/gi) || [])
      .concat(body.match(/<div class="grp">[\s\S]*?<\/div>/gi) || [])
      .concat(toolsGrid.match(/<p>[\s\S]*?<\/p>/gi) || [])
      .map(b => b.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' '))
      /* Nav entries and one-word list items are not accomplishment bullets. */
      .filter(t => t.trim().split(/\s+/).length >= 8);

    if (!bullets.length) continue;
    const quantified = bullets.filter(t => /\d/.test(t) || WORD_NUM.test(t)).length;
    ok(`${file}: metric coverage ${quantified}/${bullets.length} bullets are quantified`);
  }
}

/* ---------- the PDF goes stale on its own ---------- */

const STALE_DAYS = 14;
const PDF_PAGES  = 2;

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
      /* Graded, because the strict version failed every single day. An open contract grows
         by a day every day, so "exported before today" was permanently true and the script
         was permanently red — the exact cry-wolf failure this file avoids everywhere else.
         A fortnight of drift is invisible against 3+ years of seatime; a quarter is not. */
      if (days >= STALE_DAYS){
        fail(`${PDF} was exported ${days} day(s) ago and a contract is still open, ` +
             `so its durations and totals now understate the record — regenerate it`);
      } else if (days > 0){
        ok(`${PDF} exported ${days} day(s) ago; open contract understates by ${days}d ` +
           `(regenerate before sending, required at ${STALE_DAYS})`);
      } else {
        ok(`${PDF} is current (exported today, open contract still counting)`);
      }
    } else {
      ok(`${PDF} is newer than ${PRINT}`);
    }

    /* The layout is a fixed two-page budget and it sits within a couple of millimetres of
       full, so a few added lines silently produce a three-page CV. Until now nothing
       caught that — the README said so in as many words. Counting page objects in the
       exported file needs no library and no browser, which keeps `node verify.mjs` the
       whole toolchain.

       If the count cannot be read the check says nothing at all. A checker that fails
       because it could not parse something is noise, and noise is what gets checks
       ignored. */
    const bytes = readFileSync(new URL(PDF, import.meta.url)).toString('latin1');
    const pages = (bytes.match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pages > PDF_PAGES){
      fail(`${PDF} is ${pages} pages — the layout is a ${PDF_PAGES}-page budget. ` +
           `Cut words from the Bridge and Cargo prose in ${PRINT}, do not shrink the type`);
    } else if (pages === PDF_PAGES){
      ok(`${PDF}: ${pages} pages, within budget`);
    }
  }
}

/* ---------- offline guarantee ---------- */

for (const [src, file] of [[siteSrc, SITE], [printSrc, PRINT]]){
  /* rel="canonical" and rel="alternate" carry an absolute URL but are declarative
     metadata — the browser never fetches them, so they cost nothing offline. Drop those
     tags before scanning; everything else with an http(s) src/href does get fetched.

     An <a href> is the same category and was not exempt, which is why the print CV could
     not state its own web address: the check read a link a reader might click as a
     resource the page loads. Only fetched subresources break offline use. */
  const scanned = src
    .replace(/<link\b[^>]*\brel\s*=\s*["'](?:canonical|alternate)["'][^>]*>/gi, '')
    .replace(/<a\b[^>]*>/gi, '<a>');
  const remote = scanned.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
  if (remote.length){
    fail(`${file} loads ${remote.length} remote resource(s) — breaks offline use: ` +
         remote.map(r => r.slice(0, 60)).join(', '));
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

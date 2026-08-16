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

import { readFileSync, statSync } from 'node:fs';

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

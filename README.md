# Richard Mark H. Adlawan — Deck Officer CV

Personal career website, matching PDF CV, and five working shipboard apps. No build step,
no dependencies.

Live at **https://richardmarkadlawan.github.io**

| File | What it is |
|---|---|
| `index.html` | The website. Single file, dark by default with a light toggle. |
| `cv_print.html` | The print layout the PDF is made from. A4, two pages. |
| `ADLAWAN_RICHARD_CV.pdf` | The downloadable CV. `index.html` links to it. |
| `portrait.jpg` | The profile photo. 640×640 square, drawn as a circle by CSS in both pages. |
| `apps/` | The shipboard apps, one folder each. Linked from the Tools section. |

Everything is vanilla HTML, CSS and JavaScript with a system font stack — no frameworks, no CDNs,
no web fonts. Open `index.html` straight from disk and it works offline, including on a phone
with no signal.

## Publishing to GitHub Pages

The repo is `richardmarkadlawan/richardmarkadlawan.github.io`. The repo name must match the
account username exactly — that is what makes GitHub serve it at the bare
`https://richardmarkadlawan.github.io` with no path, rather than as a project site under it.

Push to `main` and it redeploys — the site is served as-is, nothing compiles. The repo must stay
**public**; serving Pages from a private repo needs a paid plan.

```bash
node verify.mjs && git push
```

Deploys take a minute or two to appear. A hard refresh clears the old copy if you still see it.

## The apps

Each app is one self-contained HTML file served from its own folder, linked from the Tools
section of the CV. They are copies — edit the source, then copy the new version in.

| Folder | Source of truth |
|---|---|
| `apps/draft-survey/` | `~/XCODE IOS BUILDS/Draft survey/index.html` |
| `apps/cargo-ops/` | `~/XCODE IOS BUILDS/Cargo/index.html` |
| `apps/ballast/` | `~/XCODE IOS BUILDS/Ballast/index.html` |
| `apps/noon-guide/` | `~/XCODE IOS BUILDS/Noon guide/NOON_GUIDE-31.html` |
| `apps/egc-reader/` | `~/Desktop/EGC READER/EGC_WARNING_READER_1_19.html` |

**Ship Weather Routing is not here and cannot be.** It is 23 GB, 13 GB of that map tiles, which
is far past what GitHub Pages will host.

### One thing to watch when adding an app

`localStorage` is scoped to the **origin**, not the path. On disk each app is its own `file://`
document with its own storage; on the live site all of them share one store. Today that is safe —
every app namespaces its keys (`fge-`, `bvp_`, `ng_`, `EGC_`, `cargo-`) and none of them overlap.

Cargo Ops is the fragile one: alongside its `cargo-` keys it also writes bare `sp`, `sp-total`,
`sp1`…`sp6` and `dis_*`. Nothing collides with those now, but they are generic enough that a
future app easily could — and the symptom would be one app silently overwriting another's saved
work. Give any new app a distinct prefix.

## Regenerating the PDF

The CV is generated from `cv_print.html`, so edit that file rather than the PDF.

In Safari or Chrome, open `cv_print.html` and print (⌘P). Choose **Save as PDF**, paper size
**A4**, margins **Default**, turn **off** headers and footers, turn **on** background graphics.
Save it next to `index.html` as `ADLAWAN_RICHARD_CV.pdf`. The on-screen page shows these same
instructions; they do not appear in the print output.

To regenerate from the command line instead:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-pdf-header-footer --print-to-pdf="ADLAWAN_RICHARD_CV.pdf" cv_print.html
```

## Checking consistency

```bash
node verify.mjs
```

Run this after editing either page, and before publishing. It needs nothing installed. It checks
that both files carry the same sea service record, that the "3+ years" claim is still true against
the dates, that no phone number, personal email or expired document has crept in, and that neither
page has picked up a remote resource that would break offline use. It exits non-zero on failure, so
it also works as a pre-commit hook.

It also checks that **the PDF has not gone stale**. Both pages compute durations and seatime
totals live, but the PDF is a frozen export — so while a contract is open, every day that passes
makes the PDF understate the record by a day. The check fails if the PDF is older than
`cv_print.html`, or if it was exported on an earlier day while a contract is still open. When it
fails, regenerate the PDF (below) and run it again.

Note that the word "phone" is banned outright in the two CV pages, not just phone-number patterns.
That is deliberate — a blunt guard is the right trade for a privacy check — so avoid the word even
in code comments.

**It scans `apps/` for contact details too**, and that is not decoration. A contact watermark
carrying a personal email and mobile number shipped inside the draft survey app and sat live on the
public site, while this script reported all clear — it only ever read `index.html` and
`cv_print.html`. Anything published is in scope now.

The apps are checked against the patterns that match real contact details (personal email domains,
`tel:` links, `+CC NNNNNNN` numbers) but *not* the bare word "phone" — app UI copy says "phone"
legitimately, and a check that cries wolf is a check people learn to ignore.

**The watermark belongs in the working copy, not the hosted one.** When you re-copy the draft
survey app from source, drop the `wm-contact` element again; the `.wm-contact` CSS is left in place
so the rest of the diff stays clean.

## Editing the sea service record

Both pages build their service tables from a `SERVICE` array near the top of their `<script>`
block. The two copies must stay identical, or the website and the PDF will disagree — `verify.mjs`
is what catches it if they drift.

Each entry carries the vessel, type, rank, start date and end date. A `to` of `null` means the
contract is current: the duration counts to today's date, and the row reads "Present". Seatime
totals are computed from these dates at page load, so they stay current without editing.

Adding a contract means adding one entry to the array in each file, newest first. Nothing else
needs to change.

## Certifications

The website lists certificates as a plain two-column list under a single **ALL VALID** badge on
the heading, rather than repeating a status against every row. If a certificate ever stops being
valid, that badge is no longer true — split the list or drop the badge rather than leaving it.

## Still to do

`og:image` is the last tag that needs a hosted file — a social preview card, referenced by
absolute URL. `og:url` and `<link rel="canonical">` are now set to the live address. Everything
else, including the `schema.org/Person` structured data, is inline and works from `file://`.

## Contact details

The contact section deliberately carries no email address, phone number or home address — only
"available on request". Add contact details in both `index.html` and `cv_print.html` when you
want them public.

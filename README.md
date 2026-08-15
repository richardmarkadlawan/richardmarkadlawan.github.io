# Richard Mark H. Adlawan — Deck Officer CV

Personal career website and matching PDF CV. Three files, no build step, no dependencies.

| File | What it is |
|---|---|
| `index.html` | The website. Single file, dark by default with a light toggle. |
| `cv_print.html` | The print layout the PDF is made from. A4, two pages. |
| `ADLAWAN_RICHARD_CV.pdf` | The downloadable CV. `index.html` links to it. |

Everything is vanilla HTML, CSS and JavaScript with a system font stack — no frameworks, no CDNs,
no web fonts. Open `index.html` straight from disk and it works offline, including on a phone
with no signal.

## Publishing to GitHub Pages

Push to `main`, then in the repository settings under Pages choose **Deploy from a branch** →
`main` / `root`. The site is served as-is; there is nothing to compile.

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

Note that the word "phone" is banned outright, not just phone-number patterns. That is deliberate —
a blunt guard is the right trade for a privacy check — so avoid the word even in code comments.

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

## Still to do once the site has a URL

`og:image`, `og:url` and `<link rel="canonical">` all need an absolute host, so they are not in
`index.html` yet — there is a comment in `<head>` marking the spot. Everything else, including the
`schema.org/Person` structured data, is inline and works from `file://`.

## Contact details

The contact section deliberately carries no email address, phone number or home address — only
"available on request". Add contact details in both `index.html` and `cv_print.html` when you
want them public.

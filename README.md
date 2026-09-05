# Richard Mark H. Adlawan — Deck Officer CV

Personal career website, matching PDF CV, and five working shipboard apps. No build step,
no install, nothing to run before it works.

Live at **https://richardmarkadlawan.github.io**

| File | What it is |
|---|---|
| `index.html` | The website. Single file, dark by default with a light toggle. |
| `cv_print.html` | The print layout the PDF is made from. Two pages, sized to fit A4 and US Letter. |
| `ADLAWAN_RICHARD_CV.pdf` | The downloadable CV. `index.html` links to it. |
| `portrait.jpg` | The profile photo. 640×640 square, cropped to a 4:5 rectangle by CSS in both pages. |
| `apps/` | The shipboard apps, one folder each. Linked from the Tools section. |

Everything is vanilla HTML, CSS and JavaScript — no frameworks and no CDNs. The one exception
is [Motion](https://motion.dev) 13.1.1, which drives the reveal-on-scroll animation in
`index.html`: it is *vendored*, meaning a 10 KB tree-shaken build is pasted into the page as a
literal `<script>` rather than fetched from a CDN or pulled in at build time. There is still
nothing to install and nothing to compile. The banner comment above that script says how to
rebuild it — do it in a scratch directory, as `package.json` and `node_modules` must never
appear in this repo. The page is written to stay fully readable if that script never runs. The two typefaces
(Newsreader for prose, IBM Plex Mono for data) are embedded in each file as base64 rather than
linked, so the pages keep their typography with no connection at all. Open `index.html` straight
from disk and it works offline, including on a handset with no signal.

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
The layout is sized to fit inside US Letter's shorter height as well, so it comes out as two
pages on either paper.
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
makes the PDF understate the record by a day.

It reads the export date out of the PDF's own `/CreationDate`, not the file's modification time.
Modification times cannot be used here: git does not preserve them, so on a fresh clone every
file carries the checkout time and whichever happened to be written first looks "older" — this
check failed on a clean clone for exactly that reason, over a 32-millisecond gap, while `touch`ing
a genuinely stale PDF made it pass. The date inside the file is the moment the figures were
frozen, and nothing in a clone or a copy can move it.

While a contract is open the PDF drifts by a day, every day, so its age is what matters:

| PDF age | What happens |
|---|---|
| 0–2 days | passes, stating the age |
| 3–6 days | **warns** — printed in its own block, but the run still exits 0 |
| 7 days or more | **fails** — exits non-zero |

Failing on day one would be technically right and practically useless: it would go red every
morning, and a check that is always red is one people learn to skip with `--no-verify`. A CV one
day out is accurate; a CV a week out understates the record by a week, which is the point at
which a recruiter is reading something wrong. Both thresholds are constants at the top of that
block if you want them tighter.

With no open contract the figures are fixed, so age alone is harmless — the check instead asks
git whether `cv_print.html` has changed since the export. When it fails, regenerate the PDF
(below) and run it again.

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

Every privacy pattern is run twice: once over the raw source, once over the same text with HTML
entities decoded. `me&#64;gmail.com` and `me&commat;gmail.com` render as ordinary addresses and
both walked straight past the raw-source-only version. The certificate-number pattern likewise
accepts a space or a hyphen before the digits, because that is how the numbers are actually
written. When the check does fire it names the file and the kind of detail, and never echoes the
value — this output gets pasted into terminals and issues.

### What else it checks

- **The certificates.** The eight registered ones are stated in the `ld+json`, in the visible
  list and in `cv_print.html`. All three are diffed by serial; a lapsed expiry is a failure, not
  a warning, because the page presents every row as current.
- **The print CV's register.** `cv_print.html` builds its Sea Service table from static markup
  now, exactly as `index.html` does, so it survives with scripts off — and like every other copy
  of the record it is checked against `SERVICE` rather than trusted. A duration written into that
  markup is a failure: durations are derived from the dates, never stored.
- **Remote resources.** Not just `src=`/`href=` — also CSS `url()`, `@import`, `srcset`, unquoted
  attributes and protocol-relative `//host` URLs. The one that matters is `@font-face{src:url(…)}`:
  both pages embed their typefaces as `data:` URIs, and swapping one for a Google Fonts URL is the
  most plausible way this page ever loses its offline guarantee. It looks perfect on a laptop.
- **Hand-written validity claims.** "valid to Dec 2027" and "Contract to Oct 2026" are prose, not
  data, so nothing derived them and nothing noticed them passing. They now fail once lapsed and
  warn 45 days out.

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

The website splits them in two. Everything under **On the MARINA register** carries its serial
number and is checkable by a stranger in about a minute — those rows are what the `howto` block
above them explains. Everything under **Training & endorsements** is course work no public
register carries, so it is listed without serials. Keeping them in one list made a verifiable CoC
and an in-house ECDIS course look like the same kind of claim.

The same eight registered certificates are stated three times — in the `ld+json` block, in the
visible list, and in `cv_print.html`. `verify.mjs` now diffs all three by serial and fails if any
issue date or expiry disagrees, or if a listed certificate has passed its expiry. There is no
longer a standing "all valid" claim to keep true by hand; the check is what keeps it true.

## Still to do

Nothing outstanding on the metadata. `og:image` points at the hosted `portrait.jpg`, `og:url` and
`<link rel="canonical">` are set to the live address, and everything else — including the
`schema.org/Person` structured data — is inline and works from `file://`. A purpose-made social
preview card (wider than a square portrait, with the name set in it) would render better in a
link unfurl than the portrait does, but that is a refinement, not a gap.

## Contact details

The contact section deliberately carries no email address, phone number or home address — only
"available on request". Add contact details in both `index.html` and `cv_print.html` when you
want them public.

### The history is public too

Removing something from a file does not remove it from the repository. The contact watermark that
shipped inside the draft survey app was taken out of the working tree in `1df7528`, but the commit
that introduced it is still an ancestor of `main` — and this repo has to stay public for Pages to
serve it, so anyone can still read that commit.

Deleting a line is not enough. Either the history gets rewritten and force-pushed, or the detail
stays public regardless of what HEAD says. `verify.mjs` only ever sees the working tree; it cannot
tell you anything about what is behind you. Before publishing anything with a personal detail in
it, assume the first commit is the permanent one.

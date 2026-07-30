# Presto Production WCAG Audit

Accessibility audit of the **live** EventPipe / Presto booking journey, against
**WCAG 2.2 Level AA**, at 1440px desktop and 390px mobile.

Every page is a **verbatim capture of production** — the exact DOM the browser built,
with the exact production CSS, replayed in Storybook inside a shadow root so axe-core
can audit the real markup in place. Nothing is rebuilt or re-implemented.

```bash
pnpm install
pnpm storybook        # browse the audit at http://localhost:6007
```

## Current findings

| Impact | Distinct issues |
| --- | --- |
| Critical | 19 |
| Serious | 31 |
| Moderate | 3 |

**755** individual element occurrences across 5 captured pages.

The highest-severity finding is **WCAG 2.2.1 (Level A)**: checkout imposes a ~15-minute
countdown with no way to turn it off, adjust it, or extend it, spanning a four-step form
that collects guest details, payment and policy consent.

See `docs/FINDINGS.md`, or the **Scorecard** page in Storybook.

## The journey spans two applications

Fixes rarely transfer between them — they are different stacks with different defects.

| Stage | Host | Stack |
| --- | --- | --- |
| Search & filter results | `presto.eventpipe.com` | Vue 3 + Quasar SPA |
| Hotel detail & room select | `presto.eventpipe.com` | Vue 3 + Quasar SPA |
| Checkout (4-step wizard) | `app.eventpipe.com` | Server-rendered forms |
| Confirmation | `app.eventpipe.com` | Server-rendered forms |
| Manage booking | `app.eventpipe.com` | Server-rendered forms |

## Pipeline

```bash
pnpm capture                     # render pages, extract DOM + CSS + inventory
pnpm audit                       # axe-core, WCAG 2.2 A+AA, both viewports
pnpm report                      # generate Storybook stories + findings pages
pnpm pipeline                    # all three in order

node capture/focus-check.mjs     # empirical keyboard focus traversal (hits live site)
node capture/analyze.mjs         # structural findings beyond axe
```

Targets are declared in [`capture/targets.json`](capture/targets.json). Add a URL, re-run,
and the page joins the audit.

## Layout

```
capture/
  targets.json      pages under audit — edit this to add more
  scrape.mjs        Playwright capture (DOM, CSS, screenshots, inventory)
  audit.mjs         axe-core run against each snapshot
  analyze.mjs       structural findings axe cannot detect
  focus-check.mjs   real Tab traversal + pixel diff
  report.mjs        generates the Storybook surface
  fixes.js          remediation library — the hand-authored part
  lib/              browser-context extraction, sanitization
snapshots/          captured evidence (committed)
src/
  lib/snapshot.js   shadow-root replay used by every story
  stories/          generated stories + findings pages
docs/FINDINGS.md    scorecard as plain markdown
```

Everything under `src/stories/` except `Introduction.mdx` and `Methodology.mdx` is
**generated** — edit `capture/fixes.js` or `capture/targets.json` and re-run `pnpm report`
rather than editing the output.

## Three pages are pending

The confirmation page, checkout steps 2–4, and authenticated booking management are gated
behind a completed booking or a login. Their slots exist in the correct position in the
journey and render a "Pending capture" placeholder until URLs are supplied.

To add one: paste its URL into `capture/targets.json` and run
`pnpm capture -- <target-id> && pnpm audit && pnpm report`.

For cookie-gated pages, save a Playwright storage state first — it is gitignored:

```bash
npx playwright open --save-storage=capture/auth.json https://app.eventpipe.com
```

## Evidence sources

Automated rules catch roughly a third of WCAG failures, so findings come from three places
and each is labelled with its source:

1. **axe-core 4.12** — WCAG 2.2 A + AA tag set, run against each snapshot.
2. **Structural analysis** — heading outline, landmark coverage, label association,
   autocomplete tokens, measured target geometry.
3. **Empirical keyboard traversal** — real `Tab` presses with before/after pixel diffing.

The third exists because focus visibility cannot be settled by reading CSS: `:focus-visible`
does not match a programmatic `.focus()` call. A style-only pass on this codebase reported
169 unfocusable elements on one page; measuring it properly showed the real number was 2.

## Caveats

Scripts are stripped from captures, so **interactive behaviour is not reproduced** —
dropdowns do not open and the map is a static tile. Findings that depend on interaction were
verified against the live site during capture. Third-party widgets (support chat, Google
Maps) are audited as users encounter them but are vendor-controlled.

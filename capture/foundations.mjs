// Generate the Foundations section from extracted design tokens.
//
//   node capture/foundations.mjs      (run after capture/tokens.mjs)
//
// Emits src/stories/foundations/{Colors,Typography,ColorContrast}.mdx.
//
// Everything is derived from snapshots/tokens.json — i.e. from what production
// actually paints, not from what the stylesheet declares. A colour appears here
// only because some element really renders it.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/stories/foundations')

const tokens = JSON.parse(await readFile(join(ROOT, 'snapshots/tokens.json'), 'utf8'))
const { summary, palette, typeScale, contrast } = tokens

// A ratio this low means the text would be effectively invisible, which no
// shipped UI does. In practice it means the backdrop walker never found the
// image sitting behind the text — the event hero being the obvious case. These
// are surfaced as "needs manual check" rather than asserted as failures, so the
// audit never claims a failure it cannot stand behind.
const SUSPECT_BELOW = 1.5
const isSuspect = (p) => p.ratio < SUSPECT_BELOW

const swatch = (hexColor, size = 14) =>
  `<span style={{display:'inline-block',width:${size},height:${size},borderRadius:3,` +
  `background:'${hexColor}',border:'1px solid rgba(0,0,0,.25)',verticalAlign:'middle',marginRight:6}} />`

const pill = (ok) =>
  ok
    ? `<span style={{color:'#0b6b3a',fontWeight:700}}>PASS</span>`
    : `<span style={{color:'#b3001b',fontWeight:700}}>FAIL</span>`

const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2)

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const textColors = palette.filter((c) => c.asText > 0).sort((a, b) => b.asText - a.asText)
const bgColors = palette.filter((c) => c.asBg > 0).sort((a, b) => b.asBg - a.asBg)

const colorsMdx = `import { Meta } from '@storybook/addon-docs/blocks'

<Meta title="Foundations/Colors" />

# Colors

The palette **as production actually paints it**, harvested from the computed styles of
every visible text element across all captured pages — not from the stylesheet.

That distinction matters. Parsing the CSS would enumerate every colour the codebase
*declares*, including dead rules, Quasar defaults nothing instantiates, and utility
classes no template applies. This list contains only colours a real element really
renders, and the counts tell you how much of the UI a change would move.

**${summary.distinctColors} distinct colours** in use across ${contrast.length} real
foreground/background pairings.

## Text colors

${textColors.length} colours are used for text.

| | Hex | Text uses | Also used as background |
| --- | --- | --- | --- |
${textColors.map((c) => `| ${swatch(c.hex)} | \`${c.hex}\` | ${c.asText} | ${c.asBg || '—'} |`).join('\n')}

## Background colors

${bgColors.length} colours appear behind text.

| | Hex | Background uses | Also used as text |
| --- | --- | --- | --- |
${bgColors.map((c) => `| ${swatch(c.hex)} | \`${c.hex}\` | ${c.asBg} | ${c.asText || '—'} |`).join('\n')}

## Observations

- **The status palette is the problem.** Availability state is carried almost entirely by
  hue — \`#4CAF50\` available, \`#F9A825\` waitlist, \`#F44336\` unavailable — and every one of
  those fails AA as text on white. See **Color Contrast** for the numbers.
- Because that state is signalled by colour, it also raises **1.4.1 Use of Color** (Level A):
  the meaning must survive when hue is not perceivable. Adding an icon or text prefix fixes
  1.4.1 and darkening the hue fixes 1.4.3 — both are needed, neither substitutes for the other.
- Greys are used at several near-identical values (\`#9E9E9E\`, \`#8C92A0\`, \`#6C757D\`, \`#666666\`).
  Consolidating them into a single accessible ramp would remove failures and shrink the palette.

---

_Generated from \`snapshots/tokens.json\` by \`capture/foundations.mjs\`._
`

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

const smallText = typeScale.filter((t) => t.size < 12)
const byFamily = summary.families

/** Unitless-ish line-height ratio, where resolvable. */
function lhRatio(t) {
  const lh = parseFloat(t.lineHeight)
  if (!lh || !t.size) return null
  return Math.round((lh / t.size) * 100) / 100
}

const tightLh = typeScale.filter((t) => {
  const r = lhRatio(t)
  return r !== null && r < 1.5 && t.size < 24
})

const typographyMdx = `import { Meta } from '@storybook/addon-docs/blocks'

<Meta title="Foundations/Typography" />

# Typography

Every type style production actually renders, measured from computed styles across all
captured pages. **${summary.typeStyles} distinct combinations** of family, size and weight.

## Families

| Family | Elements | Notes |
| --- | --- | --- |
${byFamily
  .map(
    (f) =>
      `| ${f.name} | ${f.count} | ${
        f.name === 'Material Icons'
          ? 'Icon font — ligature text is read aloud unless the glyph is `aria-hidden`'
          : f.name === 'Roboto'
            ? 'Third-party (Google Maps controls)'
            : f.name === 'Product Sans'
              ? 'Checkout only (`app.eventpipe.com`)'
              : 'Primary UI face (`presto.eventpipe.com`)'
      } |`
  )
  .join('\n')}

Two different primary faces ship across the journey — **PT Sans** on search and hotel
detail, **Product Sans** on checkout — which is a consequence of the two-application split
rather than a deliberate type system.

## Type scale

Sorted largest to smallest. \`LH ratio\` is line-height ÷ font-size.

| Size | Weight | LH | LH ratio | Family | Uses | Example |
| --- | --- | --- | --- | --- | --- | --- |
${typeScale
  .map((t) => {
    const r = lhRatio(t)
    const flag = t.size < 12 ? ' ⚠️' : ''
    return `| ${t.size}px${flag} | ${t.weight} | ${t.lineHeight} | ${r ?? '—'} | ${t.family} | ${t.count} | ${(t.samples[0] || '').replace(/\|/g, '\\|').slice(0, 40)} |`
  })
  .join('\n')}

## Findings

### Text below 12px

${
  smallText.length
    ? `${smallText.length} style${smallText.length === 1 ? '' : 's'} render below 12px:

| Size | Family | Uses | Example |
| --- | --- | --- | --- |
${smallText.map((t) => `| ${t.size}px | ${t.family} | ${t.count} | ${(t.samples[0] || '').slice(0, 40)} |`).join('\n')}

WCAG sets no absolute minimum font size, so this is **not a conformance failure on its own**.
It matters for two other reasons: small text makes the 1.4.3 contrast threshold harder to
meet in practice, and it interacts with **1.4.4 Resize Text** — the page must stay usable at
200% zoom, and text this small is often paired with fixed-height containers that clip when
scaled.`
    : 'No text renders below 12px.'
}

### Line height

WCAG **1.4.12 Non-text Contrast / Text Spacing (AA)** requires that content survive a
user stylesheet setting line-height to **1.5×** font size. ${
  tightLh.length
    ? `${tightLh.length} body-size style${tightLh.length === 1 ? '' : 's'} currently ship below that ratio, so any fixed-height container around them should be re-checked with 1.5 applied:

| Size | Weight | LH ratio | Uses | Example |
| --- | --- | --- | --- | --- |
${tightLh
  .slice(0, 15)
  .map((t) => `| ${t.size}px | ${t.weight} | ${lhRatio(t)} | ${t.count} | ${(t.samples[0] || '').slice(0, 34)} |`)
  .join('\n')}

The criterion is about *tolerating* 1.5, not shipping it — a tight default is fine provided
nothing clips or overlaps when the user forces the larger value.`
    : 'All body-size styles already ship at 1.5 or looser.'
}

### Icon font text

**Material Icons** accounts for ${byFamily.find((f) => f.name === 'Material Icons')?.count ?? 0} elements. The glyph is
selected by a text ligature — the element literally contains the word \`arrow_left\`,
\`search\`, \`star\`. Where the icon is not marked \`aria-hidden="true"\`, screen readers
announce that raw ligature. This is the mechanism behind the \`button-name\` failures in the
journey findings: the accessible name resolves to \`"arrow_drop_down"\` rather than a label.

---

_Generated from \`snapshots/tokens.json\` by \`capture/foundations.mjs\`._
`

// ---------------------------------------------------------------------------
// Color contrast matrix
// ---------------------------------------------------------------------------

const failing = contrast.filter((p) => !p.aa && !isSuspect(p)).sort((a, b) => b.count - a.count)
const suspect = contrast.filter(isSuspect)
const aaOnly = contrast.filter((p) => p.aa && !p.aaa).sort((a, b) => b.count - a.count)
const passing = contrast.filter((p) => p.aaa).sort((a, b) => b.count - a.count)

const failElements = failing.reduce((a, p) => a + p.count, 0)

const row = (p) =>
  `| ${swatch(p.fg)}\`${p.fg}\` | ${swatch(p.bg)}\`${p.bg}\` | ${fmt(p.ratio)}:1 | ${p.size}px / ${p.weight}${p.large ? ' (large)' : ''} | ${p.aaMin}:1 | ${pill(p.aa)} | ${p.aaaMin}:1 | ${pill(p.aaa)} | ${p.count} | ${(p.samples[0] || '').replace(/\|/g, '\\|').slice(0, 30)} |`

const HEAD = `| Foreground | Background | Ratio | Size / weight | AA needs | AA | AAA needs | AAA | Uses | Example |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`

const contrastMdx = `import { Meta } from '@storybook/addon-docs/blocks'

<Meta title="Foundations/Color Contrast" />

# Color Contrast

Every foreground/background pairing that **actually occurs** in the captured production
pages, scored against WCAG 1.4.3 (AA) and 1.4.6 (AAA).

Ratios are computed the way the spec defines them: sRGB relative luminance, with
translucent colours composited over their resolved backdrop first. The backdrop is found by
walking ancestors until something opaque is reached — a naive
\`getComputedStyle(el).backgroundColor\` returns \`rgba(0,0,0,0)\` for most elements and would
score almost everything against nothing.

## Thresholds

| Text | AA | AAA |
| --- | --- | --- |
| Normal (< 18.66px bold, < 24px) | 4.5:1 | 7:1 |
| Large (≥ 24px, or ≥ 18.66px bold) | 3:1 | 4.5:1 |

## Summary

| | Pairings | Text elements |
| --- | --- | --- |
| **Fail AA** | ${failing.length} | ${failElements} |
| Pass AA, fail AAA | ${aaOnly.length} | ${aaOnly.reduce((a, p) => a + p.count, 0)} |
| Pass AAA | ${passing.length} | ${passing.reduce((a, p) => a + p.count, 0)} |
${suspect.length ? `| Needs manual check | ${suspect.length} | ${suspect.reduce((a, p) => a + p.count, 0)} |` : ''}

## Failing AA — ${failing.length} pairings, ${failElements} elements

These are conformance failures at Level AA.

${HEAD}
${failing.map(row).join('\n')}

### What this actually means

The failures are not scattered — they concentrate in **two systems**:

1. **Availability status.** \`#4CAF50\` "Fully Available", \`#F9A825\` "Waitlist Available",
   \`#F44336\` "Some Dates Not Available" — the three states a user compares hotels on, and
   all three fail as text on white. \`#F9A825\` at **1.97:1** is the worst pairing in the
   journey, under half the required ratio.
2. **The "Preferred Hotel" ribbon.** White on \`#00A87E\` at **3.04:1**, repeated **320 times**
   — the single highest-volume failure, because it renders once per result card.

Both also raise **1.4.1 Use of Color (Level A)**: the state is conveyed by hue alone. Fixing
contrast does not fix that — an icon or text prefix is needed as well.

## Pass AA, fail AAA — ${aaOnly.length} pairings

Not conformance failures at AA. Listed because AAA is the stated target for some public-sector
and EN 301 549 procurement, and because these are the cheapest upgrades available.

${HEAD}
${aaOnly.map(row).join('\n')}

${
  suspect.length
    ? `## Needs manual check — ${suspect.length} pairing${suspect.length === 1 ? '' : 's'}

Ratios below ${SUSPECT_BELOW}:1 mean the text would be effectively invisible, which no shipped UI
does. In practice it means the backdrop walker did not find the image sitting behind the
text — the event hero, where white type sits over an uploaded event photo, is the known case.

**These are reported, not asserted as failures.** They need a human to look at the rendered
page and judge the real backdrop.

${HEAD}
${suspect.map(row).join('\n')}

Text over photographic backgrounds is excluded from the matrix above for the same reason:
the effective backdrop is whatever image an organiser uploaded, so it cannot be scored
statically and changes per event. The durable fix is a scrim — a semi-opaque overlay between
photo and text — which guarantees the ratio regardless of the image.
`
    : ''
}

## Passing AAA — ${passing.length} pairings

${HEAD}
${passing.map(row).join('\n')}

---

_Generated from \`snapshots/tokens.json\` by \`capture/foundations.mjs\`._
`

await mkdir(OUT, { recursive: true })
await writeFile(join(OUT, 'Colors.mdx'), colorsMdx)
await writeFile(join(OUT, 'Typography.mdx'), typographyMdx)
await writeFile(join(OUT, 'ColorContrast.mdx'), contrastMdx)

console.log('\nFoundations generated:')
console.log(`  Colors.mdx         ${palette.length} colours (${textColors.length} text, ${bgColors.length} background)`)
console.log(`  Typography.mdx     ${typeScale.length} type styles, ${byFamily.length} families`)
console.log(`  ColorContrast.mdx  ${contrast.length} pairings — ${failing.length} fail AA, ${aaOnly.length} AA-only, ${suspect.length} need manual check`)
console.log()

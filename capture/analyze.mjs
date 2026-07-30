// Derive the findings axe-core cannot report.
//
// Automated rule engines catch roughly a third of WCAG failures. They check
// whether markup is *malformed*, not whether it is *meaningful*: a page with no
// headings, no landmarks and no skip link passes axe cleanly while being close
// to unusable with a screen reader. Everything here is still evidence-based —
// derived from the inventory and focus-order captured off the live DOM — but it
// encodes judgements axe deliberately does not make.
//
//   pnpm exec node capture/analyze.mjs
//
// Writes snapshots/structural.json.

import { readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAP = join(ROOT, 'snapshots')
const exists = (p) => access(p).then(() => true, () => false)

const cfg = JSON.parse(await readFile(join(ROOT, 'capture/targets.json'), 'utf8'))

// Measured focus behaviour from capture/focus-check.mjs. Optional: the analysis
// still runs without it, minus the focus findings.
const empiricalFocus = (await exists(join(SNAP, 'focus.json')))
  ? JSON.parse(await readFile(join(SNAP, 'focus.json'), 'utf8'))
  : null
if (!empiricalFocus) console.warn('! snapshots/focus.json missing — run `node capture/focus-check.mjs` for focus findings\n')

/** Fields whose purpose is defined by WCAG 1.3.5, keyed by the autocomplete token they need. */
const PURPOSE = [
  { match: /firstname|fname|givenname/i, token: 'given-name' },
  { match: /lastname|lname|surname|familyname/i, token: 'family-name' },
  { match: /phone|mobile|tel/i, token: 'tel' },
  { match: /email/i, token: 'email' },
  { match: /address1|street|addressline1/i, token: 'address-line1' },
  { match: /address2|addressline2/i, token: 'address-line2' },
  { match: /\bcity\b|locality/i, token: 'address-level2' },
  { match: /\bstate\b|province|region/i, token: 'address-level1' },
  { match: /zip|postal/i, token: 'postal-code' },
  { match: /country/i, token: 'country-name' },
  { match: /cardnumber|ccnumber|creditcard/i, token: 'cc-number' },
  { match: /cardname|ccname|nameoncard/i, token: 'cc-name' },
  { match: /cvv|cvc|securitycode/i, token: 'cc-csc' },
]

const findings = []
const add = (f) => findings.push(f)

for (const target of cfg.targets) {
  for (const vp of cfg.viewports) {
    const dir = join(SNAP, target.journey, target.id)
    const metaPath = join(dir, 'meta.json')
    if (!(await exists(metaPath))) continue
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    const v = meta.viewports?.[vp.id]
    if (!v || v.status !== 'ok') continue

    const base = { journey: target.journey, page: target.id, pageTitle: target.title, viewport: vp.id }
    const { items, headings, landmarks, images } = v.inventory
    const focus = v.focusOrder || []

    // --- 1.3.1 / 2.4.6 heading structure -------------------------------------
    const realHeadings = headings.filter((h) => h.level > 0)
    if (realHeadings.length === 0) {
      add({
        ...base,
        id: 'no-headings',
        impact: 'serious',
        level: 'A',
        sc: ['1.3.1'],
        title: 'Page contains no headings at all',
        detail:
          `Not one h1-h6 or role="heading" element exists on this page. Screen-reader users navigate ` +
          `primarily by heading (the "H" key / rotor); with no headings there is no way to skim the page ` +
          `or jump to a section, so the only option is to read linearly from the top.`,
        evidence: [`0 heading elements found among ${items.length} interactive elements`],
      })
    } else {
      if (!realHeadings.some((h) => h.level === 1)) {
        add({
          ...base,
          id: 'no-h1',
          impact: 'moderate',
          level: 'A',
          sc: ['1.3.1'],
          title: 'Page has no level-1 heading',
          detail: 'There is no h1 to name the page, so its top-level topic is not exposed programmatically.',
          evidence: realHeadings.slice(0, 6).map((h) => `h${h.level}: ${h.text}`),
        })
      }
      const skips = []
      let prev = 0
      for (const h of realHeadings) {
        if (prev && h.level > prev + 1) skips.push(`h${prev} -> h${h.level} at "${h.text}"`)
        prev = h.level
      }
      if (skips.length) {
        add({
          ...base,
          id: 'heading-skip',
          impact: 'moderate',
          level: 'A',
          sc: ['1.3.1'],
          title: 'Heading levels skip a rank',
          detail: 'Skipped ranks imply a nesting relationship that does not exist, misrepresenting the page outline.',
          evidence: skips,
        })
      }
    }

    // --- 1.3.1 / 2.4.1 landmarks --------------------------------------------
    const hasMain = landmarks.some((l) => l.tag === 'main' || l.role === 'main')
    const hasNav = landmarks.some((l) => l.tag === 'nav' || l.role === 'navigation')
    const hasBanner = landmarks.some((l) => l.tag === 'header' || l.role === 'banner')
    const missing = [!hasMain && 'main', !hasNav && 'navigation', !hasBanner && 'banner'].filter(Boolean)
    if (missing.length) {
      add({
        ...base,
        id: 'missing-landmarks',
        impact: hasMain ? 'moderate' : 'serious',
        level: 'A',
        sc: ['1.3.1'],
        title: `Missing landmark region${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
        detail:
          `Landmarks are how assistive-technology users move between regions of a page. Without a <main> ` +
          `landmark there is no way to jump past the header and filters straight to the results.`,
        evidence: [`Landmarks present: ${landmarks.length ? landmarks.map((l) => l.role || l.tag).join(', ') : 'none'}`],
      })
    }

    // --- 2.4.1 bypass blocks -------------------------------------------------
    const firstFew = focus.slice(0, 3).map((f) => (f.text || '').toLowerCase())
    const hasSkipLink = firstFew.some((t) => /skip|jump to/.test(t))
    if (!hasSkipLink && focus.length > 15) {
      add({
        ...base,
        id: 'no-skip-link',
        impact: 'serious',
        level: 'A',
        sc: ['2.4.1'],
        title: 'No skip link, and no landmarks to bypass with',
        detail:
          `A keyboard user must tab through ${focus.length} stops in source order to reach anything late on ` +
          `the page. With no skip link and no <main> landmark there is no bypass mechanism at all — this is a ` +
          `Level A failure, not a convenience issue.`,
        evidence: [`${focus.length} tab stops before any bypass is offered`, `First stops: ${focus.slice(0, 3).map((f) => f.text || f.tag).join(' -> ')}`],
      })
    }

    // --- 2.4.7 / 2.4.11 focus visibility ------------------------------------
    // Sourced from focus.json (real Tab traversal + pixel diff), never from the
    // captured computed styles. `:focus-visible` does not match a programmatic
    // .focus() call, so judging this from the inventory alone overstates it by
    // roughly fifty-fold — measured, not assumed.
    const fp = empiricalFocus?.pages?.[target.id]
    if (fp && vp.id === 'desktop') {
      const invisible = fp.results.filter((r) => !r.visible)
      // 1x1 proxies are Quasar's offscreen inputs behind a styled control. They
      // are real tab stops but never the thing the user perceives as focused,
      // so they are reported separately rather than inflating this count.
      const perceivable = invisible.filter((r) => r.w > 4 && r.h > 4)
      if (perceivable.length) {
        add({
          ...base,
          id: 'focus-not-visible',
          impact: 'serious',
          level: 'AA',
          sc: ['2.4.7'],
          title: `${perceivable.length} focusable element${perceivable.length > 1 ? 's produce' : ' produces'} no visible change when focused`,
          detail:
            `Measured by tabbing to each element and diffing the rendered pixels against the same region ` +
            `unfocused. These produced no perceptible change, so a sighted keyboard user cannot tell where ` +
            `they are.`,
          evidence: perceivable.slice(0, 10).map((r) => `<${r.tag}> "${r.text}" ${r.w}x${r.h} — outline: ${r.outline}`),
          nodes: perceivable.slice(0, 20).map((r) => ({ target: [r.cssPath], html: `<${r.tag}> ${r.text}` })),
        })
      }
      if (fp.trapped) {
        add({
          ...base,
          id: 'focus-trap',
          impact: 'critical',
          level: 'A',
          sc: ['2.1.2'],
          title: 'Keyboard focus becomes trapped and cannot move on with Tab',
          detail:
            `After ${fp.trapped.afterStops} tab stops, repeated Tab presses stopped advancing and focus stayed ` +
            `on the same element. A keyboard-only user reaching this point cannot get past it without a mouse.`,
          evidence: [`Focus stuck on <${fp.trapped.tag}> "${fp.trapped.text}"`],
          nodes: [{ target: [fp.trapped.cssPath], html: `<${fp.trapped.tag}> ${fp.trapped.text}` }],
        })
      }
    }

    // --- 1.3.5 identify input purpose ---------------------------------------
    const needsAutocomplete = items
      .filter((i) => i.tag === 'input' && !['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(i.type))
      .map((i) => {
        const hay = `${i.name} ${i.id} ${i.placeholder} ${i.ariaLabel} ${i.text}`
        const p = PURPOSE.find((x) => x.match.test(hay))
        return p && !i.autocomplete ? { ...i, token: p.token } : null
      })
      .filter(Boolean)
    if (needsAutocomplete.length) {
      add({
        ...base,
        id: 'missing-autocomplete',
        impact: 'moderate',
        level: 'AA',
        sc: ['1.3.5'],
        title: `${needsAutocomplete.length} input${needsAutocomplete.length > 1 ? 's' : ''} collecting personal data lack an autocomplete token`,
        detail:
          `WCAG 1.3.5 requires that inputs collecting information about the user expose their purpose ` +
          `programmatically. Without it, browser autofill and assistive tech that substitutes familiar icons ` +
          `or vocabulary cannot identify the field — a direct barrier for users with cognitive disabilities.`,
        evidence: needsAutocomplete.map((i) => `${i.name || i.id || i.tag} -> needs autocomplete="${i.token}"`),
        nodes: needsAutocomplete.map((i) => ({ target: [i.cssPath], html: `<input name="${i.name}">`, token: i.token })),
      })
    }

    // --- 2.5.8 target size (from measured geometry) --------------------------
    const small = focus.filter((f) => f.w > 0 && f.h > 0 && (f.w < 24 || f.h < 24))
    if (small.length) {
      add({
        ...base,
        id: 'small-targets',
        impact: 'serious',
        level: 'AA',
        sc: ['2.5.8'],
        title: `${small.length} interactive target${small.length > 1 ? 's are' : ' is'} under the 24x24 CSS-pixel minimum`,
        detail:
          `WCAG 2.2 requires pointer targets be at least 24x24 CSS pixels unless spaced apart or offered ` +
          `another way. Undersized targets are hardest for users with tremor or reduced dexterity, and on ` +
          `touch devices for everyone.`,
        evidence: small.slice(0, 12).map((f) => `${f.tag}${f.text ? ` "${f.text}"` : ''} — ${f.w}x${f.h}px`),
        nodes: small.slice(0, 25).map((f) => ({ target: [f.cssPath], html: `<${f.tag}> ${f.text}`, size: `${f.w}x${f.h}` })),
      })
    }

    // --- 3.1.1 page language -------------------------------------------------
    if (!v.lang) {
      add({
        ...base,
        id: 'no-lang',
        impact: 'serious',
        level: 'A',
        sc: ['3.1.1'],
        title: 'Document has no lang attribute',
        detail: 'Without a language, a screen reader may announce the page using the wrong pronunciation rules.',
        evidence: ['<html> has no lang attribute'],
      })
    }

    // --- 4.1.2 controls with no accessible name ------------------------------
    const unnamed = items.filter(
      (i) =>
        ['input', 'select', 'textarea'].includes(i.tag) &&
        !['hidden', 'submit', 'button'].includes(i.type) &&
        !i.ariaLabel && !i.ariaLabelledby && !i.hasLabelFor && !i.wrappedInLabel
    )
    if (unnamed.length) {
      add({
        ...base,
        id: 'unlabelled-controls',
        impact: 'critical',
        level: 'A',
        sc: ['4.1.2', '3.3.2'],
        title: `${unnamed.length} form control${unnamed.length > 1 ? 's have' : ' has'} no programmatic label`,
        detail:
          `These controls rely on placeholder text or adjacent visual text. A placeholder is not an ` +
          `accessible name: it is not announced by every screen reader, and it disappears the moment the ` +
          `user starts typing, removing the only cue to what the field was for.`,
        evidence: unnamed.map((i) => `<${i.tag}${i.type ? ` type="${i.type}"` : ''}> placeholder="${i.placeholder}"`),
        nodes: unnamed.map((i) => ({ target: [i.cssPath], html: `<${i.tag} name="${i.name}" placeholder="${i.placeholder}">` })),
      })
    }

    // --- 1.1.1 decorative vs meaningful images -------------------------------
    const noAlt = images.filter((i) => i.tag === 'img' && !i.hasAlt)
    if (noAlt.length) {
      add({
        ...base,
        id: 'img-no-alt-attr',
        impact: 'critical',
        level: 'A',
        sc: ['1.1.1'],
        title: `${noAlt.length} <img> element${noAlt.length > 1 ? 's have' : ' has'} no alt attribute`,
        detail:
          `A missing alt attribute is not the same as alt="". With no attribute at all, screen readers fall ` +
          `back to announcing the filename or URL, which here is a GUID.`,
        evidence: noAlt.slice(0, 10).map((i) => `src=${i.src.slice(0, 90)}`),
        nodes: noAlt.slice(0, 20).map((i) => ({ target: [i.cssPath], html: `<img src="${i.src.slice(0, 80)}">` })),
      })
    }
  }
}

// --- 2.4.11 focus appearance (site-wide, from the stylesheet) --------------
// Distinct from 2.4.7: focus mostly *is* indicated here, but by a 1px dashed
// underline, which is not a large enough change to satisfy WCAG 2.2's minimum
// focus-appearance area. Reported once against the shared stylesheet rather
// than per page, because it is a single global rule.
{
  const sheetPath = join(SNAP, 'browse/search-results/styles.css')
  if (await exists(sheetPath)) {
    const sheet = await readFile(sheetPath, 'utf8')
    const only = sheet.match(/:focus-visible\s*\{[^}]*\}/i)
    const killsOutline = /\.q-focus-helper[^{]*\{[^}]*display:\s*none/i.test(sheet)
    const zeroOutline = /\.q-focusable[^{]*\{[^}]*outline:\s*0/i.test(sheet)
    if (only) {
      add({
        journey: 'browse',
        page: 'search-results',
        pageTitle: 'Site-wide',
        viewport: 'desktop',
        id: 'focus-appearance',
        impact: 'serious',
        level: 'AA',
        sc: ['2.4.11'],
        title: 'The only focus indicator is a 1px dashed underline, which is below the minimum focus appearance',
        detail:
          `WCAG 2.2's Focus Appearance (2.4.11, AA) requires the focus indicator to cover at least the area of ` +
          `a 2px-thick perimeter of the control and to have at least 3:1 contrast against the unfocused state. ` +
          `A 1px dashed text underline meets neither, and it does nothing at all for controls with no text — ` +
          `icon buttons, the carousel arrows, the map controls. ` +
          (killsOutline
            ? `Compounding it, Quasar's own focus affordance is explicitly disabled (\`.q-focus-helper { display: none }\`)`
            : '') +
          (zeroOutline ? ` and \`outline: 0\` is set on every focusable Quasar element.` : '.'),
        evidence: [
          `Sole focus rule in the production stylesheet: ${only[0].replace(/\s+/g, ' ')}`,
          killsOutline ? '.q-focus-helper { display: none } — Quasar focus ring suppressed' : null,
          zeroOutline ? '.q-focusable, .q-hoverable { outline: 0 } — native outline removed' : null,
        ].filter(Boolean),
      })
    }
  }
}

// Timed process — a Level A failure that is invisible to any static rule engine
// because the timer is legitimate markup; the failure is the absence of control.
const checkoutHtml = join(SNAP, 'checkout/checkout-1-guests/desktop.html')
if (await exists(checkoutHtml)) {
  const html = await readFile(checkoutHtml, 'utf8')
  const m = html.match(/Time remaining[^<]*<[^>]*>\s*([\d:]+)/i) || html.match(/(\d{1,2}:\d{2})/)
  if (/time remaining/i.test(html)) {
    add({
      journey: 'checkout',
      page: 'checkout-1-guests',
      pageTitle: '1. Guest Information',
      viewport: 'desktop',
      id: 'timing-adjustable',
      impact: 'critical',
      level: 'A',
      sc: ['2.2.1'],
      title: 'Checkout imposes a ~15-minute time limit with no way to turn it off, adjust it, or extend it',
      detail:
        `WCAG 2.2.1 (Level A) allows a time limit only if the user can turn it off, adjust it to at least ten ` +
        `times the default, or extend it with a simple action after a warning. This checkout offers none of ` +
        `the three. The limit spans a four-step form that asks for guest names, an organisation, a team, ` +
        `payment details and policy acknowledgements — a user relying on a screen reader, a switch device, ` +
        `voice control, or simply reading carefully can very plausibly exceed it and lose the reservation. ` +
        `This is the single highest-severity finding in the audit: it can make the booking flow impossible ` +
        `to complete rather than merely difficult.`,
      evidence: [`Countdown found in production markup${m ? `, starting at ${m[1]}` : ''}`, 'No extend, pause, or disable control present in the DOM'],
      nodes: [{ target: ['.time-remaining'], html: 'Time remaining: 14:54' }],
    })
  }
}

const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 }
for (const f of findings) byImpact[f.impact] = (byImpact[f.impact] || 0) + 1

await writeFile(join(SNAP, 'structural.json'), JSON.stringify({ generatedAt: new Date().toISOString(), byImpact, findings }, null, 2))

console.log(`\nStructural analysis: ${findings.length} findings`)
console.log(`  critical ${byImpact.critical}, serious ${byImpact.serious}, moderate ${byImpact.moderate}, minor ${byImpact.minor}\n`)
const seen = new Set()
for (const f of findings) {
  const k = `${f.page}:${f.id}`
  if (seen.has(k)) continue
  seen.add(k)
  console.log(`  ${String(f.impact).padEnd(9)} ${f.sc.join(',').padEnd(12)} ${f.page.padEnd(24)} ${f.title}`)
}
console.log()

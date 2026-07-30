// Extract the design tokens the production journey actually uses, and score
// every real colour pairing against WCAG contrast.
//
//   node capture/tokens.mjs
//
// Writes snapshots/tokens.json.
//
// Why computed styles rather than the stylesheet
// ----------------------------------------------
// Parsing CSS would enumerate every colour the codebase *declares* — including
// dead rules, Quasar defaults that nothing instantiates, and utility classes no
// template applies. That produces a palette nobody sees and a contrast matrix
// full of pairings that never occur.
//
// Instead this walks the rendered DOM and records what each visible text node is
// actually painted with. A pairing appears here only if a real element really
// renders that foreground on that background, and the occurrence count tells you
// how much of the UI a given fix would move.

import { chromium, devices } from 'playwright'
import { readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAP = join(ROOT, 'snapshots')
const exists = (p) => access(p).then(() => true, () => false)

const cfg = JSON.parse(await readFile(join(ROOT, 'capture/targets.json'), 'utf8'))
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'))

// --- colour maths ----------------------------------------------------------

/** Parse `rgb()` / `rgba()` as produced by getComputedStyle. */
function parseRgb(s) {
  const m = String(s).match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(/[,/]/).map((x) => parseFloat(x.trim()))
  if (p.length < 3 || p.some(Number.isNaN)) return null
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
}

const hex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

/** Composite a possibly-translucent colour over an opaque backdrop. */
function over(fg, bg) {
  if (fg.a >= 1) return { ...fg, a: 1 }
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

/** WCAG relative luminance (sRGB). */
function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG contrast ratio, 1–21. */
function contrast(a, b) {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * WCAG "large text": >= 24px, or >= 18.66px when bold.
 * Large text gets the relaxed 3:1 (AA) / 4.5:1 (AAA) thresholds.
 */
const isLarge = (px, weight) => px >= 24 || (px >= 18.66 && Number(weight) >= 700)

function verdicts(ratio, large) {
  const aaMin = large ? 3 : 4.5
  const aaaMin = large ? 4.5 : 7
  return { aa: ratio >= aaMin, aaa: ratio >= aaaMin, aaMin, aaaMin }
}

// --- in-page collection ----------------------------------------------------

/**
 * Record the painted style of every visible text-bearing element.
 *
 * Runs inside the snapshot's shadow root. Background is resolved by walking
 * ancestors until something opaque is found, compositing translucent layers on
 * the way — the same thing a browser does, and the reason a naive
 * `getComputedStyle(el).backgroundColor` (usually `rgba(0,0,0,0)`) is useless.
 */
const COLLECT = () => {
  const host = document.querySelector('[data-snapshot]')
  const root = host?.shadowRoot
  if (!root) return { text: [], error: 'no shadow root' }

  const parse = (s) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,/]/).map((x) => parseFloat(x.trim()))
    if (p.length < 3 || p.some(Number.isNaN)) return null
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const composite = (fg, bg) =>
    fg.a >= 1
      ? { ...fg, a: 1 }
      : {
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
          a: 1,
        }

  /** Effective backdrop behind an element, or a flag if an image intervenes. */
  function backdrop(el) {
    let acc = null // topmost translucent layers, composited downward
    let node = el
    while (node && node !== root) {
      const cs = getComputedStyle(node)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') {
        return { image: true, css: cs.backgroundImage.slice(0, 60) }
      }
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) {
        acc = acc ? composite(acc, c) : c
        if (acc.a >= 1 || c.a >= 1) return { color: acc.a >= 1 ? acc : composite(acc, { r: 255, g: 255, b: 255, a: 1 }) }
      }
      node = node.parentElement || node.getRootNode()?.host
      if (node === document.documentElement) break
    }
    // Nothing opaque found — the snapshot host paints white.
    const white = { r: 255, g: 255, b: 255, a: 1 }
    return { color: acc ? composite(acc, white) : white }
  }

  const out = []
  const all = root.querySelectorAll('*')
  for (const el of all) {
    // Only elements that directly own visible text.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue.trim())
      .join(' ')
      .trim()
    if (!own) continue

    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue

    const fgRaw = parse(cs.color)
    if (!fgRaw) continue
    const bd = backdrop(el)
    const bg = bd.color ?? null
    const fg = bg ? composite(fgRaw, bg) : { ...fgRaw, a: 1 }

    out.push({
      fg: [Math.round(fg.r), Math.round(fg.g), Math.round(fg.b)],
      bg: bg ? [Math.round(bg.r), Math.round(bg.g), Math.round(bg.b)] : null,
      bgImage: !!bd.image,
      fontSize: parseFloat(cs.fontSize) || 0,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      tag: el.tagName.toLowerCase(),
      sample: own.replace(/\s+/g, ' ').slice(0, 60),
      // Elements that are themselves interactive are exempt from 1.4.3 when
      // disabled; recorded so the report can note it.
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    })
  }
  return { text: out }
}

// --- driver ----------------------------------------------------------------

async function collectFor(browser, target, vp) {
  const dir = join(SNAP, target.journey, target.id)
  const htmlPath = join(dir, `${vp.id}.html`)
  if (!(await exists(htmlPath))) return null

  const markup = await readFile(htmlPath, 'utf8')
  const cssPath = (await exists(join(dir, `${vp.id}.css`))) ? join(dir, `${vp.id}.css`) : join(dir, 'styles.css')
  const sheet = (await exists(cssPath)) ? await readFile(cssPath, 'utf8') : ''
  const fonts = (await exists(join(dir, 'fonts.css'))) ? await readFile(join(dir, 'fonts.css'), 'utf8') : ''
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  const bodyAttrs = meta.viewports?.[vp.id]?.bodyAttrs || {}

  const ctx = await browser.newContext({
    ...(vp.mobile ? devices['iPhone 14'] : {}),
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  await page.goto('about:blank')
  await page.evaluate(
    ({ markup, sheet, fonts, bodyAttrs }) => {
      if (fonts) {
        const f = document.createElement('style')
        f.textContent = fonts
        document.head.appendChild(f)
      }
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.setAttribute('data-snapshot', '1')
      host.style.cssText = 'background:#fff;display:block'
      document.body.appendChild(host)
      const root = host.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = `:host{all:initial;display:block;background:#fff}\n${sheet}`
      root.appendChild(style)
      const wrap = document.createElement('div')
      if (bodyAttrs.class) wrap.className = bodyAttrs.class
      if (bodyAttrs.style) wrap.setAttribute('style', bodyAttrs.style)
      wrap.innerHTML = markup
      root.appendChild(wrap)
    },
    { markup, sheet, fonts, bodyAttrs }
  )
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2000)

  const res = await page.evaluate(COLLECT)
  await ctx.close()
  return res
}

const browser = await chromium.launch()
const targets = cfg.targets.filter((t) => !filters.length || filters.some((f) => t.id.includes(f)))

const pairs = new Map() // fgHex|bgHex|large -> record
const colorUse = new Map() // hex -> {asText, asBg}
const typeUse = new Map() // family|size|weight -> record
const families = new Map()

console.log('\nExtracting design tokens from captured production pages\n')

for (const target of targets) {
  for (const vp of cfg.viewports) {
    const res = await collectFor(browser, target, vp)
    if (!res) continue
    if (res.error) {
      console.log(`  ${target.id}/${vp.id}: ${res.error}`)
      continue
    }
    console.log(`  ${target.id}/${vp.id}`.padEnd(44) + `${res.text.length} text elements`)

    for (const t of res.text) {
      const fgHex = hex({ r: t.fg[0], g: t.fg[1], b: t.fg[2] })
      const bgHex = t.bg ? hex({ r: t.bg[0], g: t.bg[1], b: t.bg[2] }) : null

      // colour usage
      const cf = colorUse.get(fgHex) ?? { hex: fgHex, asText: 0, asBg: 0 }
      cf.asText++
      colorUse.set(fgHex, cf)
      if (bgHex) {
        const cb = colorUse.get(bgHex) ?? { hex: bgHex, asText: 0, asBg: 0 }
        cb.asBg++
        colorUse.set(bgHex, cb)
      }

      // type usage
      const size = Math.round(t.fontSize * 10) / 10
      const tk = `${t.fontFamily}|${size}|${t.fontWeight}`
      const tu = typeUse.get(tk) ?? {
        family: t.fontFamily,
        size,
        weight: t.fontWeight,
        lineHeight: t.lineHeight,
        letterSpacing: t.letterSpacing,
        count: 0,
        samples: [],
        tags: new Set(),
      }
      tu.count++
      tu.tags.add(t.tag)
      if (tu.samples.length < 3 && t.sample) tu.samples.push(t.sample)
      typeUse.set(tk, tu)
      families.set(t.fontFamily, (families.get(t.fontFamily) ?? 0) + 1)

      // contrast pairing — only where a solid backdrop was resolvable
      if (!bgHex) continue
      const large = isLarge(t.fontSize, t.fontWeight)
      const pk = `${fgHex}|${bgHex}|${large}`
      const p = pairs.get(pk) ?? {
        fg: fgHex,
        bg: bgHex,
        large,
        size,
        weight: t.fontWeight,
        count: 0,
        samples: [],
        pages: new Set(),
        overImage: 0,
        disabled: 0,
      }
      p.count++
      if (t.bgImage) p.overImage++
      if (t.disabled) p.disabled++
      p.pages.add(`${target.id}:${vp.id}`)
      if (p.samples.length < 3 && t.sample) p.samples.push(t.sample)
      pairs.set(pk, p)
    }
  }
}

await browser.close()

// --- score -----------------------------------------------------------------

const scored = [...pairs.values()]
  .map((p) => {
    const fg = parseRgb(`rgb(${parseInt(p.fg.slice(1, 3), 16)},${parseInt(p.fg.slice(3, 5), 16)},${parseInt(p.fg.slice(5, 7), 16)})`)
    const bg = parseRgb(`rgb(${parseInt(p.bg.slice(1, 3), 16)},${parseInt(p.bg.slice(3, 5), 16)},${parseInt(p.bg.slice(5, 7), 16)})`)
    const ratio = Math.round(contrast(fg, bg) * 100) / 100
    const v = verdicts(ratio, p.large)
    return { ...p, pages: [...p.pages], ratio, ...v }
  })
  .sort((a, b) => (a.aa === b.aa ? b.count - a.count : a.aa ? 1 : -1))

const typeScale = [...typeUse.values()]
  .map((t) => ({ ...t, tags: [...t.tags] }))
  .sort((a, b) => b.size - a.size || b.count - a.count)

const palette = [...colorUse.values()].sort((a, b) => b.asText + b.asBg - (a.asText + a.asBg))

const summary = {
  pairs: scored.length,
  failAA: scored.filter((p) => !p.aa).length,
  failAAA: scored.filter((p) => p.aa && !p.aaa).length,
  passAAA: scored.filter((p) => p.aaa).length,
  elementsFailingAA: scored.filter((p) => !p.aa).reduce((a, p) => a + p.count, 0),
  distinctColors: palette.length,
  typeStyles: typeScale.length,
  families: [...families.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  smallestSize: typeScale.length ? Math.min(...typeScale.map((t) => t.size)) : 0,
}

await writeFile(
  join(SNAP, 'tokens.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), summary, palette, typeScale, contrast: scored }, null, 2)
)

console.log(`\n  ${summary.distinctColors} distinct colours, ${summary.typeStyles} type styles`)
console.log(`  ${summary.pairs} real colour pairings — ${summary.failAA} fail AA, ${summary.failAAA} pass AA but fail AAA`)
console.log(`  ${summary.elementsFailingAA} text elements render below AA`)
console.log(`  families: ${summary.families.map((f) => f.name).join(', ')}`)
console.log('\nWrote snapshots/tokens.json\n')

// Empirical focus-visibility test.
//
// Whether a focus indicator is *visible* cannot be settled by reading computed
// styles. Two things defeat that approach:
//
//   1. `:focus-visible` does not match on a programmatic `.focus()` call — only
//      on real keyboard interaction — so a style-only check reports false
//      failures on any component styled that way.
//   2. A component may indicate focus by animating a *child* element (Quasar's
//      `.q-focus-helper`) rather than changing any property of the focused
//      element itself, which a style-only check reports as a false pass.
//
// So this walks the page with real Tab presses and diffs rendered pixels.
//
// It runs in two passes rather than blurring between screenshots. Blurring
// mid-traversal means having to restore focus to continue tabbing, and any
// restore-by-index is wrong the moment tabindex, iframes or widget-internal
// focus management reorder things — the traversal silently sticks on one
// element and reports it dozens of times. Pass A tabs through and records
// geometry; pass B reloads and re-shoots the same clips with nothing focused.
//
//   node capture/focus-check.mjs [targetId]
//
// Writes snapshots/focus.json.

import { chromium } from 'playwright'
import { readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAP = join(ROOT, 'snapshots')

const MAX_STOPS = 80
const VIEW = { width: 1440, height: 900 }
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const cfg = JSON.parse(await readFile(join(ROOT, 'capture/targets.json'), 'utf8'))

/** Fraction of differing bytes between two PNG buffers of the same clip. */
function diffRatio(a, b) {
  if (!a || !b) return 0
  if (a.length !== b.length) return 1
  let diff = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
  return diff / a.length
}

async function openPage(ctx, target) {
  const page = await ctx.newPage()
  await page.goto(target.url || target.flow.start, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(target.settleMs ?? 3000)
  if (target.flow?.steps) {
    for (const step of target.flow.steps) {
      if (step.click) {
        const el = page.getByText(step.click, { exact: true }).first()
        if (await el.count()) await el.click({ timeout: 10000 }).catch(() => {})
      }
      if (step.waitMs) await page.waitForTimeout(step.waitMs)
    }
    await page.waitForTimeout(2000)
  }
  await page.evaluate(() => {
    document.activeElement?.blur?.()
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(300)
  return page
}

/** Describe whatever currently holds focus, including inside open shadow roots. */
const DESCRIBE_ACTIVE = () => {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
  if (!el || el === document.body || el === document.documentElement) return null

  const path = []
  for (let n = el; n && n.nodeType === 1 && path.length < 10; n = n.parentElement) {
    const tag = n.tagName.toLowerCase()
    if (tag === 'html' || tag === 'body') break
    const sib = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : []
    path.unshift(sib.length > 1 ? `${tag}:nth-of-type(${sib.indexOf(n) + 1})` : tag)
  }

  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    inIframe: false,
    cssPath: path.join('>'),
    x: r.x, y: r.y, w: r.width, h: r.height,
    scrollY: window.scrollY,
  }
}

const PAD = 6
function clipFor(info) {
  const x = Math.max(0, Math.floor(info.x - PAD))
  const y = Math.max(0, Math.floor(info.y - PAD))
  return {
    x,
    y,
    width: Math.max(1, Math.min(VIEW.width - x, Math.ceil(info.w + PAD * 2))),
    height: Math.max(1, Math.min(VIEW.height - y, Math.ceil(info.h + PAD * 2))),
  }
}

async function checkPage(browser, target) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 })
  try {
    // ---- Pass A: tab through, screenshot each focused element ----------------
    const page = await openPage(ctx, target)
    const stops = []
    let repeat = 0
    let trapped = null

    for (let i = 0; i < MAX_STOPS; i++) {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(110)
      const info = await page.evaluate(DESCRIBE_ACTIVE)
      if (!info || info.w === 0 || info.h === 0) continue

      // Landing on the same element repeatedly means Tab is no longer advancing
      // — a focus trap. That is itself a WCAG 2.1.2 failure, and continuing
      // would fabricate dozens of duplicate findings.
      const prev = stops[stops.length - 1]
      if (prev && prev.cssPath === info.cssPath && prev.scrollY === info.scrollY) {
        if (++repeat >= 3) {
          trapped = { cssPath: info.cssPath, tag: info.tag, text: info.text, afterStops: stops.length }
          break
        }
        continue
      }
      repeat = 0

      const clip = clipFor(info)
      const shot = await page.screenshot({ clip }).catch(() => null)
      stops.push({ index: stops.length + 1, ...info, clip, focusedShot: shot })
    }
    await page.close()

    // ---- Pass B: same clips, nothing focused --------------------------------
    const page2 = await openPage(ctx, target)
    const results = []
    for (const s of stops) {
      await page2.evaluate((y) => window.scrollTo(0, y), s.scrollY)
      await page2.waitForTimeout(90)
      const base = await page2.screenshot({ clip: s.clip }).catch(() => null)
      const ratio = diffRatio(s.focusedShot, base)
      results.push({
        index: s.index,
        tag: s.tag,
        text: s.text,
        outline: s.outline,
        cssPath: s.cssPath,
        w: Math.round(s.w),
        h: Math.round(s.h),
        diffRatio: Number(ratio.toFixed(4)),
        // A few differing bytes is antialiasing noise; a real indicator moves a
        // meaningful share of the clip.
        visible: ratio > 0.01,
      })
    }
    await page2.close()
    await ctx.close()
    return { results, trapped }
  } catch (err) {
    await ctx.close()
    return { error: String(err.message || err).slice(0, 200) }
  }
}

const browser = await chromium.launch()
const targets = cfg.targets.filter(
  (t) => (t.url || t.flow?.start) && (!filters.length || filters.some((f) => t.id.includes(f)))
)
const out = {}

console.log('\nEmpirical focus-visibility check — real Tab traversal, two-pass pixel diff\n')

for (const target of targets) {
  const res = await checkPage(browser, target)
  if (res.error) {
    console.log(`  ${target.id.padEnd(24)} SKIPPED  ${res.error}`)
    continue
  }
  const { results, trapped } = res
  const invisible = results.filter((r) => !r.visible)
  out[target.id] = {
    journey: target.journey,
    title: target.title,
    stops: results.length,
    invisible: invisible.length,
    trapped,
    results,
  }
  console.log(`  ${target.id.padEnd(24)} ${String(results.length).padStart(3)} stops, ${String(invisible.length).padStart(3)} with no visible focus change`)
  if (trapped) console.log(`      FOCUS TRAP after ${trapped.afterStops} stops on <${trapped.tag}> "${trapped.text}"`)
  for (const r of invisible.slice(0, 5)) {
    console.log(`      - <${r.tag}> "${r.text.slice(0, 32)}" ${r.w}x${r.h} outline:[${r.outline}]`)
  }
}

await browser.close()

// A filtered run must not drop the pages it did not walk: merge over whatever is
// already on disk so `node capture/focus-check.mjs event-landing` adds a page
// rather than replacing the whole file.
let merged = out
if (filters.length && (await access(join(SNAP, 'focus.json')).then(() => true, () => false))) {
  const prev = JSON.parse(await readFile(join(SNAP, 'focus.json'), 'utf8')).pages ?? {}
  merged = { ...prev, ...out }
  const carried = Object.keys(prev).filter((k) => !(k in out)).length
  if (carried) console.log(`(carried forward ${carried} page(s) from a previous run)`)
}

await writeFile(join(SNAP, 'focus.json'), JSON.stringify({ generatedAt: new Date().toISOString(), pages: merged }, null, 2))
console.log('\nWrote snapshots/focus.json\n')

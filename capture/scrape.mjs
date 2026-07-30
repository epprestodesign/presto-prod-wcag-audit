// Capture production pages into replayable snapshots.
//
//   pnpm capture                 all targets, all viewports
//   pnpm capture -- search       only targets whose id matches
//   pnpm capture -- --viewport=mobile
//
// Writes snapshots/<journey>/<id>/<viewport>.{html,css,png} plus a per-target
// meta.json holding the element inventory and keyboard focus order.

import { chromium, devices } from 'playwright'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import * as B from './lib/browser.mjs'
import { sanitizeHtml, extractBodyInner, extractBodyAttrs, cssForShadow, splitFontFaces } from './lib/sanitize.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAP = join(ROOT, 'snapshots')

const argv = process.argv.slice(2)
const filters = argv.filter((a) => !a.startsWith('--'))
const only = argv.find((a) => a.startsWith('--viewport='))?.split('=')[1]

// Synthetic identity used to advance multi-step forms. Never a real person.
const FIXTURE = {
  firstName: 'Audit',
  lastName: 'Tester',
  phone: '5555550123',
  org: 'Accessibility Audit',
  team: 'A11y Test Team',
}

const cfg = JSON.parse(await readFile(join(ROOT, 'capture/targets.json'), 'utf8'))
const exists = async (p) => access(p).then(() => true, () => false)

/** Re-fetch stylesheets the page blocked us from reading via CSSOM. */
async function resolveDeferred(sheets) {
  return Promise.all(
    sheets.map(async (s) => {
      if (s.kind !== 'deferred') return s
      try {
        const res = await fetch(s.href)
        return { ...s, css: res.ok ? await res.text() : '', kind: 'fetched' }
      } catch {
        return { ...s, css: '' }
      }
    })
  )
}

/** Click by visible text, preferring a real control over any text node. */
async function clickByText(page, text) {
  const candidates = [
    page.getByRole('button', { name: text, exact: true }),
    page.getByRole('link', { name: text, exact: true }),
    page.getByText(text, { exact: true }),
  ]
  for (const c of candidates) {
    if ((await c.count()) > 0) {
      const el = c.first()
      await el.scrollIntoViewIfNeeded().catch(() => {})
      await el.click({ timeout: 10000 })
      return true
    }
  }
  return false
}

async function runFlow(page, flow) {
  for (const step of flow.steps || []) {
    if (step.click) {
      const ok = await clickByText(page, step.click)
      if (!ok) console.warn(`      ! flow step "click: ${step.click}" found no match`)
    }
    if (step.fill) {
      for (const [sel, val] of Object.entries(step.fill)) {
        const v = val.replace(/\{\{(\w+)\}\}/g, (_, k) => FIXTURE[k] ?? '')
        await page.fill(sel, v).catch(() => console.warn(`      ! could not fill ${sel}`))
      }
    }
    if (step.select) {
      for (const [sel, val] of Object.entries(step.select)) {
        await page.selectOption(sel, val).catch(() => console.warn(`      ! could not select ${sel}`))
      }
    }
    if (step.waitMs) await page.waitForTimeout(step.waitMs)
  }
}

async function captureOne(browser, target, viewport) {
  const ctx = await browser.newContext({
    // Spread the device profile first (touch + mobile UA), then pin the exact
    // viewport the audit is specified against so the device preset can't widen it.
    ...(viewport.mobile ? devices['iPhone 14'] : {}),
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    storageState:
      target.auth === 'session' && (await exists(join(ROOT, 'capture/auth.json')))
        ? join(ROOT, 'capture/auth.json')
        : undefined,
  })
  const page = await ctx.newPage()

  const entry = target.url || target.flow?.start
  if (!entry) {
    await ctx.close()
    return { status: 'pending', reason: target.note || 'No URL configured' }
  }

  try {
    await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
    await page.waitForTimeout(target.settleMs ?? 3000)

    if (target.flow) {
      await runFlow(page, target.flow)
      await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {})
      await page.waitForTimeout(1500)
    }

    const finalUrl = page.url()
    const dom = await page.evaluate(B.extractDom)
    const rawSheets = await resolveDeferred(await page.evaluate(B.extractStyles))
    const inventory = await page.evaluate(B.extractInventory)
    const focusOrder = await page.evaluate(B.extractFocusOrder)

    // Re-focus nothing before screenshotting: extractFocusOrder left focus on
    // the last control, which would bake a stray focus ring into the image.
    await page.evaluate(() => document.activeElement?.blur?.())

    const dir = join(SNAP, target.journey, target.id)
    await mkdir(dir, { recursive: true })

    const redact = Object.values(FIXTURE)
    const cleanDoc = sanitizeHtml(dom.html, { baseUrl: finalUrl, redact })
    const bodyInner = extractBodyInner(cleanDoc)
    const bodyAttrs = extractBodyAttrs(cleanDoc)

    const joined = rawSheets.map((s) => (s.media && s.media !== 'all' ? `@media ${s.media}{\n${s.css}\n}` : s.css)).join('\n\n')
    const { fontFaces, css: bodyCss } = splitFontFaces(joined)
    const shadowCss = cssForShadow(bodyCss, finalUrl)

    await writeFile(join(dir, `${viewport.id}.html`), bodyInner)

    // Stylesheets are viewport-independent — the breakpoints live inside them
    // as media queries — so the desktop and mobile captures are normally
    // byte-identical. Store one shared copy and only emit a viewport-specific
    // override on the rare occasion the server actually served something else.
    const sharedPath = join(dir, 'styles.css')
    const shared = (await exists(sharedPath)) ? await readFile(sharedPath, 'utf8') : null
    if (shared === null) {
      await writeFile(sharedPath, shadowCss)
    } else if (shared !== shadowCss) {
      await writeFile(join(dir, `${viewport.id}.css`), shadowCss)
    }

    if (fontFaces.trim()) await writeFile(join(dir, 'fonts.css'), fontFaces)
    // JPEG, not PNG: a full-page capture of these pages is ~6.5MB as lossless
    // PNG, which across every target and viewport would dominate the repo. The
    // screenshot is a visual reference for the written findings, not the audit
    // surface itself — axe runs against the live snapshot, not the image.
    await page.screenshot({ path: join(dir, `${viewport.id}.jpg`), fullPage: true, type: 'jpeg', quality: 80 })

    await ctx.close()
    return {
      status: 'ok',
      finalUrl,
      lang: dom.lang,
      title: dom.title,
      bodyAttrs,
      bytes: { html: bodyInner.length, css: shadowCss.length },
      inventory,
      focusOrder,
    }
  } catch (err) {
    await ctx.close()
    return { status: 'error', reason: String(err.message || err).slice(0, 300) }
  }
}

const browser = await chromium.launch()
const targets = cfg.targets.filter((t) => !filters.length || filters.some((f) => t.id.includes(f)))
const viewports = cfg.viewports.filter((v) => !only || v.id === only)
const summary = []

console.log(`\nCapturing ${targets.length} target(s) x ${viewports.length} viewport(s)\n`)

for (const target of targets) {
  console.log(`  ${target.journey}/${target.id}`)
  const perViewport = {}
  for (const vp of viewports) {
    const res = await captureOne(browser, target, vp)
    perViewport[vp.id] = res
    const detail =
      res.status === 'ok'
        ? `${(res.bytes.html / 1024).toFixed(0)}kb html, ${(res.bytes.css / 1024).toFixed(0)}kb css, ` +
          `${res.inventory.items.length} controls, ${res.focusOrder.length} tab stops`
        : res.reason
    console.log(`    ${vp.id.padEnd(8)} ${res.status === 'ok' ? 'OK' : res.status.toUpperCase()}  ${detail}`)
  }

  const meta = {
    ...target,
    capturedAt: new Date().toISOString(),
    viewports: perViewport,
  }
  const dir = join(SNAP, target.journey, target.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  summary.push({ id: target.id, journey: target.journey, statuses: Object.fromEntries(Object.entries(perViewport).map(([k, v]) => [k, v.status])) })
}

await browser.close()
await writeFile(join(SNAP, 'index.json'), JSON.stringify({ event: cfg.event, capturedAt: new Date().toISOString(), summary }, null, 2))

const ok = summary.filter((s) => Object.values(s.statuses).includes('ok')).length
console.log(`\nDone. ${ok}/${summary.length} targets captured.\n`)

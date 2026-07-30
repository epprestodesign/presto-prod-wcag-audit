// Run axe-core against every captured snapshot.
//
//   pnpm audit            audit everything
//   pnpm audit -- search  audit matching target ids
//
// Snapshots are mounted in a shadow root exactly as src/lib/snapshot.js mounts
// them in Storybook, so the numbers reported here are the same numbers the
// Accessibility panel shows. Auditing the raw file instead would measure a
// different DOM than the one the audit publishes.
//
// Writes snapshots/<journey>/<id>/axe.<viewport>.json and a rolled-up
// snapshots/findings.json.

import { chromium, devices } from 'playwright'
import { readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAP = join(ROOT, 'snapshots')
const AXE = join(ROOT, 'node_modules/axe-core/axe.min.js')

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const cfg = JSON.parse(await readFile(join(ROOT, 'capture/targets.json'), 'utf8'))
const exists = (p) => access(p).then(() => true, () => false)

/** Map an axe tag set to the specific WCAG success criteria it maps to. */
function successCriteria(tags) {
  return tags
    .filter((t) => /^wcag\d{3,4}$/.test(t))
    .map((t) => {
      const d = t.replace('wcag', '')
      return `${d[0]}.${d[1]}.${d.slice(2)}`
    })
}

function levelOf(tags) {
  if (tags.includes('wcag2aaa')) return 'AAA'
  if (tags.some((t) => /aa$/.test(t))) return 'AA'
  if (tags.some((t) => /a$/.test(t))) return 'A'
  return '-'
}

async function auditOne(browser, target, vp) {
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
      document.body.appendChild(host)
      const root = host.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = `:host{all:initial;display:block;}\n${sheet}`
      root.appendChild(style)
      const wrap = document.createElement('div')
      if (bodyAttrs.class) wrap.className = bodyAttrs.class
      if (bodyAttrs.style) wrap.setAttribute('style', bodyAttrs.style)
      wrap.innerHTML = markup
      root.appendChild(wrap)
    },
    { markup, sheet, fonts, bodyAttrs }
  )

  // Let webfonts and remote imagery settle — both change contrast results.
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)

  await page.addScriptTag({ path: AXE })
  const raw = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document.body, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
    })
    const pack = (list) =>
      list.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        description: v.description,
        helpUrl: v.helpUrl,
        tags: v.tags,
        nodes: v.nodes.slice(0, 40).map((n) => ({
          target: n.target,
          html: (n.html || '').slice(0, 600),
          failureSummary: n.failureSummary || '',
          // Contrast data lives on the check result, not the node.
          data: (n.any?.[0]?.data ?? n.all?.[0]?.data ?? null),
        })),
        totalNodes: v.nodes.length,
      }))
    return { violations: pack(r.violations), incomplete: pack(r.incomplete) }
  }, WCAG_TAGS)

  await ctx.close()

  const enrich = (list) =>
    list.map((v) => ({ ...v, level: levelOf(v.tags), sc: successCriteria(v.tags) }))

  return { violations: enrich(raw.violations), incomplete: enrich(raw.incomplete) }
}

const browser = await chromium.launch()
const targets = cfg.targets.filter((t) => !filters.length || filters.some((f) => t.id.includes(f)))
const all = []

console.log('\nAuditing snapshots against WCAG 2.2 A + AA\n')

for (const target of targets) {
  const perViewport = {}
  let printed = false
  for (const vp of cfg.viewports) {
    const res = await auditOne(browser, target, vp)
    if (!res) continue
    if (!printed) {
      console.log(`  ${target.journey}/${target.id}`)
      printed = true
    }
    perViewport[vp.id] = res
    const nodes = res.violations.reduce((a, v) => a + v.totalNodes, 0)
    const crit = res.violations.filter((v) => v.impact === 'critical').length
    const ser = res.violations.filter((v) => v.impact === 'serious').length
    console.log(
      `    ${vp.id.padEnd(8)} ${String(res.violations.length).padStart(2)} rules / ${String(nodes).padStart(4)} nodes` +
        `   critical ${crit}, serious ${ser}, incomplete ${res.incomplete.length}`
    )

    for (const v of res.violations) {
      all.push({
        journey: target.journey,
        page: target.id,
        pageTitle: target.title,
        viewport: vp.id,
        rule: v.id,
        impact: v.impact,
        level: v.level,
        sc: v.sc,
        help: v.help,
        helpUrl: v.helpUrl,
        nodeCount: v.totalNodes,
        nodes: v.nodes,
      })
    }
  }
  if (Object.keys(perViewport).length) {
    await writeFile(
      join(SNAP, target.journey, target.id, 'axe.json'),
      JSON.stringify(perViewport, null, 2)
    )
  }
}

await browser.close()

// Roll up: one row per (rule x page x viewport), plus a rule-level summary.
//
// A filtered run (`pnpm audit -- landing`) must not clobber the pages it did not
// visit. Carry forward every finding for a page outside this run's scope, then
// let the freshly-audited pages replace their own rows.
if (filters.length) {
  const auditedPages = new Set(targets.map((t) => t.id))
  const previous = (await exists(join(SNAP, 'findings.json')))
    ? JSON.parse(await readFile(join(SNAP, 'findings.json'), 'utf8')).findings ?? []
    : []
  const carried = previous.filter((f) => !auditedPages.has(f.page))
  all.unshift(...carried)
  if (carried.length) console.log(`\n(carried forward ${carried.length} finding(s) from pages outside this run)`)
}

const byRule = {}
for (const f of all) {
  byRule[f.rule] ??= { rule: f.rule, impact: f.impact, level: f.level, sc: f.sc, help: f.help, helpUrl: f.helpUrl, nodes: 0, pages: new Set() }
  byRule[f.rule].nodes += f.nodeCount
  byRule[f.rule].pages.add(`${f.page}:${f.viewport}`)
}
const summary = Object.values(byRule)
  .map((r) => ({ ...r, pages: [...r.pages] }))
  .sort((a, b) => b.nodes - a.nodes)

await writeFile(join(SNAP, 'findings.json'), JSON.stringify({ generatedAt: new Date().toISOString(), summary, findings: all }, null, 2))

const totalNodes = all.reduce((a, f) => a + f.nodeCount, 0)
console.log(`\n${all.length} rule-instances across ${totalNodes} element occurrences.`)
console.log(`Distinct rules failing: ${summary.length}\n`)
for (const r of summary.slice(0, 20)) {
  console.log(`  ${String(r.impact || '-').padEnd(9)} ${String(r.nodes).padStart(4)}  ${r.rule.padEnd(28)} ${r.sc.join(', ')}`)
}
console.log()

// Replay a captured production page inside Storybook.
//
// The snapshot is mounted in an open shadow root. That containment is what
// makes the audit trustworthy: 400kb of production CSS carries `body`, `*`, and
// bare-element rules that would otherwise repaint Storybook's own chrome, and
// Storybook's preview styles would in turn leak into the page under audit and
// change the very contrast and sizing we are measuring.
//
// The root is *open*, not closed, because axe-core walks open shadow trees —
// so the a11y panel reports on the real production markup, not on a wrapper.

const html = import.meta.glob('../../snapshots/**/*.html', { query: '?raw', import: 'default', eager: true })
const css = import.meta.glob('../../snapshots/**/*.css', { query: '?raw', import: 'default', eager: true })
const meta = import.meta.glob('../../snapshots/**/meta.json', { import: 'default', eager: true })

const key = (journey, id, file) => `../../snapshots/${journey}/${id}/${file}`

export function getMeta(journey, id) {
  return meta[key(journey, id, 'meta.json')] ?? null
}

export function hasSnapshot(journey, id, viewport = 'desktop') {
  return Boolean(html[key(journey, id, `${viewport}.html`)])
}

/** Fonts must be registered document-side; @font-face is inert inside a shadow root. */
function installFonts(fontCss, token) {
  if (!fontCss || document.getElementById(token)) return
  const style = document.createElement('style')
  style.id = token
  style.textContent = fontCss
  document.head.appendChild(style)
}

function placeholder(journey, id, viewport, note) {
  const el = document.createElement('div')
  el.style.cssText =
    'padding:2rem;border:2px dashed #b9b9c6;border-radius:10px;background:#fafafd;' +
    'font:14px/1.6 ui-sans-serif,system-ui,sans-serif;color:#3c3c52;max-width:60ch'
  el.innerHTML = `
    <h2 style="margin:0 0 .5rem;font-size:1.05rem">Pending capture</h2>
    <p style="margin:0 0 .75rem"><code>${journey}/${id}</code> &mdash; <strong>${viewport}</strong> has not been captured yet.</p>
    <p style="margin:0 0 .75rem">${note ?? 'This page is gated behind a completed booking or an authenticated session.'}</p>
    <p style="margin:0">Add its URL to <code>capture/targets.json</code> and run <code>pnpm capture</code>.
       For cookie-gated pages, save a Playwright storage state to <code>capture/auth.json</code> first.</p>`
  return el
}

/**
 * Build the snapshot element for a story.
 *
 * @param {object} opts
 * @param {string} opts.journey  journey folder, e.g. 'checkout'
 * @param {string} opts.id       target id, e.g. 'checkout-1-guests'
 * @param {string} [opts.viewport='desktop']
 * @param {number} [opts.width]  force a render width; defaults to the captured viewport width
 */
export function renderSnapshot({ journey, id, viewport = 'desktop', width } = {}) {
  const markup = html[key(journey, id, `${viewport}.html`)]
  const m = getMeta(journey, id)

  if (!markup) return placeholder(journey, id, viewport, m?.note)

  // Prefer a viewport-specific override, else the shared stylesheet the
  // scraper writes when both captures produced identical CSS.
  const sheet = css[key(journey, id, `${viewport}.css`)] ?? css[key(journey, id, 'styles.css')] ?? ''
  const fonts = css[key(journey, id, 'fonts.css')] ?? ''
  installFonts(fonts, `snapfonts-${journey}-${id}`)

  const vp = m?.viewports?.[viewport]
  const renderWidth = width ?? (viewport === 'mobile' ? 390 : 1440)
  const renderHeight = viewport === 'mobile' ? 844 : 900

  // The host is sized to the captured viewport so media queries and any
  // width-dependent layout resolve exactly as they did on the real device.
  //
  // min-height matters as much as width. `contain: layout` on :host (below)
  // makes the host a containing block for fixed-position descendants — which is
  // what keeps overlays inside the snapshot instead of escaping across
  // Storybook's chrome. But a page whose content is *entirely* fixed-position,
  // like the open map overlay, then has no in-flow content to give the host
  // height: it collapses to its border and renders as a 2px sliver. Flooring it
  // at the captured viewport height gives that content somewhere to lay out,
  // while taller pages still grow past it naturally.
  const host = document.createElement('div')
  host.setAttribute('data-snapshot', `${journey}/${id}/${viewport}`)
  host.style.cssText =
    `width:${renderWidth}px;min-height:${renderHeight}px;max-width:100%;margin:0 auto;` +
    'position:relative;overflow:hidden;border:1px solid #e3e3ea;border-radius:6px;background:#fff'

  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  // `all:initial` on the host stops Storybook's cascade from inheriting into
  // the snapshot; the captured `:host` rules then re-establish the page's own
  // font and background.
  style.textContent = `:host{all:initial;display:block;contain:layout style;}\n${sheet}`
  root.appendChild(style)

  // Re-apply the captured <body> attributes to a wrapper so body-scoped classes
  // (Quasar writes platform/theme flags there) still match.
  const wrapper = document.createElement('div')
  if (vp?.bodyAttrs?.class) wrapper.className = vp.bodyAttrs.class
  if (vp?.bodyAttrs?.style) wrapper.setAttribute('style', vp.bodyAttrs.style)
  wrapper.innerHTML = markup
  root.appendChild(wrapper)

  const frame = document.createElement('div')
  frame.appendChild(captureNotice(vp?.finalUrl))
  frame.appendChild(host)
  return frame
}

/**
 * Banner marking a story as a static capture.
 *
 * Without it these read as a live app, and the first thing anyone does is click
 * something — the map overlay's close button being the obvious trap, since the
 * map is captured mid-overlay and looks stuck rather than frozen.
 *
 * This is the one piece of our own markup inside the audited region, so it is
 * built to contribute zero findings: no interactive elements, a real heading-free
 * text node, and #30303d on #eef0f4 (11.4:1, clears AA and AAA). If it ever did
 * fail a rule it would show up as a finding against the page under audit, which
 * would be worse than useless.
 */
function captureNotice(finalUrl) {
  const bar = document.createElement('div')
  bar.setAttribute('data-capture-notice', '')
  bar.style.cssText =
    'display:flex;gap:.5rem;align-items:baseline;flex-wrap:wrap;' +
    'max-width:1440px;margin:0 auto .5rem;padding:.5rem .75rem;' +
    'font:500 12px/1.5 ui-sans-serif,system-ui,sans-serif;' +
    'color:#30303d;background:#eef0f4;border:1px solid #d3d7e0;border-radius:6px'
  const strong = document.createElement('span')
  strong.textContent = 'Static capture'
  strong.style.cssText = 'font-weight:700'
  const rest = document.createElement('span')
  rest.textContent =
    'Production JavaScript is stripped, so nothing here is interactive — buttons, dropdowns and overlay close controls do nothing. Overlays appear in the state they were captured in.'
  bar.append(strong, rest)
  if (finalUrl) {
    const src = document.createElement('span')
    src.textContent = finalUrl.replace(/^https?:\/\//, '')
    src.style.cssText = 'font-family:ui-monospace,monospace;color:#4a4a5c;word-break:break-all'
    bar.append(src)
  }
  return bar
}

/** Story factory: `render` for a captured page. */
export function snapshotStory(journey, id, viewport = 'desktop') {
  return () => renderSnapshot({ journey, id, viewport })
}

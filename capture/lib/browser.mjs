// Browser-context extraction routines.
//
// These functions are stringified and evaluated inside the page, so they may
// not close over anything from module scope.

/**
 * Serialize every stylesheet the page has applied, in document order.
 *
 * Same-origin sheets expose `cssRules` directly. Cross-origin sheets throw a
 * SecurityError on access, so we record their href and let the Node side
 * re-fetch them (the network has no same-origin policy).
 */
export async function extractStyles() {
  const sheets = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules
      if (!rules) continue
      sheets.push({
        kind: 'inline',
        href: sheet.href || null,
        media: sheet.media?.mediaText || '',
        css: Array.from(rules)
          .map((r) => r.cssText)
          .join('\n'),
      })
    } catch {
      // Cross-origin — defer to a Node-side fetch.
      if (sheet.href) {
        sheets.push({ kind: 'deferred', href: sheet.href, media: sheet.media?.mediaText || '', css: '' })
      }
    }
  }
  return sheets
}

/**
 * Snapshot the live DOM.
 *
 * We take `documentElement.outerHTML` rather than the served HTML because the
 * app is a client-rendered SPA — the served markup is an empty `<div id="app">`.
 * The audit has to see what the user's browser actually builds.
 *
 * Form values are reflected into attributes first. The DOM keeps user-typed
 * values as IDL properties only, so a naive outerHTML would lose the filled-in
 * state that makes error/validation snapshots meaningful.
 */
export function extractDom() {
  for (const el of document.querySelectorAll('input')) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked ? el.setAttribute('checked', '') : el.removeAttribute('checked')
    } else if (el.value != null) {
      el.setAttribute('value', el.value)
    }
  }
  for (const el of document.querySelectorAll('textarea')) el.textContent = el.value
  for (const el of document.querySelectorAll('select option')) {
    el.selected ? el.setAttribute('selected', '') : el.removeAttribute('selected')
  }

  return {
    html: document.documentElement.outerHTML,
    lang: document.documentElement.lang || '',
    title: document.title,
    url: location.href,
  }
}

/**
 * Inventory of interactive and structural elements, used to build the
 * per-page component tables and to give findings a stable anchor.
 *
 * `cssPath` is a nth-of-type path rather than an id-based selector: production
 * ids here are order-scoped (`Rooms[0].Guests[0].FirstName`) and change between
 * captures, so they are unstable as document anchors.
 */
export function extractInventory() {
  const cssPath = (el) => {
    const parts = []
    for (let n = el; n && n.nodeType === 1 && parts.length < 12; n = n.parentElement) {
      const tag = n.tagName.toLowerCase()
      if (tag === 'html' || tag === 'body') break
      const siblings = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : []
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(n) + 1})` : tag)
    }
    return parts.join(' > ')
  }

  const INTERACTIVE = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[tabindex]'
  const items = []
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const rect = el.getBoundingClientRect()
    items.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      name: (el.getAttribute('name') || '').slice(0, 80),
      id: (el.id || '').slice(0, 80),
      text: (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      ariaLabel: el.getAttribute('aria-label') || '',
      ariaLabelledby: el.getAttribute('aria-labelledby') || '',
      hasLabelFor: !!(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)),
      wrappedInLabel: !!el.closest('label'),
      placeholder: el.getAttribute('placeholder') || '',
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      disabled: el.hasAttribute('disabled'),
      tabindex: el.getAttribute('tabindex') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      cssPath: cssPath(el),
    })
  }

  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')).map((el) => ({
    level: Number(el.tagName[1]) || Number(el.getAttribute('aria-level')) || 0,
    text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 90),
    cssPath: cssPath(el),
  }))

  const landmarks = Array.from(
    document.querySelectorAll('header,nav,main,aside,footer,section,form,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=search],[role=complementary],[role=region]')
  ).map((el) => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    label: el.getAttribute('aria-label') || '',
    labelledby: el.getAttribute('aria-labelledby') || '',
    cssPath: cssPath(el),
  }))

  const images = Array.from(document.querySelectorAll('img,[role=img],svg')).map((el) => ({
    tag: el.tagName.toLowerCase(),
    src: (el.getAttribute('src') || '').slice(0, 120),
    alt: el.getAttribute('alt'),
    hasAlt: el.hasAttribute('alt'),
    ariaHidden: el.getAttribute('aria-hidden') === 'true',
    cssPath: cssPath(el),
  }))

  return { items, headings, landmarks, images }
}

/**
 * Keyboard-only tab order, walked by actually moving focus.
 *
 * This is the part axe cannot assess: it reports whether an element *can* be
 * focused, not the order focus visits nor whether the focused state is
 * perceivable. We record both, plus whether DOM order and visual order agree.
 */
export function extractFocusOrder() {
  const cssPath = (el) => {
    const parts = []
    for (let n = el; n && n.nodeType === 1 && parts.length < 12; n = n.parentElement) {
      const tag = n.tagName.toLowerCase()
      if (tag === 'html' || tag === 'body') break
      const siblings = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : []
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(n) + 1})` : tag)
    }
    return parts.join(' > ')
  }

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  const nodes = Array.from(document.querySelectorAll(FOCUSABLE)).filter((el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  })

  return nodes.map((el, i) => {
    const before = getComputedStyle(el)
    const restingOutline = `${before.outlineStyle} ${before.outlineWidth} ${before.outlineColor}`
    const restingShadow = before.boxShadow

    el.focus()
    const focused = document.activeElement === el
    const after = getComputedStyle(el)
    const r = el.getBoundingClientRect()

    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 55),
      tabindex: el.getAttribute('tabindex') || '',
      canFocus: focused,
      // A visible focus indicator requires *some* rendered change on focus.
      outlineOnFocus: `${after.outlineStyle} ${after.outlineWidth} ${after.outlineColor}`,
      focusChangesOutline: `${after.outlineStyle} ${after.outlineWidth} ${after.outlineColor}` !== restingOutline,
      focusChangesShadow: after.boxShadow !== restingShadow,
      outlineWidthPx: parseFloat(after.outlineWidth) || 0,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      cssPath: cssPath(el),
    }
  })
}

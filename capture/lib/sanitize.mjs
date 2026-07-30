// Post-processing of captured markup and CSS.
//
// Two jobs: make the snapshot safe to commit and replay (no scripts, no PII),
// and make it render faithfully inside a shadow root rather than a document.

/** Absolutize a possibly-relative URL; returns the input unchanged if unparseable. */
function abs(url, base) {
  if (!url) return url
  if (/^(data:|blob:|https?:|\/\/|#)/i.test(url)) return url
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/**
 * Rewrite every `url(...)` reference to an absolute address.
 *
 * The quote delimiter is matched as either a literal quote or an HTML entity:
 * when a declaration lives in a `style=""` attribute the quotes arrive escaped
 * (`url(&quot;https://...&quot;)`), and a naive absolute-URL test sees the
 * leading entity, misreads the value as relative, and corrupts it by joining
 * it onto the page URL.
 */
function rewriteUrlRefs(text, baseUrl) {
  return text.replace(/url\(([^)]*)\)/gi, (match, inner) => {
    const trimmed = inner.trim()
    const quoted = trimmed.match(/^(&quot;|&#0?39;|&apos;|['"])([\s\S]*?)\1$/i)
    const quote = quoted ? quoted[1] : ''
    const raw = (quoted ? quoted[2] : trimmed).trim()
    if (!raw || /^(data:|blob:|https?:|\/\/|#)/i.test(raw)) return match
    return `url(${quote}${abs(raw, baseUrl)}${quote})`
  })
}

/**
 * Credentials and record identifiers that must never reach a public repo.
 *
 * None of these are secrets the *audit* needs — the findings are about markup,
 * not about which key rendered a map tile. They are stripped because a snapshot
 * of a production page is a snapshot of production state: the Maps key is
 * billable and gets scraped from public repos even though it is visible in the
 * live page source, the CSRF token is a session credential, and the order id
 * points at a real reservation record.
 */
const SECRETS = [
  { re: /AIza[0-9A-Za-z_-]{30,}/g, with: 'REDACTED-GOOGLE-API-KEY' },
  { re: /(signature=)[A-Za-z0-9_\-%+/=]+/g, with: '$1REDACTED' },
  {
    re: /(name="authenticity_token"[^>]*?value=")[^"]*(")/gi,
    with: '$1REDACTED-CSRF-TOKEN$2',
  },
  { re: /(\border\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, with: '$1REDACTED-ORDER-ID' },
]

/** Strip credentials and record ids. Exported so already-captured files can be re-cleaned. */
export function redactSecrets(text) {
  let out = text
  for (const s of SECRETS) out = out.replace(s.re, s.with)
  return out
}

/**
 * Strip executable and non-replayable content from the captured document.
 *
 * Scripts must go: this is a static forensic snapshot, and re-running the
 * production bundle inside Storybook would re-hydrate the SPA, fire analytics,
 * and mutate the very DOM we are auditing.
 */
export function sanitizeHtml(html, { baseUrl, redact = [] } = {}) {
  let out = html

  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  out = out.replace(/<script\b[^>]*\/?>/gi, '')
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
  // Inline event handlers would still fire without a bundle.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  // <link rel=stylesheet> is redundant: styles are captured separately and
  // inlined, and the remote fetch would be blocked by Storybook's origin anyway.
  out = out.replace(/<link\b[^>]*rel=["']?(stylesheet|modulepreload|preload)["']?[^>]*>/gi, '')

  // Absolutize asset references so images/fonts still resolve off-origin.
  out = out.replace(/\b(src|href|poster)=("|')(.*?)\2/gi, (m, attr, q, val) => {
    if (/^(javascript:|#)/i.test(val)) return `${attr}=${q}${val}${q}`
    return `${attr}=${q}${abs(val, baseUrl)}${q}`
  })
  out = out.replace(/\bsrcset=("|')(.*?)\1/gi, (m, q, val) => {
    const fixed = val
      .split(',')
      .map((part) => {
        const [u, ...rest] = part.trim().split(/\s+/)
        return [abs(u, baseUrl), ...rest].join(' ')
      })
      .join(', ')
    return `srcset=${q}${fixed}${q}`
  })
  out = rewriteUrlRefs(out, baseUrl)

  // Any value typed during flow capture is synthetic, but scrub it anyway so
  // no test identity is ever committed to a public repo.
  for (const secret of redact.filter(Boolean)) {
    out = out.split(secret).join('REDACTED')
  }

  return redactSecrets(out)
}

/** Pull just the body inner HTML — a shadow root hosts a fragment, not a document. */
export function extractBodyInner(html) {
  const m = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)
  return m ? m[1] : html
}

/** Capture the body's own attributes so its classes/styles can be re-applied to the host wrapper. */
export function extractBodyAttrs(html) {
  const m = html.match(/<body\b([^>]*)>/i)
  if (!m) return { class: '', style: '' }
  const cls = m[1].match(/class=("|')(.*?)\1/i)
  const sty = m[1].match(/style=("|')(.*?)\1/i)
  return { class: cls ? cls[2] : '', style: sty ? sty[2] : '' }
}

/**
 * Retarget document-level CSS at a shadow root.
 *
 * `html`, `body`, and `:root` select nothing inside a shadow tree, so any rule
 * hung off them — including the custom-property definitions the whole theme
 * depends on — would silently drop. Rewriting them to `:host` preserves both
 * the cascade origin and inheritance into the snapshot.
 */
export function cssForShadow(css, baseUrl) {
  let out = css

  // @font-face inside a shadow root is ignored by the CSS engine; fonts must be
  // registered document-side. They're hoisted out by the caller.
  out = rewriteUrlRefs(out, baseUrl)

  // Rewrite only in selector position (before `{`), never inside declarations.
  out = out.replace(/(^|\})([^{}@]+)\{/g, (match, brace, selector) => {
    if (!selector.trim()) return match
    const rewritten = selector
      .split(',')
      .map((sel) => {
        let s = sel.trim()
        if (!s) return s
        // Whole-document selectors collapse onto the host itself.
        if (/^(html|body|:root)$/i.test(s)) return ':host'
        if (/^html\s+body$/i.test(s)) return ':host'
        // Leading document scope becomes a host-relative descendant selector.
        s = s.replace(/^html\s*>\s*body\s+/i, ':host ')
        s = s.replace(/^(html|body|:root)\s*>\s*/i, ':host > ')
        s = s.replace(/^(html|body|:root)\s+/i, ':host ')
        // `body.foo` / `html[dir=rtl]` — qualifiers belong on the host.
        s = s.replace(/^(html|body|:root)((?:[.#\[:][^\s>+~]*)+)/i, ':host($2)')
        return s
      })
      .join(', ')
    return `${brace}${rewritten}{`
  })

  return out
}

/** Hoist @font-face blocks, which a shadow root cannot honour. */
export function splitFontFaces(css) {
  const faces = []
  const rest = css.replace(/@font-face\s*\{[^}]*\}/gi, (m) => {
    faces.push(m)
    return ''
  })
  return { fontFaces: faces.join('\n'), css: rest }
}

// Storybook test-runner — the headless WCAG 2.2 AA gate.
//
// Runs an axe-core audit against every story, mirroring the live addon-a11y
// panel: the same tag set as .storybook/preview.js, and it honours each story's
// own `parameters.a11y` so a story can opt out deliberately.
//
// Blocking vs advisory
// --------------------
// Violations are REPORTED but do not fail the run by default. That is a
// deliberate choice for this repo rather than a temporary concession: the
// stories here are verbatim captures of production pages that are *known* to
// fail, and cataloguing those failures is the deliverable. A red build on every
// run would carry no signal. Set A11Y_STRICT=true to make any violation fail —
// useful once remediated snapshots exist to hold the line against regressions.
//
//   pnpm a11y:ci                 advisory (default)
//   A11Y_STRICT=true pnpm a11y:ci   enforcing
import { getStoryContext } from '@storybook/test-runner'
import { injectAxe, configureAxe, checkA11y } from 'axe-playwright'

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const STRICT = process.env.A11Y_STRICT === 'true'

export default {
  async preVisit(page) {
    await injectAxe(page)
  },

  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context)
    const a11y = storyContext.parameters?.a11y

    // Respect a story's own opt-out. `disable` removes it from the audit
    // entirely; `test: 'off'` is the addon's own switch for the same thing.
    if (!a11y || a11y.disable || a11y.test === 'off') return

    await configureAxe(page, { rules: a11y.config?.rules })

    // Scoped to #storybook-root so Storybook's own chrome is never audited —
    // only the story. Captured pages mount in an *open* shadow root inside this
    // element, which axe walks into, so the audit still reaches the real
    // production markup rather than stopping at the host element.
    await checkA11y(
      page,
      '#storybook-root',
      {
        detailedReport: true,
        detailedReportOptions: { html: true },
        axeOptions: { runOnly: { type: 'tag', values: WCAG_TAGS } },
      },
      // skipFailures — true logs violations without failing the run.
      !STRICT
    )
  },
}

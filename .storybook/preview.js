import './preview.css'

/** @type { import('@storybook/html-vite').Preview } */
const preview = {
  parameters: {
    layout: 'fullscreen',

    // Audit every snapshot against WCAG 2.2 A + AA. The 2.1/2.2 tags cover the
    // criteria added after 2.0 that this journey is most likely to fail —
    // reflow (1.4.10), focus appearance (2.4.11) and target size (2.5.8).
    //
    // `test: 'todo'` surfaces violations in the panel without failing the run:
    // these snapshots are *expected* to fail. Documenting the failure is the
    // deliverable, so a red build would be noise rather than signal.
    a11y: {
      test: 'todo',
      config: {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      },
    },

    options: {
      storySort: {
        order: [
          'Getting Started',
          ['Introduction', 'How to Read a Finding', 'Methodology', 'Scorecard'],
          'Journeys',
          [
            'Landing',
            'Browse & Search',
            'Hotel Details',
            'Checkout',
            'Confirmation',
            'Manage Booking',
          ],
          'Findings',
          'Remediation',
        ],
      },
    },
  },
}

export default preview

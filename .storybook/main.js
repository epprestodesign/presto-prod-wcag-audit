import remarkGfm from 'remark-gfm'

/** @type { import('@storybook/html-vite').StorybookConfig } */
const config = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.js'],
  addons: [
    {
      name: '@storybook/addon-docs',
      options: {
        // The findings pages are almost entirely tables — evidence rows,
        // severity counts, WCAG criteria. MDX does not parse GitHub-flavoured
        // tables without this, and silently renders them as literal pipe text
        // collapsed into one paragraph.
        mdxPluginOptions: {
          mdxCompileOptions: { remarkPlugins: [remarkGfm] },
        },
      },
    },
    '@storybook/addon-a11y',
  ],
  framework: { name: '@storybook/html-vite', options: {} },
  docs: {},
  // Screenshots are exposed for linking from docs pages, under /evidence.
  //
  // Two collisions to avoid, both of which fail silently-ish:
  //   - Mounting at the root would serve snapshots/index.json as Storybook's
  //     story index, emptying the whole sidebar.
  //   - Mounting at /snapshots would shadow the URLs Vite uses for the `?raw`
  //     glob imports in src/lib/snapshot.js. The static middleware would answer
  //     those with text/html instead of letting Vite transform them to JS
  //     modules, so every story dies on "Failed to fetch dynamically imported
  //     module". Production builds inline `?raw` at build time and never hit it,
  //     so this only breaks dev.
  staticDirs: [{ from: '../snapshots', to: '/evidence' }],
  async viteFinal(config) {
    // Snapshots live outside src/ and are pulled in with `?raw` import globs.
    config.server = config.server || {}
    config.server.fs = { ...(config.server.fs || {}), allow: ['..'] }
    return config
  },
}

export default config

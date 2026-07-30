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
  // Served under /snapshots, never at the root: the capture pipeline writes its
  // own snapshots/index.json, which at the root would overwrite Storybook's
  // story index and leave the whole sidebar empty.
  staticDirs: [{ from: '../snapshots', to: '/snapshots' }],
  async viteFinal(config) {
    // Snapshots live outside src/ and are pulled in with `?raw` import globs.
    config.server = config.server || {}
    config.server.fs = { ...(config.server.fs || {}), allow: ['..'] }
    return config
  },
}

export default config

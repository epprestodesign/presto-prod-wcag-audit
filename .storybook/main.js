/** @type { import('@storybook/html-vite').StorybookConfig } */
const config = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.js'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
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

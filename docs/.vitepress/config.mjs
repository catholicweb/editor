import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Editor de contenidos',
  description: 'Editor CMS schema-driven para pages.yml',
  cleanUrls: true,
  appearance: true,
  head: [
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['meta', { name: 'theme-color', content: '#000000' }],
  ],
  themeConfig: {
    nav: [],
    sidebar: [],
  },
});

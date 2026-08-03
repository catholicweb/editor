import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Editor de contenidos',
  description: 'Editor CMS schema-driven para pages.yml',
  cleanUrls: true,
  appearance: true,
  head: [
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['meta', { name: 'theme-color', content: '#000000' }],
    // iOS PWA Meta Tags
    ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],
    ['meta', { name: 'apple-mobile-web-app-title', content: 'Editor Parroquia' }],
    ['link', { rel: 'apple-touch-icon', href: '/icon-192.png' }],
  ],
  themeConfig: {
    nav: [],
    sidebar: [],
  },
});

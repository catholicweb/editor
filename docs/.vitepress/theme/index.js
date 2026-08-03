import DefaultTheme from 'vitepress/theme';
import EditorApp from './components/EditorApp.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('EditorApp', EditorApp);
  },
  setup() {
    // Register service worker for PWA
    if (!import.meta.env.SSR && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.log('Service Worker registration failed:', err);
        });
      });
    }
  },
};

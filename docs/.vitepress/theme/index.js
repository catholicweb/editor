import DefaultTheme from 'vitepress/theme';
import EditorApp from './components/EditorApp.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('EditorApp', EditorApp);
  },
};

import DefaultTheme from 'vitepress/theme';
import EditorApp from './components/EditorApp.vue';
import TestEventEditor from './components/TestEventEditor.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('EditorApp', EditorApp);
    app.component('TestEventEditor', TestEventEditor);
  },
};

/**
 * main.ts — application entry point
 */

import './style.css';
import '@waline/client/waline.css';
import { App } from './ui/App';
import { initI18n } from './core/i18n';
import { HistoryStore } from './core/HistoryStore';

async function bootstrap() {
  HistoryStore.installFetchInterceptor();
  await initI18n();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app element not found');

  new App(root);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
        console.error('ServiceWorker registration failed:', err);
      });
    });
  }
}

bootstrap();

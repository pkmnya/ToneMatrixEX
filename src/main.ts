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
}

bootstrap();

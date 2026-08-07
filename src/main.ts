/**
 * main.ts — application entry point
 */

import './style.css';
import '@waline/client/waline.css';
import { App } from './ui/App';
import { initI18n } from './core/i18n';

import { appStore } from './core/AppStore';
import { ProjectSerializer } from './codec/ProjectSerializer';

// iOS AudioContext 恢复机制
// 方案1（当前选用）：切后台保存状态，切回前台时强制重载刷新。为了避免用户面对无声假死不知所措（提升体验），我们选择此方案。
//                   但在调用系统文件管理器等会导致网页切后台的原生组件时，需要打上“免死金牌”标志 (window.__tmx_prevent_reload) 避免误伤刷新。
// 方案2（备选方案）：切后台仅静默保存状态，切回前台不强制刷新，完全交由用户手动下拉刷新来恢复音频。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    const code = ProjectSerializer.serialize(appStore.getAll());
    sessionStorage.setItem('tmx_recovery', code);
    sessionStorage.setItem('tmx_needs_reload', 'true');
  } else if (document.visibilityState === 'visible') {
    if ((window as any).__tmx_prevent_reload) {
      // 遇到“免死金牌”，拦截此次强制刷新，并销毁金牌
      (window as any).__tmx_prevent_reload = false;
      return;
    }
    
    if (sessionStorage.getItem('tmx_needs_reload') === 'true') {
      sessionStorage.removeItem('tmx_needs_reload');
      location.reload();
    }
  }
});
async function bootstrap() {

  await initI18n();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app element not found');

  new App(root);

  // Restore state if returning from background
  const recoveryCode = sessionStorage.getItem('tmx_recovery');
  if (recoveryCode) {
    sessionStorage.removeItem('tmx_recovery');
    const states = ProjectSerializer.deserialize(recoveryCode);
    if (states && states.length > 0) {
      appStore.loadProject(states);
      // Let the App UI update to match the newly loaded state
      root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
        console.error('ServiceWorker registration failed:', err);
      });
    });
  }
}

bootstrap();

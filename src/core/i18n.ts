export type Lang = 'zh' | 'en';

let currentLang: Lang = 'zh';
let translations: Record<string, any> = {};

export async function initI18n() {
  const stored = localStorage.getItem('tmx_lang');
  const browserLang = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  currentLang = (stored as Lang) || browserLang;

  try {
    // Adding cache-buster to prevent users from seeing outdated keys after updates
    const res = await fetch(`lang.json?v=${Date.now()}`);
    if (!res.ok) throw new Error('Failed to load lang.json');
    translations = await res.json();
  } catch (e) {
    console.error('i18n init error:', e);
  }
}

export function t(keyPath: string): string {
  const keys = keyPath.split('.');
  let current = translations[currentLang];
  for (const k of keys) {
    if (!current || typeof current !== 'object') return keyPath;
    current = current[k];
  }
  return typeof current === 'string' ? current : keyPath;
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang) {
  if (currentLang === lang) return;
  currentLang = lang;
  localStorage.setItem('tmx_lang', lang);
  window.dispatchEvent(new CustomEvent('i18n-change'));
}

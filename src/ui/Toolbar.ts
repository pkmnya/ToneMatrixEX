/**
 * Toolbar — top global toolbar.
 * Contains: title, play/stop, add compartment, save/load, export MP3.
 */

import { appStore } from '../core/AppStore';
import { playbackController } from '../core/PlaybackController';
import { ProjectSerializer } from '../codec/ProjectSerializer';
import { Mp3Exporter } from '../export/Mp3Exporter';
import { t, getLang, setLang } from '../core/i18n';

export class Toolbar {
  readonly el: HTMLElement;
  private _playBtn!: HTMLButtonElement;
  private _exportBtn!: HTMLButtonElement;
  private _progressEl!: HTMLElement;
  private _unsubscribe: (() => void) | null = null;

  constructor() {
    this.el = this._build();
    this._subscribeStore();
    this._updateTexts = this._updateTexts.bind(this);
    window.addEventListener('i18n-change', this._updateTexts);
  }

  private _updateTexts(): void {
    if (appStore.isPlaying) {
      this._playBtn.textContent = t('toolbar.stop');
    } else {
      this._playBtn.textContent = t('toolbar.play');
    }

    const installBtn = this.el.querySelector('#btn-install-pwa') as HTMLButtonElement;
    if (installBtn) installBtn.textContent = '⬇ ' + t('toolbar.installApp');

    const saveBtn = this.el.querySelector('#btn-save') as HTMLButtonElement;
    if (saveBtn) {
      saveBtn.textContent = t('toolbar.save');
      saveBtn.title = t('toolbar.saveTitle');
    }

    const loadBtn = this.el.querySelector('#btn-load') as HTMLButtonElement;
    if (loadBtn) {
      loadBtn.textContent = t('toolbar.load');
      loadBtn.title = t('toolbar.loadTitle');
    }

    if (this._exportBtn && !this._exportBtn.disabled) {
      this._exportBtn.textContent = t('toolbar.exportMp3');
    }
  }

  destroy(): void {
    this._unsubscribe?.();
    window.removeEventListener('i18n-change', this._updateTexts);
    this.el.remove();
  }

  private _build(): HTMLElement {
    const el = document.createElement('header');
    el.className = 'toolbar';
    el.id = 'toolbar';

    // Logo / title
    const logo = document.createElement('div');
    logo.className = 'toolbar-logo';
    logo.innerHTML = `
      <span class="logo-icon">◈</span>
      <span class="logo-text">ToneMatrix<span class="logo-ex">EX</span></span>
    `;

    // Center controls
    const center = document.createElement('div');
    center.className = 'toolbar-center';

    // Play / Stop
    this._playBtn = this._btn(t('toolbar.play'), 'btn-play', async () => {
      if (appStore.isPlaying) {
        playbackController.stop();
      } else {
        await playbackController.start();
      }
    });
    this._playBtn.id = 'btn-play-stop';

    // Install / Create Shortcut
    const installBtn = this._btn('⬇ ' + t('toolbar.installApp'), 'btn-play', () => {
      this.el.dispatchEvent(new CustomEvent('app:install-pwa', { bubbles: true }));
    });
    installBtn.id = 'btn-install-pwa';
    installBtn.style.background = '#ff9800'; // Orange color
    installBtn.style.borderColor = '#ff9800';
    installBtn.style.color = '#000';

    center.append(this._playBtn, installBtn);

    // Right controls
    const right = document.createElement('div');
    right.className = 'toolbar-right';

    // Lang toggle
    const langToggle = document.createElement('div');
    langToggle.className = 'lang-toggle';
    langToggle.style.display = 'flex';
    langToggle.style.gap = '8px';
    langToggle.style.marginRight = '12px';
    
    const zhBtn = document.createElement('button');
    zhBtn.className = 'toolbar-btn btn-ghost';
    zhBtn.textContent = '🇨🇳';
    zhBtn.title = '中文';
    zhBtn.style.padding = '4px 8px';
    zhBtn.style.fontSize = '14px';
    zhBtn.addEventListener('click', () => setLang('zh'));

    const enBtn = document.createElement('button');
    enBtn.className = 'toolbar-btn btn-ghost';
    enBtn.textContent = '🇺🇸';
    enBtn.title = 'English';
    enBtn.style.padding = '4px 8px';
    enBtn.style.fontSize = '14px';
    enBtn.addEventListener('click', () => setLang('en'));

    langToggle.append(zhBtn, enBtn);

    // Save
    const saveBtn = this._btn(t('toolbar.save'), 'btn-ghost', async () => {
      try {
        await ProjectSerializer.copyToClipboard(appStore.getAll());
        this._showToast(t('toolbar.saved'));
      } catch {
        this._showToast(t('toolbar.saveFailed'));
      }
    });
    saveBtn.id = 'btn-save';
    saveBtn.title = t('toolbar.saveTitle');

    // Load
    const loadBtn = this._btn(t('toolbar.load'), 'btn-ghost', async () => {
      try {
        const states = await ProjectSerializer.pasteFromClipboard();
        if (!states) { this._showToast(t('toolbar.loadEmpty')); return; }
        if (appStore.isPlaying) playbackController.stop();
        appStore.loadProject(states);
        this.el.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
        this._showToast(t('toolbar.loadSuccess'));
      } catch (e) {
        this._showToast(t('toolbar.loadFailed') + (e as Error).message);
      }
    });
    loadBtn.id = 'btn-load';
    loadBtn.title = t('toolbar.loadTitle');

    // Export MP3
    this._exportBtn = this._btn(t('toolbar.exportMp3'), 'btn-accent', async () => {
      if (this._exportBtn.disabled) return;
      this._exportBtn.disabled = true;
      this._exportBtn.textContent = t('toolbar.exporting');
      try {
        await Mp3Exporter.exportAll(appStore.getAll(), (p) => {
          this._progressEl.textContent =
            p.phase === 'rendering' ? `${t('toolbar.rendering')} ${p.compartmentIndex + 1}/${p.total}…` :
            p.phase === 'encoding'  ? t('toolbar.encoding') : '';
        });
        this._showToast(t('toolbar.exportSuccess'));
      } catch (e) {
        this._showToast(t('toolbar.exportFailed') + (e as Error).message);
      } finally {
        this._exportBtn.disabled = false;
        this._exportBtn.textContent = t('toolbar.exportMp3');
        this._progressEl.textContent = '';
      }
    });
    this._exportBtn.id = 'btn-export-mp3';

    this._progressEl = document.createElement('span');
    this._progressEl.className = 'export-progress';

    right.append(langToggle, saveBtn, loadBtn, this._exportBtn, this._progressEl);

    el.append(logo, center, right);
    return el;
  }

  private _subscribeStore(): void {
    this._unsubscribe = appStore.subscribe((event) => {
      if (event.type === 'PLAYBACK_STARTED') {
        this._playBtn.textContent = t('toolbar.stop');
        this._playBtn.classList.add('btn-play--active');
      } else if (event.type === 'PLAYBACK_STOPPED' || event.type === 'PROJECT_LOADED') {
        this._playBtn.textContent = t('toolbar.play');
        this._playBtn.classList.remove('btn-play--active');
      }
    });
  }

  private _btn(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `toolbar-btn ${className}`;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private _showToast(msg: string): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }
}

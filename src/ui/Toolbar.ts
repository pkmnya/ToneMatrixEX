/**
 * Toolbar — top global toolbar.
 * Contains: title, play/stop, add compartment, save/load, export MP3.
 */

import { appStore } from '../core/AppStore';
import { playbackController } from '../core/PlaybackController';
import { ProjectSerializer } from '../codec/ProjectSerializer';
import { Mp3Exporter } from '../export/Mp3Exporter';

export class Toolbar {
  readonly el: HTMLElement;
  private _playBtn!: HTMLButtonElement;
  private _exportBtn!: HTMLButtonElement;
  private _progressEl!: HTMLElement;
  private _unsubscribe: (() => void) | null = null;

  constructor() {
    this.el = this._build();
    this._subscribeStore();
  }

  destroy(): void {
    this._unsubscribe?.();
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
    this._playBtn = this._btn('▶ 播放', 'btn-play', async () => {
      if (appStore.isPlaying) {
        playbackController.stop();
      } else {
        await playbackController.start();
      }
    });
    this._playBtn.id = 'btn-play-stop';

    // Add compartment
    const addBtn = this._btn('＋ 新隔间', 'btn-secondary', () => {
      appStore.addCompartment();
      this.el.dispatchEvent(new CustomEvent('app:compartment-added', {
        detail: { id: appStore.getAll().at(-1)!.config.id },
        bubbles: true,
      }));
    });
    addBtn.id = 'btn-add-compartment';

    center.append(this._playBtn, addBtn);

    // Right controls
    const right = document.createElement('div');
    right.className = 'toolbar-right';

    // Save
    const saveBtn = this._btn('💾 保存', 'btn-ghost', async () => {
      try {
        await ProjectSerializer.copyToClipboard(appStore.getAll());
        this._showToast('✓ 已复制到剪贴板');
      } catch {
        this._showToast('⚠ 复制失败');
      }
    });
    saveBtn.id = 'btn-save';
    saveBtn.title = '将当前项目编码复制到剪贴板';

    // Load
    const loadBtn = this._btn('📂 加载', 'btn-ghost', async () => {
      try {
        const states = await ProjectSerializer.pasteFromClipboard();
        if (!states) { this._showToast('⚠ 剪贴板中没有有效的项目数据'); return; }
        if (appStore.isPlaying) playbackController.stop();
        appStore.loadProject(states);
        this.el.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
        this._showToast('✓ 项目已加载');
      } catch (e) {
        this._showToast('⚠ 加载失败：' + (e as Error).message);
      }
    });
    loadBtn.id = 'btn-load';
    loadBtn.title = '从剪贴板加载项目';

    // Export MP3
    this._exportBtn = this._btn('🎵 导出 MP3', 'btn-accent', async () => {
      if (this._exportBtn.disabled) return;
      this._exportBtn.disabled = true;
      this._exportBtn.textContent = '⏳ 渲染中…';
      try {
        await Mp3Exporter.exportAll(appStore.getAll(), (p) => {
          this._progressEl.textContent =
            p.phase === 'rendering' ? `渲染隔间 ${p.compartmentIndex + 1}/${p.total}…` :
            p.phase === 'encoding'  ? '编码 MP3…' : '';
        });
        this._showToast('✓ MP3 已下载');
      } catch (e) {
        this._showToast('⚠ 导出失败：' + (e as Error).message);
      } finally {
        this._exportBtn.disabled = false;
        this._exportBtn.textContent = '🎵 导出 MP3';
        this._progressEl.textContent = '';
      }
    });
    this._exportBtn.id = 'btn-export-mp3';

    this._progressEl = document.createElement('span');
    this._progressEl.className = 'export-progress';

    right.append(saveBtn, loadBtn, this._exportBtn, this._progressEl);

    el.append(logo, center, right);
    return el;
  }

  private _subscribeStore(): void {
    this._unsubscribe = appStore.subscribe((event) => {
      if (event.type === 'PLAYBACK_STARTED') {
        this._playBtn.textContent = '⏹ 停止';
        this._playBtn.classList.add('btn-play--active');
      } else if (event.type === 'PLAYBACK_STOPPED') {
        this._playBtn.textContent = '▶ 播放';
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

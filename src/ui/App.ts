/**
 * App — root component. Orchestrates layout and component lifecycle.
 *
 * Layout:
 *   [Toolbar]
 *   [Compartments scroll area (horizontal)]
 *   [Spectrum visualizer (collapsible)]
 */

import { appStore } from '../core/AppStore';
import { playbackController } from '../core/PlaybackController';
import { ProjectSerializer } from '../codec/ProjectSerializer';
import { Toolbar } from './Toolbar';
import { CompartmentPanel } from './CompartmentPanel';
import { SpectrumVisualizer } from '../renderer/SpectrumVisualizer';
import * as Tone from 'tone';

export class App {
  private toolbar: Toolbar;
  private panels = new Map<string, CompartmentPanel>();
  private compartmentsEl!: HTMLElement;
  private visualizer!: SpectrumVisualizer;
  private _storeUnsub: (() => void) | null = null;

  constructor(private root: HTMLElement) {
    this.toolbar  = new Toolbar();
    this._buildLayout();
    this._initCompartments();
    this._bindGlobalEvents();
    this._subscribeStore();
  }

  // ---- Layout ----

  private _buildLayout(): void {
    this.root.innerHTML = '';

    this.root.appendChild(this.toolbar.el);

    // Compartments scroll area
    this.compartmentsEl = document.createElement('div');
    this.compartmentsEl.className = 'compartments-area';
    this.compartmentsEl.id = 'compartments-area';
    this.root.appendChild(this.compartmentsEl);

    // Spectrum section
    const specSection = document.createElement('section');
    specSection.className = 'spectrum-section';

    const specHeader = document.createElement('div');
    specHeader.className = 'spectrum-header';
    specHeader.innerHTML = `
      <span class="spectrum-title">◈ 频谱分析</span>
      <button class="spectrum-toggle" id="btn-toggle-spectrum" title="折叠/展开">▲</button>
    `;

    const specCanvas = document.createElement('canvas');
    specCanvas.className = 'spectrum-canvas';
    specCanvas.id = 'spectrum-canvas';

    specSection.append(specHeader, specCanvas);
    this.root.appendChild(specSection);

    // Toggle spectrum
    specHeader.querySelector('#btn-toggle-spectrum')?.addEventListener('click', () => {
      specSection.classList.toggle('spectrum-section--collapsed');
      const btn = specHeader.querySelector('#btn-toggle-spectrum') as HTMLButtonElement;
      btn.textContent = specSection.classList.contains('spectrum-section--collapsed') ? '▼' : '▲';
    });

    // Visualizer
    this.visualizer = new SpectrumVisualizer(specCanvas);
    this.visualizer.start();

    // Codec data display/editor section (below spectrum)
    const codecSection = document.createElement('section');
    codecSection.className = 'codec-section';
    codecSection.innerHTML = `
      <div class="codec-header">
        <span class="codec-title">◈ 项目内容编码 (TMX_v2 HEX 协议)</span>
        <div class="codec-actions">
          <button class="codec-btn btn-ghost" id="btn-copy-codec" title="复制当前编码到剪贴板">📋 复制编码</button>
          <button class="codec-btn btn-accent-small" id="btn-apply-codec" title="加载下方文本框中的编码">⚡ 应用该编码</button>
        </div>
      </div>
      <div class="codec-body">
        <textarea class="codec-textarea" id="codec-textarea" placeholder="操作格子后将自动更新编码，或者在此粘贴 TMX_v2 编码并点击“应用”..." spellcheck="false"></textarea>
      </div>
    `;
    this.root.appendChild(codecSection);

    // Bind codec actions
    codecSection.querySelector('#btn-copy-codec')?.addEventListener('click', async () => {
      const textarea = this.root.querySelector<HTMLTextAreaElement>('#codec-textarea');
      if (!textarea) return;
      try {
        await navigator.clipboard.writeText(textarea.value);
        this._showToast('✓ 编码已复制到剪贴板');
      } catch {
        textarea.select();
        this._showToast('⚠ 请手动 Ctrl+C 复制');
      }
    });

    codecSection.querySelector('#btn-apply-codec')?.addEventListener('click', () => {
      const textarea = this.root.querySelector<HTMLTextAreaElement>('#codec-textarea');
      if (!textarea) return;
      const raw = textarea.value.trim();
      const states = ProjectSerializer.deserialize(raw);
      if (!states || states.length === 0) {
        this._showToast('⚠ 编码格式无效，请确保是合法完整的 TMX_v2 编码');
        return;
      }
      if (appStore.isPlaying) {
        playbackController.stop();
      }
      appStore.loadProject(states);
      this.root.dispatchEvent(new CustomEvent('app:project-loaded', { bubbles: true }));
      this._showToast('✓ 成功从文本框加载项目编码！');
      this._syncCodecTextarea(true);
    });

    // Initial sync of codec textarea
    this._syncCodecTextarea(true);
  }

  // ---- Compartment management ----

  private _initCompartments(): void {
    for (const state of appStore.getAll()) {
      this._addPanel(state.config.id);
    }
  }

  private _addPanel(id: string): void {
    if (this.panels.has(id)) return;
    const panel = new CompartmentPanel(id);
    this.panels.set(id, panel);
    this.compartmentsEl.appendChild(panel.el);
    this._bindPanelEvents(panel);

    // Animate in
    requestAnimationFrame(() => panel.el.classList.add('comp--visible'));
  }

  private _removePanel(id: string): void {
    const panel = this.panels.get(id);
    if (panel) {
      panel.destroy();
      panel.el.remove();
      this.panels.delete(id);
    }
  }

  private _bindPanelEvents(panel: CompartmentPanel): void {
    panel.el.addEventListener('compartment:add', (e) => {
      const { afterId } = (e as CustomEvent).detail;
      const newId = appStore.addCompartment(afterId);
    });

    panel.el.addEventListener('compartment:remove', (e) => {
      const { id } = (e as CustomEvent).detail;
      appStore.removeCompartment(id);
    });

    panel.el.addEventListener('compartment:duplicate', (e) => {
      const { newId } = (e as CustomEvent).detail;
      this._addPanel(newId);
    });
  }

  // ---- Global events ----

  private _bindGlobalEvents(): void {
    window.addEventListener('resize', () => {
      this.panels.forEach(p => p.resize());
    });

    this.root.addEventListener('app:compartment-added', (e) => {
      const { id } = (e as CustomEvent).detail;
      this._addPanel(id);
    });

    this.root.addEventListener('app:project-loaded', () => {
      for (const id of [...this.panels.keys()]) {
        this._removePanel(id);
      }
      for (const state of appStore.getAll()) {
        this._addPanel(state.config.id);
      }
      this._syncCodecTextarea(true);
    });
  }

  // ---- Store subscription ----

  private _subscribeStore(): void {
    this._storeUnsub = appStore.subscribe(async (event) => {
      if (event.type === 'COMPARTMENT_ADDED') {
        this._addPanel(event.compartmentId);
        this._syncCodecTextarea();
      } else if (event.type === 'COMPARTMENT_REMOVED') {
        this._removePanel(event.compartmentId);
        appStore.relabelAll();
        this._syncCodecTextarea();
      } else if (
        event.type === 'GRID_CHANGED' ||
        event.type === 'GRID_CLEARED' ||
        event.type === 'COMPARTMENT_CONFIG_CHANGED' ||
        event.type === 'PROJECT_LOADED'
      ) {
        this._syncCodecTextarea(event.type === 'PROJECT_LOADED');
      } else if (event.type === 'PLAYBACK_STARTED') {
        // Connect visualizer after AudioContext is running
        this._tryConnectVisualizer();
      }
    });
  }

  private _visualizerConnected = false;

  private _tryConnectVisualizer(): void {
    if (this._visualizerConnected) return;
    try {
      const ctx = Tone.getContext().rawContext as AudioContext;
      // Connect analyser to the raw Web Audio destination node
      const dest = (Tone.getDestination() as unknown as { input: AudioNode }).input;
      this.visualizer.connect(ctx, dest ?? ctx.destination);
      this._visualizerConnected = true;
    } catch { /* AudioContext not ready yet */ }
  }

  private _syncCodecTextarea(force = false): void {
    const textarea = this.root.querySelector<HTMLTextAreaElement>('#codec-textarea');
    if (!textarea) return;
    if (force || document.activeElement !== textarea) {
      textarea.value = ProjectSerializer.serialize(appStore.getAll());
    }
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

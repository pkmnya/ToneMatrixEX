/**
 * CompartmentPanel — UI component for a single compartment.
 * Equivalent to C# GridComboPanel + GridGroup control panel.
 *
 * Layout:  [canvas grid] | [drag handle] | [control sidebar]
 */

import { appStore } from '../core/AppStore';
import { audioEngine } from '../audio/AudioEngine';
import { GridRenderer } from '../renderer/GridRenderer';
import type { CompartmentConfig } from '../core/types';
import { NOTE_RANGE_LABELS, WAVE_TYPE_LABELS, NOTE_RANGE_ROWS } from '../core/types';

const MIN_PANEL_WIDTH = 280;
const SIDEBAR_WIDTH   = 160;
const HANDLE_WIDTH    = 8;

export class CompartmentPanel {
  readonly el: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private renderer!: GridRenderer;
  private sidebar!: HTMLElement;
  private _id: string;
  private _unsubscribe: (() => void) | null = null;
  private _resizing = false;
  private _resizeStartX = 0;
  private _resizeStartWidth = 0;

  constructor(compartmentId: string) {
    this._id = compartmentId;
    this.el = this._build();
    this._setupRenderer();
    this._subscribeStore();
    this._syncFromStore();

    // Create synth pool for this compartment
    const state = appStore.getState(compartmentId);
    if (state) audioEngine.createPool(state.config);
  }

  destroy(): void {
    this._unsubscribe?.();
    this.renderer.destroy();
    audioEngine.disposePool(this._id);
    this.el.remove();
  }

  resize(): void {
    this.renderer.resize();
  }

  // ---- DOM construction ----

  private _build(): HTMLElement {
    const state = appStore.getState(this._id)!;
    const el = document.createElement('div');
    el.className = 'compartment-panel';
    el.dataset['id'] = this._id;
    el.style.width = `${state.config.panelWidth}px`;

    // Canvas area
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'comp-canvas-wrap';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'comp-canvas';
    canvasWrap.appendChild(this.canvas);

    // Resize handle
    const handle = document.createElement('div');
    handle.className = 'comp-resize-handle';
    handle.title = '拖动调整宽度';
    this._bindResizeHandle(handle);

    // Sidebar
    this.sidebar = this._buildSidebar();

    el.append(canvasWrap, handle, this.sidebar);
    return el;
  }

  private _buildSidebar(): HTMLElement {
    const id = this._id;
    const state = appStore.getState(id)!;
    const cfg   = state.config;

    const sb = document.createElement('div');
    sb.className = 'comp-sidebar';

    // Title / label
    const title = document.createElement('div');
    title.className = 'comp-title';
    title.textContent = cfg.label;
    sb.appendChild(title);

    // Active toggle
    sb.appendChild(this._row('激活', this._toggle('active', cfg.isActive, (v) => {
      appStore.updateConfig(id, { isActive: v });
      this.el.classList.toggle('comp--inactive', !v);
    })));

    // BPM slider
    const bpmVal = document.createElement('span');
    bpmVal.className = 'slider-value';
    bpmVal.textContent = String(cfg.bpm);

    const bpmSlider = this._slider('bpm', 30, 400, 1, cfg.bpm, (v) => {
      bpmVal.textContent = String(v);
      appStore.updateConfig(id, { bpm: v });
    });
    sb.appendChild(this._row('BPM', bpmSlider, bpmVal));

    // Columns (width) input
    const widthInput = this._numberInput('cols', 1, 64, cfg.width, (v) => {
      appStore.updateConfig(id, { width: v });
      this.renderer.markDirty();
    });
    sb.appendChild(this._row('列数', widthInput));

    // Note range select
    const rangeSelect = this._select('noteRange', NOTE_RANGE_LABELS, cfg.noteRange, (v) => {
      appStore.updateConfig(id, { noteRange: v as any });
      audioEngine.createPool(appStore.getState(id)!.config);
      this.renderer.markDirty();
    });
    sb.appendChild(this._row('音阶', rangeSelect));

    // Wave type select
    const waveSelect = this._select('waveType', WAVE_TYPE_LABELS, cfg.waveType, (v) => {
      const newCfg = appStore.getState(id)!.config;
      appStore.updateConfig(id, { waveType: v as any });
      audioEngine.createPool({ ...newCfg, waveType: v as any });
    });
    sb.appendChild(this._row('音色', waveSelect));

    // Volume slider
    const volVal = document.createElement('span');
    volVal.className = 'slider-value';
    volVal.textContent = `${Math.round(cfg.volume * 100)}%`;

    const volSlider = this._slider('volume', 0, 150, 1, Math.round(cfg.volume * 100), (v) => {
      const vol = v / 100;
      volVal.textContent = `${v}%`;
      appStore.updateConfig(id, { volume: vol });
      audioEngine.setVolume(id, vol);
    });
    sb.appendChild(this._row('音量', volSlider, volVal));

    // --- Action buttons ---
    const btnRow = document.createElement('div');
    btnRow.className = 'comp-btn-row';

    const clearBtn  = this._btn('清除', 'btn-ghost', () => appStore.clearGrid(id));
    const dupBtn    = this._btn('复制', 'btn-ghost', () => {
      const newId = appStore.duplicateCompartment(id);
      this.el.dispatchEvent(new CustomEvent('compartment:duplicate', {
        detail: { newId, afterId: id }, bubbles: true,
      }));
    });
    const deleteBtn = this._btn('删除', 'btn-danger', () => {
      this.el.dispatchEvent(new CustomEvent('compartment:remove', {
        detail: { id }, bubbles: true,
      }));
    });
    const addBtn = this._btn('+ 新增', 'btn-primary', () => {
      this.el.dispatchEvent(new CustomEvent('compartment:add', {
        detail: { afterId: id }, bubbles: true,
      }));
    });

    btnRow.append(clearBtn, dupBtn, deleteBtn, addBtn);
    sb.appendChild(btnRow);

    // Status indicator (active compartment in relay)
    const status = document.createElement('div');
    status.className = 'comp-status';
    status.dataset['statusId'] = id;
    sb.appendChild(status);

    return sb;
  }

  // ---- Renderer setup ----

  private _setupRenderer(): void {
    this.renderer = new GridRenderer(this.canvas, {
      onCellToggled: (col, row, value) => {
        appStore.setCell(this._id, col, row, value);
      },
      onTestNote: (row) => {
        const state = appStore.getState(this._id);
        if (state) audioEngine.testNote(this._id, row, state.config.noteRange);
      },
    });

    // Observe canvas resize
    const ro = new ResizeObserver(() => {
      this.renderer.resize();
    });
    ro.observe(this.canvas);
  }

  // ---- Store subscription ----

  private _subscribeStore(): void {
    this._unsubscribe = appStore.subscribe((event) => {
      if (event.type === 'PLAYBACK_COLUMN_CHANGED' && event.compartmentId === this._id) {
        const state = appStore.getState(this._id);
        if (state) {
          this.renderer.setState(state);
        }
      } else if (event.type === 'GRID_CHANGED' && event.compartmentId === this._id) {
        const state = appStore.getState(this._id);
        if (state) this.renderer.setState(state);
      } else if (event.type === 'GRID_CLEARED' && event.compartmentId === this._id) {
        const state = appStore.getState(this._id);
        if (state) this.renderer.setState(state);
      } else if (event.type === 'COMPARTMENT_CONFIG_CHANGED' && event.compartmentId === this._id) {
        const state = appStore.getState(this._id);
        if (state) {
          this.renderer.setState(state);
          this._syncSidebarLabel(state.config);
        }
      } else if (event.type === 'RELAY_SWITCHED') {
        const isActive = event.toId === this._id;
        this.el.classList.toggle('comp--playing', isActive);
        const statusEl = this.sidebar.querySelector<HTMLElement>(`[data-status-id="${this._id}"]`);
        if (statusEl) statusEl.textContent = isActive ? '▶ 正在播放' : '';
      } else if (event.type === 'PLAYBACK_STOPPED') {
        this.el.classList.remove('comp--playing');
        const statusEl = this.sidebar.querySelector<HTMLElement>(`[data-status-id="${this._id}"]`);
        if (statusEl) statusEl.textContent = '';
      }
    });
  }

  private _syncFromStore(): void {
    const state = appStore.getState(this._id);
    if (!state) return;
    this.renderer.setState(state);
    this.el.classList.toggle('comp--inactive', !state.config.isActive);
  }

  private _syncSidebarLabel(cfg: CompartmentConfig): void {
    const title = this.sidebar.querySelector<HTMLElement>('.comp-title');
    if (title) title.textContent = cfg.label;
  }

  // ---- Resize handle ----

  private _bindResizeHandle(handle: HTMLElement): void {
    handle.addEventListener('mousedown', (e) => {
      this._resizing = true;
      this._resizeStartX = e.clientX;
      this._resizeStartWidth = this.el.offsetWidth;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._resizing) return;
      const delta = e.clientX - this._resizeStartX;
      const newW  = Math.max(MIN_PANEL_WIDTH, this._resizeStartWidth + delta);
      this.el.style.width = `${newW}px`;
      appStore.updateConfig(this._id, { panelWidth: newW });
      this.renderer.resize();
    });

    document.addEventListener('mouseup', () => {
      this._resizing = false;
    });
  }

  // ---- Widget helpers ----

  private _row(label: string, ...controls: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'comp-row';
    const lbl = document.createElement('label');
    lbl.className = 'comp-label';
    lbl.textContent = label;
    row.append(lbl, ...controls);
    return row;
  }

  private _toggle(name: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const label = document.createElement('label');
    label.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    const span = document.createElement('span');
    span.className = 'toggle-track';
    label.append(input, span);
    return label;
  }

  private _slider(name: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'comp-slider';
    input.name = name;
    input.min  = String(min);
    input.max  = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => onChange(Number(input.value)));
    return input;
  }

  private _numberInput(name: string, min: number, max: number, value: number, onChange: (v: number) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type  = 'number';
    input.className = 'comp-number';
    input.name  = name;
    input.min   = String(min);
    input.max   = String(max);
    input.value = String(value);
    input.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, parseInt(input.value, 10) || value));
      input.value = String(v);
      onChange(v);
    });
    return input;
  }

  private _select<T extends string>(
    name: string,
    options: Record<T, string>,
    value: T,
    onChange: (v: string) => void,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'comp-select';
    sel.name = name;
    for (const [k, label] of Object.entries(options) as [string, string][]) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = label;
      if (k === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  private _btn(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `comp-btn ${className}`;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }
}

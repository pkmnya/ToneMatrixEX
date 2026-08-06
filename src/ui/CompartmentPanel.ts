/**
 * CompartmentPanel — UI component for a single compartment.
 * Equivalent to C# GridComboPanel + GridGroup control panel.
 *
 * Layout:  [canvas grid] | [drag handle] | [control sidebar]
 */

import { appStore } from '../core/AppStore';
import { audioEngine } from '../audio/AudioEngine';
import { GridRenderer } from '../renderer/GridRenderer';
import type { CompartmentConfig, NoteRange, WaveType, FxType } from '../core/types';
import { NOTE_RANGE_ROWS } from '../core/types';
import { t } from '../core/i18n';

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

    this._updateTexts = this._updateTexts.bind(this);
    window.addEventListener('i18n-change', this._updateTexts);
  }

  destroy(): void {
    this._unsubscribe?.();
    this.renderer.destroy();
    audioEngine.disposePool(this._id);
    window.removeEventListener('i18n-change', this._updateTexts);
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
    handle.title = t('panel.dragTitle');
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
    sb.dataset.hint = t('panel.scrollHint');

    // Title / label
    const title = document.createElement('div');
    title.className = 'comp-title';
    title.textContent = cfg.label;
    sb.appendChild(title);

    // Active toggle
    sb.appendChild(this._row(t('panel.active'), 'panel.active', this._toggle('active', cfg.isActive, (v) => {
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
    sb.appendChild(this._row('BPM', null, bpmSlider, bpmVal));

    // Columns (width) input
    const widthInput = this._numberInput('cols', 1, 64, cfg.width, (v) => {
      appStore.updateConfig(id, { width: v });
      this.renderer.markDirty();
    });
    sb.appendChild(this._row(t('panel.columns'), 'panel.columns', widthInput));

    // Note range select
    const noteRangeLabels: Record<NoteRange, string> = {
      pentatonic: t('types.pentatonic'),
      diatonic: t('types.diatonic'),
      chromatic: t('types.chromatic'),
    };
    const rangeSelect = this._select('noteRange', noteRangeLabels, cfg.noteRange, (v) => {
      appStore.updateConfig(id, { noteRange: v as any });
      audioEngine.createPool(appStore.getState(id)!.config);
      this.renderer.markDirty();
    });
    sb.appendChild(this._row(t('panel.scale'), 'panel.scale', rangeSelect));

    // Wave type select
    const waveTypeLabels: Record<WaveType, string> = {
      sine: t('types.sine'),
      sawtooth: t('types.sawtooth'),
      square: t('types.square'),
      triangle: t('types.triangle'),
      piano: t('types.piano'),
    };
    const waveSelect = this._select('waveType', waveTypeLabels, cfg.waveType, (v) => {
      const newCfg = appStore.getState(id)!.config;
      appStore.updateConfig(id, { waveType: v as any });
      audioEngine.createPool({ ...newCfg, waveType: v as any });
    });
    sb.appendChild(this._row(t('panel.wave'), 'panel.wave', waveSelect));

    // FX type select
    const fxTypeLabels: Record<FxType, string> = {
      none: t('types.none'),
      pingpong: t('types.pingpong'),
      chorus: t('types.chorus'),
      freeverb: t('types.freeverb'),
      autofilter: t('types.autofilter'),
      bitcrusher: t('types.bitcrusher'),
      phaser: t('types.phaser'),
      tremolo: t('types.tremolo'),
    };
    const fxSelect = this._select('fxType', fxTypeLabels, cfg.fxType, (v) => {
      const newCfg = appStore.getState(id)!.config;
      appStore.updateConfig(id, { fxType: v as any });
      audioEngine.createPool({ ...newCfg, fxType: v as any });
    });
    sb.appendChild(this._row(t('panel.fx'), 'panel.fx', fxSelect));

    // FX Length slider
    const fxLenVal = document.createElement('span');
    fxLenVal.className = 'slider-value';
    fxLenVal.textContent = `${Math.round(cfg.fxLength * 100)}%`;

    const fxLenSlider = this._slider('fxLength', 0, 100, 1, Math.round(cfg.fxLength * 100), (v) => {
      const len = v / 100;
      fxLenVal.textContent = `${v}%`;
      const newCfg = appStore.getState(id)!.config;
      appStore.updateConfig(id, { fxLength: len });
      audioEngine.createPool({ ...newCfg, fxLength: len });
    });
    sb.appendChild(this._row(t('panel.fxLen'), 'panel.fxLen', fxLenSlider, fxLenVal));

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
    sb.appendChild(this._row(t('panel.volume'), 'panel.volume', volSlider, volVal));

    // --- Action buttons ---
    const btnRow = document.createElement('div');
    btnRow.className = 'comp-btn-row';

    const clearBtn  = this._btn(t('panel.clear'), 'btn-ghost', () => appStore.clearGrid(id));
    const dupBtn    = this._btn(t('panel.duplicate'), 'btn-ghost', () => {
      const newId = appStore.duplicateCompartment(id);
      this.el.dispatchEvent(new CustomEvent('compartment:duplicate', {
        detail: { newId, afterId: id }, bubbles: true,
      }));
    });
    const deleteBtn = this._btn(t('panel.delete'), 'btn-danger', () => {
      this.el.dispatchEvent(new CustomEvent('compartment:remove', {
        detail: { id }, bubbles: true,
      }));
    });
    const addBtn = this._btn(t('panel.add'), 'btn-primary', () => {
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
        if (statusEl) statusEl.textContent = isActive ? t('panel.playing') : '';
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
    let startX = 0;
    let startWidth = 0;

    const onMove = (e: PointerEvent) => {
      if (!this._resizing) return;
      const delta = e.clientX - startX;
      const newW  = Math.max(MIN_PANEL_WIDTH, startWidth + delta);
      this.el.style.width = `${newW}px`;
      appStore.updateConfig(this._id, { panelWidth: newW });
      this.renderer.resize();
    };

    const onUp = (e: PointerEvent) => {
      if (!this._resizing) return;
      this._resizing = false;
      handle.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup',   onUp);
    };

    handle.addEventListener('pointerdown', (e) => {
      this._resizing = true;
      startX = e.clientX;
      startWidth = this.el.offsetWidth;
      handle.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup',   onUp);
      e.preventDefault();
    });

    // Touch-action: none so browser doesn't intercept the drag
    handle.style.touchAction = 'none';
  }

  // ---- Widget helpers ----

  private _row(label: string, i18nKey: string | null, ...controls: HTMLElement[]): HTMLElement {
    const r = document.createElement('div');
    r.className = 'comp-row';
    const l = document.createElement('span');
    l.className = 'comp-label';
    l.textContent = label;
    if (i18nKey) l.dataset.i18nPanel = i18nKey;
    r.append(l, ...controls);
    return r;
  }

  private _updateTexts(): void {
    if (this.sidebar) {
      this.sidebar.dataset.hint = t('panel.scrollHint');
    }

    const handle = this.el.querySelector('.comp-resize-handle') as HTMLElement;
    if (handle) handle.title = t('panel.dragTitle');

    const els = this.sidebar.querySelectorAll<HTMLElement>('[data-i18n-panel]');
    els.forEach((el) => {
      if (el.dataset.i18nPanel) {
        el.textContent = t(el.dataset.i18nPanel);
      }
    });

    const clearBtn = this.el.querySelector('.comp-btn-row .btn-ghost:nth-child(1)');
    if (clearBtn) clearBtn.textContent = t('panel.clear');
    const dupBtn = this.el.querySelector('.comp-btn-row .btn-ghost:nth-child(2)');
    if (dupBtn) dupBtn.textContent = t('panel.duplicate');
    const deleteBtn = this.el.querySelector('.comp-btn-row .btn-danger');
    if (deleteBtn) deleteBtn.textContent = t('panel.delete');
    const addBtn = this.el.querySelector('.comp-btn-row .btn-primary');
    if (addBtn) addBtn.textContent = t('panel.add');

    const statusEl = this.el.querySelector('.comp-status') as HTMLElement;
    if (statusEl && statusEl.textContent) {
      statusEl.textContent = t('panel.playing');
    }

    const noteSelect = this.el.querySelector('select[name="noteRange"]') as HTMLSelectElement;
    if (noteSelect) {
      Array.from(noteSelect.options).forEach(opt => {
        opt.textContent = t('types.' + opt.value);
      });
    }
    const waveSelect = this.el.querySelector('select[name="waveType"]') as HTMLSelectElement;
    if (waveSelect) {
      Array.from(waveSelect.options).forEach(opt => {
        opt.textContent = t('types.' + opt.value);
      });
    }
    const fxSelect = this.el.querySelector('select[name="fxType"]') as HTMLSelectElement;
    if (fxSelect) {
      Array.from(fxSelect.options).forEach(opt => {
        opt.textContent = t('types.' + opt.value);
      });
    }
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

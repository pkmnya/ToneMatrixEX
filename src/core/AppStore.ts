/**
 * AppStore — central state container + event bus.
 * Equivalent to Form1's GridGroups list + event pattern.
 */

import type {
  CompartmentConfig,
  CompartmentState,
  AppEvent,
  NoteRange,
} from './types';
import { NOTE_RANGE_ROWS } from './types';
import { MutableGridModel } from './GridModel';

type Unsubscribe = () => void;
type Handler = (event: AppEvent) => void;

let _idCounter = 0;
function genId(): string {
  return `comp-${Date.now()}-${(_idCounter++).toString(36)}`;
}

function makeDefaultGrid(cols: number, rows: number): boolean[][] {
  return Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));
}

function makeDefaultConfig(index: number): CompartmentConfig {
  return {
    id: genId(),
    label: `组 #${index + 1}`,
    width: 16,
    noteRange: 'pentatonic',
    bpm: 120,
    isActive: true,
    waveType: 'sine',
    volume: 0.8,
    panelWidth: 440,
  };
}

export class AppStore {
  private _compartments: CompartmentState[] = [];
  private _handlers: Handler[] = [];

  // Playback state
  private _isPlaying = false;
  private _activeCompartmentId: string | null = null;

  constructor() {
    // Start with one default compartment
    this._addCompartmentInternal(makeDefaultConfig(0));
  }

  // ---- Accessors ----

  get isPlaying(): boolean { return this._isPlaying; }
  get activeCompartmentId(): string | null { return this._activeCompartmentId; }

  getAll(): readonly CompartmentState[] { return this._compartments; }

  getState(id: string): CompartmentState | undefined {
    return this._compartments.find(c => c.config.id === id);
  }

  getActiveCompartments(): CompartmentState[] {
    return this._compartments.filter(c => c.config.isActive);
  }

  getCompartmentCount(): number { return this._compartments.length; }

  // ---- Event bus ----

  subscribe(handler: Handler): Unsubscribe {
    this._handlers.push(handler);
    return () => { this._handlers = this._handlers.filter(h => h !== handler); };
  }

  emit(event: AppEvent): void {
    // Use a snapshot to avoid mutation during iteration
    [...this._handlers].forEach(h => h(event));
  }

  // ---- Compartment CRUD ----

  addCompartment(afterId?: string): string {
    const config = makeDefaultConfig(this._compartments.length);
    const idx = afterId
      ? this._compartments.findIndex(c => c.config.id === afterId) + 1
      : this._compartments.length;
    this._addCompartmentInternal(config, idx);
    this.emit({ type: 'COMPARTMENT_ADDED', compartmentId: config.id });
    return config.id;
  }

  private _addCompartmentInternal(config: CompartmentConfig, idx?: number): void {
    const rows = NOTE_RANGE_ROWS[config.noteRange];
    const state: CompartmentState = {
      config: { ...config },
      grid: makeDefaultGrid(config.width, rows),
      currentColumn: -1,
    };
    if (idx !== undefined) {
      this._compartments.splice(idx, 0, state);
    } else {
      this._compartments.push(state);
    }
  }

  removeCompartment(id: string): void {
    if (this._compartments.length <= 1) return;
    this._compartments = this._compartments.filter(c => c.config.id !== id);
    if (this._activeCompartmentId === id) {
      this._activeCompartmentId = null;
    }
    this.emit({ type: 'COMPARTMENT_REMOVED', compartmentId: id });
  }

  duplicateCompartment(id: string): string {
    const src = this.getState(id);
    if (!src) return '';
    const newConfig = makeDefaultConfig(this._compartments.length);
    newConfig.noteRange = src.config.noteRange;
    newConfig.bpm = src.config.bpm;
    newConfig.width = src.config.width;
    newConfig.waveType = src.config.waveType;
    newConfig.volume = src.config.volume;
    newConfig.isActive = src.config.isActive;
    const idx = this._compartments.findIndex(c => c.config.id === id) + 1;
    this._addCompartmentInternal(newConfig, idx);
    // Copy grid data
    const newState = this.getState(newConfig.id)!;
    newState.grid = src.grid.map(col => [...col]);
    this.emit({ type: 'COMPARTMENT_ADDED', compartmentId: newConfig.id });
    return newConfig.id;
  }

  // ---- Config updates ----

  updateConfig(id: string, changes: Partial<CompartmentConfig>): void {
    const state = this.getState(id);
    if (!state) return;

    const oldRange = state.config.noteRange;
    const oldWidth = state.config.width;

    Object.assign(state.config, changes);

    const newRange = state.config.noteRange;
    const newWidth = state.config.width;

    // Resize grid if dimensions changed
    if (newRange !== oldRange || newWidth !== oldWidth) {
      const oldRows = NOTE_RANGE_ROWS[oldRange];
      const newRows = NOTE_RANGE_ROWS[newRange];
      const old = new MutableGridModel(oldWidth, oldRows, state.grid);
      // Build new grid preserving existing data
      state.grid = Array.from({ length: newWidth }, (_, c) =>
        Array.from({ length: newRows }, (__, r) => old.get(c, r))
      );
    }

    this.emit({ type: 'COMPARTMENT_CONFIG_CHANGED', compartmentId: id, changes });
  }

  relabelAll(): void {
    this._compartments.forEach((c, i) => {
      c.config.label = `组 #${i + 1}`;
    });
  }

  // ---- Grid mutations ----

  setCell(id: string, col: number, row: number, value: boolean): void {
    const state = this.getState(id);
    if (!state) return;
    const rows = state.grid[0]?.length ?? 0;
    if (col < 0 || col >= state.config.width || row < 0 || row >= rows) return;
    state.grid[col][row] = value;
    this.emit({ type: 'GRID_CHANGED', compartmentId: id, col, row, value });
  }

  toggleCell(id: string, col: number, row: number): boolean {
    const state = this.getState(id);
    if (!state) return false;
    const cur = state.grid[col]?.[row] ?? false;
    const newVal = !cur;
    this.setCell(id, col, row, newVal);
    return newVal;
  }

  clearGrid(id: string): void {
    const state = this.getState(id);
    if (!state) return;
    for (let c = 0; c < state.grid.length; c++)
      for (let r = 0; r < state.grid[c].length; r++)
        state.grid[c][r] = false;
    this.emit({ type: 'GRID_CLEARED', compartmentId: id });
  }

  // ---- Playback state ----

  setPlaybackColumn(id: string, col: number): void {
    const state = this.getState(id);
    if (state) {
      state.currentColumn = col;
      this.emit({ type: 'PLAYBACK_COLUMN_CHANGED', compartmentId: id, column: col });
    }
  }

  resetPlaybackColumn(id: string): void {
    const state = this.getState(id);
    if (state) {
      state.currentColumn = -1;
      this.emit({ type: 'PLAYBACK_COLUMN_CHANGED', compartmentId: id, column: -1 });
    }
  }

  setPlaying(playing: boolean): void {
    this._isPlaying = playing;
    if (!playing) {
      // Reset all column cursors
      this._compartments.forEach(c => {
        c.currentColumn = -1;
      });
    }
    this.emit({ type: playing ? 'PLAYBACK_STARTED' : 'PLAYBACK_STOPPED' });
  }

  setActiveCompartment(id: string | null): void {
    this._activeCompartmentId = id;
    if (id) this.emit({ type: 'RELAY_SWITCHED', fromId: null, toId: id });
  }

  // ---- Project load/save ----

  loadProject(compartments: CompartmentState[]): void {
    this._compartments = compartments;
    this._isPlaying = false;
    this._activeCompartmentId = null;
    this.emit({ type: 'PROJECT_LOADED' });
  }
}

// Singleton instance
export const appStore = new AppStore();

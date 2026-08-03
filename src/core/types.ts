// ============================================================
// Core type definitions for ToneMatrixEX
// ============================================================

export type NoteRange = 'pentatonic' | 'diatonic' | 'chromatic';
export type WaveType = 'sine' | 'sawtooth' | 'square' | 'triangle';

/** Rows per note range — direct port from C# NoteRange enum */
export const NOTE_RANGE_ROWS: Record<NoteRange, number> = {
  pentatonic: 16,
  diatonic:   24,
  chromatic:  32,
};

// Labels are now handled via i18n: t('types.pentatonic'), etc.

/** Per-compartment configuration — equivalent to C# GridGroup */
export interface CompartmentConfig {
  id: string;
  label: string;
  /** Number of step columns (1–64) */
  width: number;
  noteRange: NoteRange;
  /** Independent BPM for this compartment (30–400) */
  bpm: number;
  /** Whether this compartment participates in relay playback */
  isActive: boolean;
  waveType: WaveType;
  /** 0.0 – 1.5 */
  volume: number;
  /** UI panel width in px (draggable) */
  panelWidth: number;
}

/** Runtime state for a compartment, including grid data */
export interface CompartmentState {
  config: CompartmentConfig;
  /** grid[col][row]: col = 0..width-1, row = 0..rows-1 (row 0 = highest pitch) */
  grid: boolean[][];
  /** Which column the playback cursor is on (-1 = not playing) */
  currentColumn: number;
}

// ---- Event bus types ----
export type AppEvent =
  | { type: 'GRID_CHANGED';              compartmentId: string; col: number; row: number; value: boolean }
  | { type: 'GRID_CLEARED';              compartmentId: string }
  | { type: 'COMPARTMENT_ADDED';         compartmentId: string }
  | { type: 'COMPARTMENT_REMOVED';       compartmentId: string }
  | { type: 'COMPARTMENT_CONFIG_CHANGED';compartmentId: string; changes: Partial<CompartmentConfig> }
  | { type: 'COMPARTMENT_REORDERED' }
  | { type: 'PLAYBACK_STARTED' }
  | { type: 'PLAYBACK_STOPPED' }
  | { type: 'PLAYBACK_COLUMN_CHANGED';   compartmentId: string; column: number }
  | { type: 'RELAY_SWITCHED';            fromId: string | null; toId: string }
  | { type: 'PROJECT_LOADED' };

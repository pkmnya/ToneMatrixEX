/**
 * ScaleBuilder — direct port of C# SynthInstrument.BuildScale()
 * Produces ordered note name arrays for the three scale modes.
 * Row 0 = highest pitch (reversed from low-to-high so top of grid = high note).
 */

import type { NoteRange } from './types';

// ---- Fixed scales (ported from C# hardcoded arrays) ----

const PENTATONIC_NOTES_ASC: readonly string[] = [
  'C4', 'D4', 'E4', 'G4', 'A4',
  'C5', 'D5', 'E5', 'G5', 'A5',
  'C6', 'D6', 'E6', 'G6', 'A6',
  'C7',
];

const DIATONIC_NOTES_ASC: readonly string[] = [
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5',
  'C6', 'D6', 'E6', 'F6', 'G6', 'A6', 'B6',
  'C7', 'D7', 'E7',
];

const CHROMATIC_NOTES_ASC: readonly string[] = [
  'C4',  'C#4', 'D4',  'D#4', 'E4',  'F4',  'F#4', 'G4',  'G#4', 'A4',  'A#4', 'B4',
  'C5',  'C#5', 'D5',  'D#5', 'E5',  'F5',  'F#5', 'G5',  'G#5', 'A5',  'A#5', 'B5',
  'C6',  'C#6', 'D6',  'D#6', 'E6',  'F6',  'F#6', 'G6',
];

// ---- Frequency table (C4 base) ----
const BASE_FREQS: Record<string, number> = {
  C: 261.63, 'C#': 277.18, D: 293.66, 'D#': 311.13,
  E: 329.63,  F: 349.23,  'F#': 369.99, G: 392.00,
  'G#': 415.30, A: 440.00, 'A#': 466.16, B: 493.88,
};

/**
 * Returns the note name array for the given range.
 * Index 0 = highest pitch (top of grid), last index = lowest pitch.
 */
export function getScaleNotes(range: NoteRange): string[] {
  switch (range) {
    case 'pentatonic': return [...PENTATONIC_NOTES_ASC].reverse();
    case 'diatonic':   return [...DIATONIC_NOTES_ASC].reverse();
    case 'chromatic':  return [...CHROMATIC_NOTES_ASC].reverse();
  }
}

/** Convert a note name like "C#4" or "G3" to Hz */
export function noteToFrequency(noteName: string): number {
  const m = noteName.match(/^([A-G]#?)(-?\d+)$/);
  if (!m) return 440;
  const [, name, octStr] = m;
  const octave = parseInt(octStr, 10);
  const base = BASE_FREQS[name] ?? 440;
  return base * Math.pow(2, octave - 4);
}

/** Returns the frequency (Hz) for grid row `row` with the given scale */
export function rowToFrequency(range: NoteRange, row: number): number {
  const notes = getScaleNotes(range);
  const name = notes[row] ?? notes[notes.length - 1];
  return noteToFrequency(name);
}

/** Returns a short display label for a row (used on grid Y-axis labels) */
export function rowToNoteLabel(range: NoteRange, row: number): string {
  const notes = getScaleNotes(range);
  return notes[row] ?? '';
}

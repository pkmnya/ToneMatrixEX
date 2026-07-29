/**
 * AudioEngine — Tone.js wrapper.
 * Equivalent to C# SynthInstrument + AudioPlaybackEngine.
 *
 * Design:
 * - One SynthPool per compartment (PolySynth + effects chain)
 * - Shared Tone.Destination
 * - Supports: playColumn, testNote (immediate), silence, dispose
 */

import * as Tone from 'tone';
import { rowToFrequency } from '../core/ScaleBuilder';
import type { CompartmentConfig, NoteRange, WaveType } from '../core/types';

// ---- ADSR defaults (ported from C# SynthInstrument.PreGenerateSounds) ----
const ADSR_DEFAULTS = {
  attack:  0.001,
  decay:   0.15,
  sustain: 0.2,
  release: 0.6,
} as const;

// Note duration when triggered (slightly shorter than one step)
const NOTE_DURATION = '8n';

interface SynthPool {
  polySynth: Tone.PolySynth;
  reverb: Tone.Reverb;
  filter: Tone.Filter;
  vol: Tone.Volume;
  disposed: boolean;
}

export class AudioEngine {
  private pools = new Map<string, SynthPool>();
  private _initialized = false;

  /** Must be called after a user gesture (browser requirement) */
  async init(): Promise<void> {
    if (this._initialized) return;
    await Tone.start();
    this._initialized = true;
  }

  get initialized(): boolean { return this._initialized; }

  // ---- Pool lifecycle ----

  /** Create or recreate the synth pool for a compartment */
  createPool(config: CompartmentConfig): void {
    this.disposePool(config.id);

    const oscType = this._waveTypeToTone(config.waveType);

    const polySynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: oscType },
      envelope: { ...ADSR_DEFAULTS },
    });

    // Effects chain (mirrors C# SynthInstrument):
    // polySynth → filter → reverb → volume → destination
    const filter = new Tone.Filter(5000, 'lowpass');
    const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.2 });
    const vol    = new Tone.Volume(Tone.gainToDb(config.volume));

    polySynth.chain(filter, reverb, vol, Tone.getDestination());

    this.pools.set(config.id, { polySynth, reverb, filter, vol, disposed: false });
  }

  /** Update volume without recreating the pool */
  setVolume(id: string, volume: number): void {
    const pool = this.pools.get(id);
    if (pool && !pool.disposed) {
      pool.vol.volume.value = Tone.gainToDb(Math.max(0.001, volume));
    }
  }

  /** Update wave type — requires pool recreation */
  disposePool(id: string): void {
    const pool = this.pools.get(id);
    if (pool && !pool.disposed) {
      pool.disposed = true;
      try {
        pool.polySynth.releaseAll();
        pool.polySynth.dispose();
        pool.filter.dispose();
        pool.reverb.dispose();
        pool.vol.dispose();
      } catch (_) { /* ignore disposal errors */ }
    }
    this.pools.delete(id);
  }

  disposeAll(): void {
    for (const id of this.pools.keys()) this.disposePool(id);
  }

  // ---- Note playback ----

  /**
   * Play all active notes in the given column — called by PlaybackController.
   * `time` is an AudioContext time stamp (from Tone.js Transport callback).
   */
  playColumn(
    compartmentId: string,
    grid: boolean[][],
    col: number,
    noteRange: NoteRange,
    time?: number,
  ): void {
    const pool = this.pools.get(compartmentId);
    if (!pool || pool.disposed) return;

    const rows = grid[col]?.length ?? 0;
    const freqs: number[] = [];

    for (let row = 0; row < rows; row++) {
      if (grid[col][row]) {
        freqs.push(rowToFrequency(noteRange, row));
      }
    }

    if (freqs.length === 0) return;

    // Apply polyphony volume normalization (mirrors C# polyphony logic)
    const polyVol = freqs.length > 1 ? Tone.gainToDb(1 / freqs.length) : 0;

    try {
      if (time !== undefined) {
        pool.polySynth.triggerAttackRelease(freqs, NOTE_DURATION, time, Math.pow(10, polyVol / 20));
      } else {
        pool.polySynth.triggerAttackRelease(freqs, NOTE_DURATION);
      }
    } catch (_) { /* audio context not ready */ }
  }

  /**
   * Immediately play a single note — called on grid cell click (test note).
   * Equivalent to C# Grid.TestPlayNote().
   */
  testNote(compartmentId: string, row: number, noteRange: NoteRange): void {
    const pool = this.pools.get(compartmentId);
    if (!pool || pool.disposed) return;
    const freq = rowToFrequency(noteRange, row);
    try {
      pool.polySynth.triggerAttackRelease(freq, NOTE_DURATION, Tone.now());
    } catch (_) { /* ignore */ }
  }

  silenceAll(): void {
    for (const pool of this.pools.values()) {
      if (!pool.disposed) {
        try { pool.polySynth.releaseAll(); } catch (_) { /* ignore */ }
      }
    }
  }

  // ---- Helper ----

  private _waveTypeToTone(w: WaveType): OscillatorType {
    const map: Record<WaveType, OscillatorType> = {
      sine: 'sine',
      sawtooth: 'sawtooth',
      square: 'square',
      triangle: 'triangle',
    };
    return map[w];
  }
}

export const audioEngine = new AudioEngine();

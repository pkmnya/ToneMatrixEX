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
import { rowToFrequency, rowToNoteName } from '../core/ScaleBuilder';
import type { CompartmentConfig, NoteRange, WaveType } from '../core/types';
import { AudioFactory } from './AudioFactory';

// Note duration when triggered (16th-note step for clean release without smearing)
const NOTE_DURATION = '16n';

interface SynthPool {
  synthNode: Tone.PolySynth | Tone.Sampler;
  fxNode: Tone.ToneAudioNode | null;
  vol: Tone.Volume;
  disposed: boolean;
}

export class AudioEngine {
  private pools = new Map<string, SynthPool>();
  private _initialized = false;

  constructor() {
    // Attempt early unlock of Web Audio context on the first screen tap
    // (Crucial for iOS Safari and some Android Emulators)
    const unlock = () => {
      if (!this._initialized) {
        Tone.start().then(() => {
          this._initialized = true;
        }).catch(() => {});
      }
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    // Passive true is important so it doesn't block scrolling
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

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
    const { synthNode, fxNode, volNode } = AudioFactory.buildAudioChain(config, false);
    this.pools.set(config.id, { synthNode, fxNode, vol: volNode, disposed: false });
  }

  /** Update volume without recreating the pool */
  setVolume(id: string, volume: number): void {
    const pool = this.pools.get(id);
    if (pool && !pool.disposed) {
      pool.vol.volume.value = Tone.gainToDb(Math.max(0.001, volume));
    }
  }

  disposePool(id: string): void {
    const pool = this.pools.get(id);
    if (pool && !pool.disposed) {
      pool.disposed = true;
      try {
        if (pool.synthNode instanceof Tone.PolySynth) {
          pool.synthNode.releaseAll();
        } else if (pool.synthNode instanceof Tone.Sampler) {
          pool.synthNode.releaseAll();
        }
        pool.synthNode.dispose();
        if (pool.fxNode) pool.fxNode.dispose();
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
    const freqs: (number | string)[] = [];

    for (let row = 0; row < rows; row++) {
      if (grid[col][row]) {
        if (pool.synthNode instanceof Tone.Sampler) {
          freqs.push(rowToNoteName(noteRange, row));
        } else {
          freqs.push(rowToFrequency(noteRange, row));
        }
      }
    }

    if (freqs.length === 0) return;

    // Apply polyphony volume normalization (mirrors original logic to prevent master limiter crushing sine waves)
    const polyVol = freqs.length > 1 ? Tone.gainToDb(1 / freqs.length) : 0;

    try {
      if (time !== undefined) {
        pool.synthNode.triggerAttackRelease(freqs, NOTE_DURATION, time, Math.pow(10, polyVol / 20));
      } else {
        pool.synthNode.triggerAttackRelease(freqs, NOTE_DURATION);
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
    const freq = pool.synthNode instanceof Tone.Sampler 
      ? rowToNoteName(noteRange, row)
      : rowToFrequency(noteRange, row);
    try {
      pool.synthNode.triggerAttackRelease(freq, NOTE_DURATION, Tone.now());
    } catch (_) { /* ignore */ }
  }

  silenceAll(): void {
    for (const pool of this.pools.values()) {
      if (!pool.disposed) {
        try { 
          if (pool.synthNode instanceof Tone.PolySynth) pool.synthNode.releaseAll(); 
          else if (pool.synthNode instanceof Tone.Sampler) pool.synthNode.releaseAll(); 
        } catch (_) { /* ignore */ }
      }
    }
  }

  // ---- Helper ----


}

export const audioEngine = new AudioEngine();

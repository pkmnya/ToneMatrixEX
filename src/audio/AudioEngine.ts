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
import type { CompartmentConfig, NoteRange, WaveType, FxType } from '../core/types';

// ---- ADSR defaults (optimized for percussive mallet/chime ToneMatrix sound) ----
const ADSR_DEFAULTS = {
  attack:  0.002,
  decay:   0.3,
  sustain: 0.05,
  release: 0.5,
} as const;

// Note duration when triggered (16th-note step for clean release without smearing)
const NOTE_DURATION = '16n';

interface SynthPool {
  polySynth: Tone.PolySynth;
  fxNode: Tone.ToneAudioNode | null;
  eq: Tone.EQ3;
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

    // Effects chain (synchronous — no async IR like Reverb):
    // polySynth → highpass filter (130Hz) → eq → [fxNode] → volume → destination
    const filter = new Tone.Filter(130, 'highpass');
    const eq = new Tone.EQ3({ low: -4, mid: 0, high: 3 });
    const vol = new Tone.Volume(Tone.gainToDb(config.volume));

    let fxNode: Tone.ToneAudioNode | null = null;
    
    if (config.fxType === 'pingpong') {
      // delayTime: 8n, feedback scales from 0.0 to 0.6 based on fxLength
      fxNode = new Tone.PingPongDelay({ delayTime: '8n', feedback: config.fxLength * 0.6, wet: 0.15 + (config.fxLength * 0.1) });
    } else if (config.fxType === 'chorus') {
      // chorus depth scales with fxLength, frequency fixed at 1.5Hz
      fxNode = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5 + (config.fxLength * 0.5), wet: 0.5 }).start();
    } else if (config.fxType === 'freeverb') {
      // roomSize scales with fxLength
      fxNode = new Tone.Freeverb({ roomSize: 0.4 + (config.fxLength * 0.5), dampening: 3000, wet: 0.4 });
    }

    if (fxNode) {
      polySynth.chain(filter, eq, fxNode, vol, Tone.getDestination());
    } else {
      polySynth.chain(filter, eq, vol, Tone.getDestination());
    }

    this.pools.set(config.id, { polySynth, fxNode, eq, filter, vol, disposed: false });
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
        pool.polySynth.releaseAll();
        pool.polySynth.dispose();
        pool.filter.dispose();
        pool.eq.dispose();
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

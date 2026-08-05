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

    let synthNode: Tone.PolySynth | Tone.Sampler;

    if (config.waveType === 'piano') {
      synthNode = new Tone.Sampler({
        urls: {
          A0: "A0.mp3",
          C1: "C1.mp3",
          A1: "A1.mp3",
          C2: "C2.mp3",
          A2: "A2.mp3",
          C3: "C3.mp3",
          A3: "A3.mp3",
          C4: "C4.mp3",
          A4: "A4.mp3",
          C5: "C5.mp3",
          A5: "A5.mp3",
          C6: "C6.mp3",
          A6: "A6.mp3",
          C7: "C7.mp3",
          A7: "A7.mp3",
        },
        baseUrl: "https://tonejs.github.io/audio/salamander/",
      });
    } else {
      const oscType = this._waveTypeToTone(config.waveType);
      synthNode = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: oscType as any },
        envelope: { ...ADSR_DEFAULTS },
      });
    }

    // Effects chain (simplified for mobile/emulator stability)
    const vol = new Tone.Volume(Tone.gainToDb(config.volume)).toDestination();

    let fxNode: Tone.ToneAudioNode | null = null;
    
    if (config.fxType === 'pingpong') {
      fxNode = new Tone.PingPongDelay({ delayTime: '8n', feedback: config.fxLength * 0.85, wet: 0.2 + (config.fxLength * 0.3) });
    } else if (config.fxType === 'chorus') {
      fxNode = new Tone.Chorus({ frequency: 2, delayTime: 4, depth: 0.5 + (config.fxLength * 0.5), feedback: config.fxLength * 0.5, wet: 0.5 }).start();
    } else if (config.fxType === 'freeverb') {
      fxNode = new Tone.Freeverb({ roomSize: 0.5 + (config.fxLength * 0.48), dampening: 3000, wet: 0.3 + (config.fxLength * 0.4) });
    } else if (config.fxType === 'autofilter') {
      fxNode = new Tone.AutoFilter({ frequency: "4n", baseFrequency: 200, octaves: 2 + (config.fxLength * 3), depth: 0.2 + (config.fxLength * 0.8), wet: 0.5 + (config.fxLength * 0.5) }).start();
    } else if (config.fxType === 'bitcrusher') {
      const bits = Math.max(1, Math.round(8 - (config.fxLength * 7)));
      fxNode = new Tone.BitCrusher(bits);
    } else if (config.fxType === 'phaser') {
      fxNode = new Tone.Phaser({ frequency: 0.2 + (config.fxLength * 1.8), octaves: 3, baseFrequency: 300, wet: 0.4 + (config.fxLength * 0.4) });
    } else if (config.fxType === 'tremolo') {
      fxNode = new Tone.Tremolo({ frequency: 8, type: 'square', depth: 0.2 + (config.fxLength * 0.8), wet: 1.0 }).start();
    }

    if (fxNode) {
      synthNode.chain(fxNode, vol);
    } else {
      synthNode.connect(vol);
    }

    this.pools.set(config.id, { synthNode, fxNode, vol, disposed: false });
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

    // Apply polyphony volume normalization (mirrors C# polyphony logic)
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

  private _waveTypeToTone(wt: WaveType): Tone.ToneOscillatorType {
    // Standard waveforms are safer and more performant on mobile/emulators
    switch (wt) {
      case 'sine': return 'sine';
      case 'sawtooth': return 'sawtooth';
      case 'triangle': return 'triangle';
      case 'square': return 'square';
      default: return 'sine';
    }
  }
}

export const audioEngine = new AudioEngine();

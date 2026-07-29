/**
 * Mp3Exporter — exports all compartments sequentially to an MP3 file.
 *
 * Strategy:
 * 1. For each compartment, use Tone.Offline() to render one full loop.
 * 2. Concatenate all AudioBuffers into one long buffer.
 * 3. Convert Float32 PCM → Int16 PCM → lamejs Mp3Encoder → Blob → download.
 *
 * Duration per compartment:
 *   loopSeconds = width * 60 / (bpm * 4)
 *   (width 16th-notes at bpm beats-per-minute)
 */

import * as Tone from 'tone';
// @ts-ignore — lamejs has no bundled types
import { Mp3Encoder } from 'lamejs';
// @ts-ignore
import MPEGMode from 'lamejs/src/js/MPEGMode.js';
// @ts-ignore
import Lame from 'lamejs/src/js/Lame.js';
// @ts-ignore
import BitStream from 'lamejs/src/js/BitStream.js';
// @ts-ignore
import common from 'lamejs/src/js/common.js';
import { rowToFrequency } from '../core/ScaleBuilder';
import type { CompartmentState } from '../core/types';

// Setup required globals for lamejs internal CommonJS scripts in Vite ESM bundle
function setupLamejsGlobals(): void {
  const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
  g['MPEGMode'] = MPEGMode;
  g['Lame'] = Lame;
  g['BitStream'] = BitStream;
  if (common && typeof common === 'object') {
    for (const key of Object.keys(common)) {
      g[key] = (common as Record<string, unknown>)[key];
    }
  }
}
import { NOTE_RANGE_ROWS } from '../core/types';

export interface ExportProgress {
  compartmentIndex: number;
  total: number;
  phase: 'rendering' | 'encoding' | 'done';
}

export type ProgressCallback = (p: ExportProgress) => void;

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BIT_RATE = 192; // kbps

export class Mp3Exporter {
  /**
   * Export all compartments (regardless of isActive) to a single MP3.
   */
  static async exportAll(
    compartments: readonly CompartmentState[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const total = compartments.length;
    const allBuffers: AudioBuffer[] = [];

    for (let i = 0; i < total; i++) {
      const comp = compartments[i];
      onProgress?.({ compartmentIndex: i, total, phase: 'rendering' });

      const buf = await this._renderCompartment(comp);
      allBuffers.push(buf);
    }

    onProgress?.({ compartmentIndex: total - 1, total, phase: 'encoding' });

    const mp3Blob = await this._encodeToMp3(allBuffers);

    onProgress?.({ compartmentIndex: total - 1, total, phase: 'done' });

    this._triggerDownload(mp3Blob, `tonematrix-export-${Date.now()}.mp3`);
  }

  // ---- Private ----

  private static async _renderCompartment(comp: CompartmentState): Promise<AudioBuffer> {
    const { config, grid } = comp;
    const rows = NOTE_RANGE_ROWS[config.noteRange];
    const stepSeconds = 60 / (config.bpm * 4); // one 16th-note in seconds
    const loopSeconds = config.width * stepSeconds;

    // Tail long enough for PingPongDelay echoes to decay naturally
    const tailSeconds = 2.0;
    const totalSeconds = loopSeconds + tailSeconds;

    const buffer = await Tone.Offline(({ transport }) => {
      // ---- Exactly mirrors AudioEngine.createPool() ----
      const polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: this._toOscType(config.waveType) },
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.5 },
      });

      // Highpass filter to cut low-end mud (same as live engine)
      const filter = new Tone.Filter(130, 'highpass');
      // EQ3: gentle low cut, high presence boost for chime brightness
      const eq = new Tone.EQ3({ low: -4, mid: 0, high: 3 });
      // PingPongDelay: same params as live engine, fully synchronous (no async IR)
      const delay = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.18, wet: 0.14 });
      const vol   = new Tone.Volume(Tone.gainToDb(config.volume));

      polySynth.chain(filter, eq, delay, vol, Tone.getDestination());
      // ---- end mirror ----

      transport.bpm.value = config.bpm;

      // Schedule each column's notes
      for (let col = 0; col < config.width; col++) {
        const triggerTime = col * stepSeconds;
        const freqs: number[] = [];
        for (let row = 0; row < rows; row++) {
          if (grid[col]?.[row]) {
            freqs.push(rowToFrequency(config.noteRange, row));
          }
        }
        if (freqs.length > 0) {
          // Apply same polyphony volume normalization as live engine
          const polyVol = freqs.length > 1 ? Tone.gainToDb(1 / freqs.length) : 0;
          polySynth.triggerAttackRelease(freqs, '16n', triggerTime, Math.pow(10, polyVol / 20));
        }
      }

      transport.start();
    }, totalSeconds, CHANNELS, SAMPLE_RATE);

    return buffer as unknown as AudioBuffer;
  }

  private static async _encodeToMp3(buffers: AudioBuffer[]): Promise<Blob> {
    // Calculate total sample count
    const totalSamples = buffers.reduce((s, b) => s + b.length, 0);

    // Merge all buffers
    const mergedL = new Float32Array(totalSamples);
    const mergedR = new Float32Array(totalSamples);
    let offset = 0;
    for (const buf of buffers) {
      mergedL.set(buf.getChannelData(0), offset);
      if (buf.numberOfChannels > 1) {
        mergedR.set(buf.getChannelData(1), offset);
      } else {
        mergedR.set(buf.getChannelData(0), offset);
      }
      offset += buf.length;
    }

    // Float32 → Int16
    const pcmL = this._floatToInt16(mergedL);
    const pcmR = this._floatToInt16(mergedR);

    // lamejs encode
    setupLamejsGlobals();
    const encoder = new Mp3Encoder(CHANNELS, SAMPLE_RATE, BIT_RATE);
    const CHUNK = 1152; // lamejs recommended chunk size
    const mp3Parts: Uint8Array[] = [];

    for (let i = 0; i < pcmL.length; i += CHUNK) {
      const chunkL = pcmL.subarray(i, i + CHUNK);
      const chunkR = pcmR.subarray(i, i + CHUNK);
      const mp3buf = encoder.encodeBuffer(chunkL, chunkR);
      if (mp3buf.length > 0) mp3Parts.push(mp3buf);
    }

    const flushed = encoder.flush();
    if (flushed.length > 0) mp3Parts.push(flushed);

    // Cast to any to avoid SharedArrayBuffer vs ArrayBuffer TS distinction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Blob(mp3Parts as any[], { type: 'audio/mpeg' });
  }

  private static _floatToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  private static _triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  private static _toOscType(w: string): OscillatorType {
    const map: Record<string, OscillatorType> = {
      sine: 'sine', sawtooth: 'sawtooth', square: 'square', triangle: 'triangle',
    };
    return map[w] ?? 'sine';
  }
}

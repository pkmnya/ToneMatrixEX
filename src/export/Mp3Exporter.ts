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
import type { CompartmentState, WaveType } from '../core/types';
import { ProjectSerializer } from '../codec/ProjectSerializer';

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

    const stateCode = ProjectSerializer.serialize(compartments);
    const mp3Blob = await this._encodeToMp3(allBuffers, stateCode);

    onProgress?.({ compartmentIndex: total - 1, total, phase: 'done' });

    this._triggerDownload(mp3Blob, `tonematrix-export-${Date.now()}.mp3`);
  }

  // ---- Private ----

  private static async _renderCompartment(comp: CompartmentState): Promise<AudioBuffer> {
    const { config, grid } = comp;
    const rows = NOTE_RANGE_ROWS[config.noteRange];
    const stepSeconds = 60 / (config.bpm * 4); // one 16th-note in seconds
    const loopSeconds = config.width * stepSeconds;

    // Dynamic tail based on FX
    let tailSeconds = 0.5; // Base tail for ADSR release
    if (config.fxType === 'pingpong' || config.fxType === 'freeverb') {
      tailSeconds += 0.5 + (config.fxLength * 3.5); // Up to 4s extra for long reverbs/delays
    } else if (config.fxType === 'chorus') {
      tailSeconds += 0.5;
    }
    const totalSeconds = loopSeconds + tailSeconds;

    const buffer = await Tone.Offline(({ transport }) => {
      // ---- Exactly mirrors AudioEngine.createPool() ----
      const polySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: this._toOscType(config.waveType) as any },
        envelope: { attack: 0.002, decay: 0.3, sustain: 0.05, release: 0.5 },
      });

      // Simplified effects chain for mobile emulator stability
      const vol = new Tone.Volume(Tone.gainToDb(config.volume)).toDestination();

      let fxNode: Tone.ToneAudioNode | null = null;
      if (config.fxType === 'pingpong') {
        fxNode = new Tone.PingPongDelay({ delayTime: '8n', feedback: config.fxLength * 0.6, wet: 0.15 + (config.fxLength * 0.1) });
      } else if (config.fxType === 'chorus') {
        fxNode = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.5 + (config.fxLength * 0.5), wet: 0.5 }).start();
      } else if (config.fxType === 'freeverb') {
        fxNode = new Tone.Freeverb({ roomSize: 0.4 + (config.fxLength * 0.5), dampening: 3000, wet: 0.4 });
      }

      if (fxNode) {
        polySynth.chain(fxNode, vol);
      } else {
        polySynth.connect(vol);
      }
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
          // Use absolute stepSeconds instead of '16n' to guarantee correct duration regardless of Tone.Offline BPM bugs
          polySynth.triggerAttackRelease(freqs, stepSeconds, triggerTime, Math.pow(10, polyVol / 20));
        }
      }

      transport.start();
    }, totalSeconds, CHANNELS, SAMPLE_RATE);

    return buffer as unknown as AudioBuffer;
  }

  private static async _encodeToMp3(buffers: AudioBuffer[], stateCode?: string): Promise<Blob> {
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

    if (stateCode) {
      const id3Tag = this._createId3Tag(stateCode);
      mp3Parts.unshift(id3Tag); // Prepend ID3 tag
    }

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

  private static _toOscType(wt: WaveType): Tone.ToneOscillatorType {
    switch (wt) {
      case 'sine': return 'sine';
      case 'sawtooth': return 'sawtooth';
      case 'triangle': return 'triangle';
      case 'square': return 'square';
      default: return 'sine';
    }
  }

  private static _createId3Tag(stateString: string): Uint8Array {
    const enc = new TextEncoder();
    const desc = enc.encode("TONEMATRIX_STATE\0");
    const val = enc.encode(stateString);
    
    // TXXX frame payload size: 1 (encoding byte 0x03 for UTF-8) + desc.length + val.length
    const framePayloadSize = 1 + desc.length + val.length;
    const frameSize = 10 + framePayloadSize;
    
    // Total ID3 tag size (excluding 10-byte header)
    const tagSize = frameSize;
    // 4 syncsafe bytes
    const size1 = (tagSize >> 21) & 0x7F;
    const size2 = (tagSize >> 14) & 0x7F;
    const size3 = (tagSize >> 7) & 0x7F;
    const size4 = tagSize & 0x7F;
    
    const buffer = new Uint8Array(10 + tagSize);
    
    // Header
    buffer.set([0x49, 0x44, 0x33], 0); // "ID3"
    buffer.set([0x03, 0x00], 3); // Version 3.0
    buffer.set([0x00], 5); // Flags
    buffer.set([size1, size2, size3, size4], 6); // Size
    
    // TXXX Frame Header
    buffer.set([0x54, 0x58, 0x58, 0x58], 10); // "TXXX"
    buffer.set([
      (framePayloadSize >> 24) & 0xFF,
      (framePayloadSize >> 16) & 0xFF,
      (framePayloadSize >> 8) & 0xFF,
      framePayloadSize & 0xFF
    ], 14); // Frame Size
    buffer.set([0x00, 0x00], 18); // Frame Flags
    
    // TXXX Frame Payload
    buffer.set([0x03], 20); // Encoding: UTF-8
    buffer.set(desc, 21); // Description
    buffer.set(val, 21 + desc.length); // Value
    
    return buffer;
  }

  static extractStateFromMp3(buffer: ArrayBuffer): string | null {
    const bytes = new Uint8Array(buffer);
    const signature = "TONEMATRIX_STATE\0";
    const sigBytes = new TextEncoder().encode(signature);
    
    for (let i = 0; i < bytes.length - sigBytes.length; i++) {
      let match = true;
      for (let j = 0; j < sigBytes.length; j++) {
        if (bytes[i + j] !== sigBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        const start = i + sigBytes.length;
        let end = start;
        // Search for the end of the frame or null terminator
        // Since it's ID3v2, the frame size is given, but searching for TMX_v2 pattern is safer
        // Actually we can just read until a non-printable ascii char or 0x00
        while (end < bytes.length && bytes[end] !== 0x00 && bytes[end] >= 0x20 && bytes[end] <= 0x7E) {
          end++;
        }
        const stateBytes = bytes.subarray(start, end);
        return new TextDecoder().decode(stateBytes);
      }
    }
    return null;
  }
}

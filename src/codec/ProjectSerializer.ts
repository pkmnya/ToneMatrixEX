/**
 * ProjectSerializer — serializes/deserializes the entire project to a string.
 *
 * Format:
 *   TMX_v2|<comp1>|<comp2>|...
 *
 * Each compartment:
 *   <active>,<bpm>,<noteRange>,<width>,<waveType>,<volume>,<panelWidth>,<HEXBITMAP>
 *
 * This format is URL-hash-safe (no base64, just hex + delimiters).
 */

import type { CompartmentState, NoteRange, WaveType, FxType } from '../core/types';
import { NOTE_RANGE_ROWS } from '../core/types';
import { BitmapCodec } from './BitmapCodec';

const VERSION_PREFIX = 'TMX_v2';
const SEP_OUTER = '|';
const SEP_INNER = ',';

type NoteRangeCode = '0' | '1' | '2';
type WaveTypeCode  = '0' | '1' | '2' | '3';

const NOTE_RANGE_TO_CODE: Record<NoteRange, NoteRangeCode> = {
  pentatonic: '0',
  diatonic:   '1',
  chromatic:  '2',
};
const CODE_TO_NOTE_RANGE: Record<string, NoteRange> = {
  '0': 'pentatonic',
  '1': 'diatonic',
  '2': 'chromatic',
};

const WAVE_TYPE_TO_CODE: Record<WaveType, WaveTypeCode> = {
  sine:     '0',
  sawtooth: '1',
  square:   '2',
  triangle: '3',
};
const CODE_TO_WAVE_TYPE: Record<string, WaveType> = {
  '0': 'sine',
  '1': 'sawtooth',
  '2': 'square',
  '3': 'triangle',
};

type FxTypeCode = '0' | '1' | '2' | '3';
const FX_TYPE_TO_CODE: Record<FxType, FxTypeCode> = {
  none: '0',
  pingpong: '1',
  chorus: '2',
  freeverb: '3',
};
const CODE_TO_FX_TYPE: Record<string, FxType> = {
  '0': 'none',
  '1': 'pingpong',
  '2': 'chorus',
  '3': 'freeverb',
};

export class ProjectSerializer {
  static serialize(compartments: readonly CompartmentState[]): string {
    const parts = compartments.map((c) => {
      const { config, grid } = c;
      const rows = NOTE_RANGE_ROWS[config.noteRange];
      const hex = BitmapCodec.encode(grid, config.width, rows);
      return [
        config.isActive ? '1' : '0',
        config.bpm.toFixed(0),
        NOTE_RANGE_TO_CODE[config.noteRange],
        config.width.toString(),
        WAVE_TYPE_TO_CODE[config.waveType],
        config.volume.toFixed(2),
        config.panelWidth.toString(),
        FX_TYPE_TO_CODE[config.fxType],
        config.fxLength.toFixed(2),
        hex,
      ].join(SEP_INNER);
    });
    return [VERSION_PREFIX, ...parts].join(SEP_OUTER);
  }

  static deserialize(raw: string): CompartmentState[] | null {
    try {
      const chunks = raw.split(SEP_OUTER);
      if (chunks[0] !== VERSION_PREFIX) return null;

      const states: CompartmentState[] = [];

      for (let i = 1; i < chunks.length; i++) {
        const fields = chunks[i].split(SEP_INNER);
        if (fields.length < 8) return null;

        const [
          activeStr, bpmStr, rangeCode, widthStr,
          waveCode, volStr, panelWidthStr, 
          field7, field8, field9
        ] = fields;

        // Support both old format (8 fields) and new format (10 fields)
        const isNewFormat = fields.length >= 10;
        const fxCode = isNewFormat ? field7 : '0';
        const fxLenStr = isNewFormat ? field8 : '0';
        const hex = isNewFormat ? field9 : field7;

        const noteRange: NoteRange = CODE_TO_NOTE_RANGE[rangeCode] ?? 'pentatonic';
        const waveType:  WaveType  = CODE_TO_WAVE_TYPE[waveCode]   ?? 'sine';
        const fxType:    FxType    = CODE_TO_FX_TYPE[fxCode]       ?? 'none';
        const fxLength   = Math.max(0, Math.min(1, parseFloat(fxLenStr) || 0));
        const width      = Math.max(1, Math.min(512, parseInt(widthStr,  10) || 16));
        const bpm        = Math.max(30, Math.min(400, parseInt(bpmStr,   10) || 120));
        const volume     = Math.max(0, Math.min(1.5,  parseFloat(volStr)     || 0.8));
        const panelWidth = Math.max(200, parseInt(panelWidthStr, 10) || 440);
        const rows       = NOTE_RANGE_ROWS[noteRange];
        const grid       = BitmapCodec.decode(hex, width, rows);

        states.push({
          config: {
            id: `comp-loaded-${i}`,
            label: `组 #${i}`,
            width,
            noteRange,
            bpm,
            isActive: activeStr === '1',
            waveType,
            volume,
            panelWidth,
            fxType,
            fxLength,
          },
          grid,
          currentColumn: -1,
        });
      }

      return states.length > 0 ? states : null;
    } catch {
      return null;
    }
  }

  /** Write to clipboard */
  static async copyToClipboard(compartments: readonly CompartmentState[]): Promise<void> {
    const str = this.serialize(compartments);
    await navigator.clipboard.writeText(str);
  }

  /** Read from clipboard */
  static async pasteFromClipboard(): Promise<CompartmentState[] | null> {
    const text = await navigator.clipboard.readText();
    return this.deserialize(text.trim());
  }

  /** Encode to URL hash */
  static toURLHash(compartments: readonly CompartmentState[]): string {
    return '#' + encodeURIComponent(this.serialize(compartments));
  }

  /** Decode from URL hash */
  static fromURLHash(hash: string): CompartmentState[] | null {
    const raw = decodeURIComponent(hash.replace(/^#/, ''));
    return this.deserialize(raw);
  }
}

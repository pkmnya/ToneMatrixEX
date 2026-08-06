import * as Tone from 'tone';
import type { CompartmentConfig, WaveType } from '../core/types';

const ADSR_DEFAULTS = {
  attack: 0.002,
  decay: 0.3,
  sustain: 0.05,
  release: 0.5,
};

function _waveTypeToTone(wave: WaveType): string {
  if (wave === 'piano') return 'sine';
  return wave;
}

export interface AudioChain {
  synthNode: Tone.PolySynth | Tone.Sampler;
  fxNode: Tone.ToneAudioNode | null;
  volNode: Tone.Volume;
}

export class AudioFactory {
  /**
   * Calculates the extra tail length required for the current configuration.
   * Useful for offline rendering to ensure reverbs and delays are not cut off.
   */
  static calculateTailSeconds(config: CompartmentConfig): number {
    let tailSeconds = config.waveType === 'piano' ? 2.0 : 0.5; // Base tail for natural release

    if (config.fxType === 'pingpong') {
      tailSeconds += 4.0;
    } else if (config.fxType === 'chorus') {
      tailSeconds += 0.5;
    } else if (config.fxType === 'sustain') {
      tailSeconds += 4.0;
    }

    return tailSeconds;
  }

  /**
   * Builds the complete audio chain: Synth -> FX -> Volume
   * If isOffline is true, it does not connect to Tone.Destination, allowing the caller to route it.
   */
  static buildAudioChain(config: CompartmentConfig, isOffline: boolean = false): AudioChain {
    let synthNode: Tone.PolySynth | Tone.Sampler;

    const isSustain = config.fxType === 'sustain';
    const baseRelease = config.waveType === 'piano' ? 2.0 : ADSR_DEFAULTS.release;
    const sustainRelease = baseRelease + 4.0;

    if (config.waveType === 'piano') {
      synthNode = new Tone.Sampler({
        urls: {
          A0: "A0.mp3",
          A4: "A4.mp3",
          A5: "A5.mp3",
          C4: "C4.mp3",
          C5: "C5.mp3",
          C6: "C6.mp3",
          C7: "C7.mp3",
        },
        baseUrl: "/samples/piano/",
        release: isSustain ? sustainRelease : 2,
      });
    } else {
      // @ts-ignore: Tone.js v14 expects flat options for child synth despite TS definitions
      synthNode = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: _waveTypeToTone(config.waveType) as any },
        envelope: { ...ADSR_DEFAULTS, release: isSustain ? sustainRelease : ADSR_DEFAULTS.release },
      });
    }

    // Master volume for this chain
    const volNode = new Tone.Volume(Tone.gainToDb(config.volume));
    if (!isOffline) {
      volNode.toDestination();
    }

    // Post-FX
    let fxNode: Tone.ToneAudioNode | null = null;
    if (config.fxType === 'pingpong') {
      fxNode = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.6, wet: 0.5 });
    } else if (config.fxType === 'chorus') {
      fxNode = new Tone.Chorus({ frequency: 2, delayTime: 4, depth: 1.0, feedback: 0.5, wet: 0.5 }).start();
    } else if (config.fxType === 'phaser') {
      fxNode = new Tone.Phaser({ frequency: 2.0, octaves: 3, baseFrequency: 300, wet: 0.8 });
    } else if (config.fxType === 'tremolo') {
      fxNode = new Tone.Tremolo({ frequency: 8, type: 'square', depth: 1.0, wet: 1.0 }).start();
    }

    // Connect
    if (fxNode) {
      synthNode.chain(fxNode, volNode);
    } else {
      synthNode.connect(volNode);
    }

    return { synthNode, fxNode, volNode };
  }
}

/**
 * PlaybackController — relay sequencer.
 *
 * Design:
 * - One compartment plays at a time (relay/接力 mode).
 * - Uses Tone.Transport.scheduleRepeat at 16th-note intervals.
 * - When a compartment completes its full loop, the next active one starts.
 * - Each compartment has its own BPM — we update Transport.bpm on each switch.
 * - This means BPM changes seamlessly between compartments without restarting Transport.
 */

import * as Tone from 'tone';
import { appStore } from './AppStore';
import { audioEngine } from '../audio/AudioEngine';

export class PlaybackController {
  private _repeatEventId: number | null = null;
  private _currentCompartmentId: string | null = null;
  private _currentColumn = 0;
  private _justSwitched = false; // skip "loop complete" check on the first tick after switch

  constructor() {
    appStore.subscribe((event) => {
      if (!appStore.isPlaying || !this._currentCompartmentId) return;

      if (event.type === 'COMPARTMENT_CONFIG_CHANGED') {
        if (event.compartmentId === this._currentCompartmentId) {
          const state = appStore.getState(event.compartmentId);
          if (!state) return;

          // Live update BPM if changed
          if (event.changes.bpm !== undefined) {
            Tone.getTransport().bpm.value = state.config.bpm;
          }

          // If deactivated during playback, switch to next or stop
          if (event.changes.isActive === false) {
            const next = this._findNextActive(this._currentCompartmentId);
            if (next && next.config.id !== this._currentCompartmentId) {
              this._switchTo(next.config.id);
            } else {
              this.stop();
            }
          }

          // If width shrank below current column, wrap column
          if (this._currentColumn >= state.config.width) {
            this._currentColumn = 0;
          }
        }
      } else if (event.type === 'COMPARTMENT_REMOVED') {
        if (event.compartmentId === this._currentCompartmentId) {
          const next = this._findNextActive(null);
          if (next) {
            this._switchTo(next.config.id);
          } else {
            this.stop();
          }
        }
      }
    });
  }

  // ---- Public API ----

  async start(): Promise<void> {
    await audioEngine.init();
    if (appStore.isPlaying) return;

    const first = this._findNextActive(null);
    if (!first) return;

    appStore.setPlaying(true);
    this._switchTo(first.config.id, true);

    Tone.getTransport().start();
  }

  stop(): void {
    Tone.getTransport().stop();
    this._cancelRepeat();

    if (this._currentCompartmentId) {
      appStore.resetPlaybackColumn(this._currentCompartmentId);
    }
    this._currentCompartmentId = null;
    this._currentColumn = 0;
    appStore.setPlaying(false);
    audioEngine.silenceAll();
  }

  // ---- Internal ----

  private _switchTo(id: string, isFirstStart = false): void {
    const prev = this._currentCompartmentId;

    // Reset previous compartment's cursor
    if (prev && prev !== id) {
      appStore.resetPlaybackColumn(prev);
    }

    this._currentCompartmentId = id;
    this._currentColumn = 0;
    this._justSwitched = true;

    const state = appStore.getState(id);
    if (!state) return;

    // Update Transport BPM for this compartment
    Tone.getTransport().bpm.value = state.config.bpm;

    // Cancel existing repeat and schedule a new one
    this._cancelRepeat();

    this._repeatEventId = Tone.getTransport().scheduleRepeat(
      (time) => this._tick(time),
      '16n',
    );

    appStore.setActiveCompartment(id);
    if (prev !== null && !isFirstStart) {
      appStore.emit({ type: 'RELAY_SWITCHED', fromId: prev, toId: id });
    }
  }

  private _tick(time: number): void {
    const id = this._currentCompartmentId;
    if (!id) return;

    const state = appStore.getState(id);
    if (!state) return;

    const col = this._currentColumn;
    const width = state.config.width;

    // Play this column
    audioEngine.playColumn(id, state.grid, col, state.config.noteRange, time);

    // Update UI column cursor via Draw (runs in rAF, not audio thread)
    Tone.getDraw().schedule(() => {
      appStore.setPlaybackColumn(id, col);
    }, time);

    // Advance column
    this._currentColumn = (col + 1) % width;

    // Detect loop completion: we just wrapped back to column 0
    if (this._currentColumn === 0 && !this._justSwitched) {
      // Schedule the compartment switch in the draw frame (safe for state mutations)
      Tone.getDraw().schedule(() => {
        this._handleLoopComplete(id);
      }, time);
    }

    this._justSwitched = false;
  }

  private _handleLoopComplete(finishedId: string): void {
    if (!appStore.isPlaying) return;

    const next = this._findNextActive(finishedId);
    if (!next || next.config.id === finishedId) {
      // Only one active compartment — keep looping same one
      // Just reset column (already at 0 since we wrapped)
      this._justSwitched = true;
      return;
    }

    this._switchTo(next.config.id);
  }

  private _findNextActive(afterId: string | null) {
    const all = appStore.getAll();
    const active = all.filter(c => c.config.isActive);
    if (active.length === 0) return null;
    if (afterId === null) return active[0];

    const idx = active.findIndex(c => c.config.id === afterId);
    // Wrap around
    return active[(idx + 1) % active.length];
  }

  private _cancelRepeat(): void {
    if (this._repeatEventId !== null) {
      Tone.getTransport().clear(this._repeatEventId);
      this._repeatEventId = null;
    }
  }
}

export const playbackController = new PlaybackController();

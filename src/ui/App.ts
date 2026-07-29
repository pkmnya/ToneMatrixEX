/**
 * App — root component. Orchestrates layout and component lifecycle.
 *
 * Layout:
 *   [Toolbar]
 *   [Compartments scroll area (horizontal)]
 *   [Spectrum visualizer (collapsible)]
 */

import { appStore } from '../core/AppStore';
import { Toolbar } from './Toolbar';
import { CompartmentPanel } from './CompartmentPanel';
import { SpectrumVisualizer } from '../renderer/SpectrumVisualizer';
import * as Tone from 'tone';

export class App {
  private toolbar: Toolbar;
  private panels = new Map<string, CompartmentPanel>();
  private compartmentsEl!: HTMLElement;
  private visualizer!: SpectrumVisualizer;
  private _storeUnsub: (() => void) | null = null;

  constructor(private root: HTMLElement) {
    this.toolbar  = new Toolbar();
    this._buildLayout();
    this._initCompartments();
    this._subscribeStore();
    this._bindToolbarEvents();
  }

  // ---- Layout ----

  private _buildLayout(): void {
    this.root.innerHTML = '';

    this.root.appendChild(this.toolbar.el);

    // Compartments scroll area
    this.compartmentsEl = document.createElement('div');
    this.compartmentsEl.className = 'compartments-area';
    this.compartmentsEl.id = 'compartments-area';
    this.root.appendChild(this.compartmentsEl);

    // Spectrum section
    const specSection = document.createElement('section');
    specSection.className = 'spectrum-section';

    const specHeader = document.createElement('div');
    specHeader.className = 'spectrum-header';
    specHeader.innerHTML = `
      <span class="spectrum-title">◈ 频谱分析</span>
      <button class="spectrum-toggle" id="btn-toggle-spectrum" title="折叠/展开">▲</button>
    `;

    const specCanvas = document.createElement('canvas');
    specCanvas.className = 'spectrum-canvas';
    specCanvas.id = 'spectrum-canvas';

    specSection.append(specHeader, specCanvas);
    this.root.appendChild(specSection);

    // Toggle spectrum
    specHeader.querySelector('#btn-toggle-spectrum')?.addEventListener('click', () => {
      specSection.classList.toggle('spectrum-section--collapsed');
      const btn = specHeader.querySelector('#btn-toggle-spectrum') as HTMLButtonElement;
      btn.textContent = specSection.classList.contains('spectrum-section--collapsed') ? '▼' : '▲';
    });

    // Visualizer
    this.visualizer = new SpectrumVisualizer(specCanvas);
    this.visualizer.start();
  }

  // ---- Compartment management ----

  private _initCompartments(): void {
    for (const state of appStore.getAll()) {
      this._addPanel(state.config.id);
    }
  }

  private _addPanel(id: string): void {
    if (this.panels.has(id)) return;
    const panel = new CompartmentPanel(id);
    this.panels.set(id, panel);
    this.compartmentsEl.appendChild(panel.el);
    this._bindPanelEvents(panel);

    // Animate in
    requestAnimationFrame(() => panel.el.classList.add('comp--visible'));
  }

  private _removePanel(id: string): void {
    const panel = this.panels.get(id);
    if (!panel) return;
    panel.destroy();
    this.panels.delete(id);
  }

  private _bindPanelEvents(panel: CompartmentPanel): void {
    panel.el.addEventListener('compartment:add', (e) => {
      const { afterId } = (e as CustomEvent).detail;
      const newId = appStore.addCompartment(afterId);
      // Panel will be added via store subscription
    });

    panel.el.addEventListener('compartment:remove', (e) => {
      const { id } = (e as CustomEvent).detail;
      appStore.removeCompartment(id);
      // Panel removal via store subscription
    });

    panel.el.addEventListener('compartment:duplicate', (e) => {
      const { newId } = (e as CustomEvent).detail;
      // Panel already added to store, just add UI
      this._addPanel(newId);
    });
  }

  private _bindToolbarEvents(): void {
    this.root.addEventListener('app:project-loaded', () => {
      // Remove all existing panels
      for (const id of [...this.panels.keys()]) {
        this._removePanel(id);
      }
      // Rebuild panels and synth pools
      for (const state of appStore.getAll()) {
        this._addPanel(state.config.id);
      }
    });

    this.root.addEventListener('app:compartment-added', (e) => {
      const { id } = (e as CustomEvent).detail;
      this._addPanel(id);
    });
  }

  // ---- Store subscription ----

  private _subscribeStore(): void {
    this._storeUnsub = appStore.subscribe(async (event) => {
      if (event.type === 'COMPARTMENT_ADDED') {
        this._addPanel(event.compartmentId);
      } else if (event.type === 'COMPARTMENT_REMOVED') {
        this._removePanel(event.compartmentId);
        appStore.relabelAll();
      } else if (event.type === 'PLAYBACK_STARTED') {
        // Connect visualizer after AudioContext is running
        this._tryConnectVisualizer();
      }
    });
  }

  private _visualizerConnected = false;

  private _tryConnectVisualizer(): void {
    if (this._visualizerConnected) return;
    try {
      const ctx = Tone.getContext().rawContext as AudioContext;
      // Connect analyser to the raw Web Audio destination node
      const dest = (Tone.getDestination() as unknown as { input: AudioNode }).input;
      this.visualizer.connect(ctx, dest ?? ctx.destination);
      this._visualizerConnected = true;
    } catch { /* AudioContext not ready yet */ }
  }
}

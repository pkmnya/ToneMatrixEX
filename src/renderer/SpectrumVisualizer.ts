/**
 * SpectrumVisualizer — real-time FFT spectrum display.
 * Uses Web Audio API AnalyserNode connected to Tone.Destination.
 */

const BAR_COUNT = 64;

export class SpectrumVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private _raf: number | null = null;
  private _running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Call after Tone.start() — connects to Tone.Destination's audio context */
  connect(audioContext: AudioContext, destination: AudioNode): void {
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    destination.connect(this.analyser);
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._loop();
  }

  stop(): void {
    this._running = false;
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this._clear();
  }

  destroy(): void {
    this.stop();
    this.analyser?.disconnect();
  }

  private _loop(): void {
    if (!this._running) return;
    this._draw();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  private _draw(): void {
    const { canvas, ctx, analyser, dataArray } = this;
    if (!analyser) { this._clear(); return; }

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width  = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.scale(dpr, dpr);
    }

    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, cssW, cssH);

    const barWidth = cssW / BAR_COUNT;
    const step = Math.floor(dataArray.length / BAR_COUNT);

    for (let i = 0; i < BAR_COUNT; i++) {
      const value  = dataArray[i * step] / 255;
      const barH   = value * cssH;
      const x      = i * barWidth;
      const t      = i / BAR_COUNT;

      // Interpolate color between start and end
      const r1 = 0, g1 = 229, b1 = 255;   // #00e5ff
      const r2 = 124, g2 = 58, b2 = 237;  // #7c3aed
      const r  = Math.round(r1 + (r2 - r1) * t);
      const g  = Math.round(g1 + (g2 - g1) * t);
      const b  = Math.round(b1 + (b2 - b1) * t);

      ctx.fillStyle = `rgba(${r},${g},${b},${0.4 + value * 0.6})`;
      ctx.fillRect(x + 1, cssH - barH, barWidth - 2, barH);

      // Peak cap
      if (barH > 2) {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x + 1, cssH - barH - 2, barWidth - 2, 2);
      }
    }
  }

  private _clear(): void {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

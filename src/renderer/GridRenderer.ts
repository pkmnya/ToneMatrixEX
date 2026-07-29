/**
 * GridRenderer — Canvas-based grid renderer + mouse interaction.
 *
 * Responsibilities:
 * - Draw the grid (cells, active highlights, playback cursor sweep line)
 * - Handle mouse events (paint/erase on drag, test note on click)
 * - Emit events: onCellToggled, onTestNote
 */

import type { CompartmentState } from '../core/types';
import { rowToNoteLabel } from '../core/ScaleBuilder';

// ---- Visual constants ----
const CELL_SIZE     = 20;    // px per cell (adaptive)
const GAP           = 2;     // px gap between cells
const LABEL_WIDTH   = 32;    // px for note labels on left
const HEADER_HEIGHT = 20;    // px top header for column numbers
const MIN_CELL_SIZE = 4;
const MAX_CELL_SIZE = 28;

// Color palette
const COLOR = {
  bg:           '#0d0d1a',
  gridLine:     'rgba(255,255,255,0.04)',
  cellOff:      'rgba(255,255,255,0.06)',
  cellOn:       '#00e5ff',
  cellOnGlow:   'rgba(0,229,255,0.35)',
  cursor:       'rgba(0,229,255,0.15)',
  cursorLine:   'rgba(0,229,255,0.7)',
  labelText:    'rgba(255,255,255,0.4)',
  labelActive:  'rgba(0,229,255,0.9)',
  headerText:   'rgba(255,255,255,0.25)',
  activeCompartment: 'rgba(0,229,255,0.08)',
  borderRadius: 3,
} as const;

type PaintMode = 'paint' | 'erase' | null;

export interface GridRendererEvents {
  onCellToggled: (col: number, row: number, value: boolean) => void;
  onTestNote:    (row: number) => void;
}

export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: CompartmentState | null = null;
  private events: GridRendererEvents;

  private paintMode: PaintMode = null;
  private lastPaintedCell: [number, number] | null = null;
  private _cellSize = CELL_SIZE;
  private _raf: number | null = null;
  private _dirty = true;

  constructor(canvas: HTMLCanvasElement, events: GridRendererEvents) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.events = events;

    this._bindMouse();
    this._startLoop();
  }

  // ---- Public API ----

  setState(state: CompartmentState): void {
    this.state = state;
    this._recalcCellSize();
    this._dirty = true;
  }

  markDirty(): void { this._dirty = true; }

  resize(): void {
    this._recalcCellSize();
    this._dirty = true;
  }

  destroy(): void {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._unbindMouse();
  }

  // ---- Rendering loop ----

  private _startLoop(): void {
    const loop = () => {
      if (this._dirty) {
        this._draw();
        this._dirty = false;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  private _recalcCellSize(): void {
    if (!this.state) return;
    const rows = this.state.grid[0]?.length ?? 16;

    // Fit cell size to available canvas area in CSS pixels
    const availW = (this.canvas.clientWidth || 300) - LABEL_WIDTH;
    const availH = (this.canvas.clientHeight || 300) - HEADER_HEIGHT;

    const cols = Math.max(1, this.state.config.width);
    const byW = Math.floor(availW / cols - GAP);
    const byH = Math.floor(availH / rows - GAP);

    this._cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, byW, byH));
  }

  private _draw(): void {
    const { canvas, ctx, state } = this;
    if (!state) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;

    // Resize canvas if needed
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width  = cssW * dpr;
      canvas.height = cssH * dpr;
      ctx.scale(dpr, dpr);
      this._recalcCellSize();
    }

    ctx.clearRect(0, 0, cssW, cssH);

    // Background
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const { grid, config, currentColumn } = state;
    const cols = config.width;
    const rows = grid[0]?.length ?? 16;
    const cs   = this._cellSize;

    const gridLeft = LABEL_WIDTH;
    const gridTop  = HEADER_HEIGHT;

    // ---- Column cursor highlight ----
    if (currentColumn >= 0 && currentColumn < cols) {
      const cx = gridLeft + currentColumn * (cs + GAP);
      ctx.fillStyle = COLOR.cursor;
      ctx.fillRect(cx, gridTop, cs, rows * (cs + GAP) - GAP);

      ctx.fillStyle = COLOR.cursorLine;
      ctx.fillRect(cx, gridTop, 2, rows * (cs + GAP) - GAP);
    }

    // ---- Cells ----
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = gridLeft + c * (cs + GAP);
        const y = gridTop  + r * (cs + GAP);
        const on = grid[c]?.[r] ?? false;

        if (on) {
          // Glow shadow
          ctx.shadowColor = COLOR.cellOnGlow;
          ctx.shadowBlur  = 10;
          ctx.fillStyle   = COLOR.cellOn;
        } else {
          ctx.shadowBlur = 0;
          ctx.fillStyle  = COLOR.cellOff;
        }

        this._roundRect(ctx, x, y, cs, cs, COLOR.borderRadius);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;

    // ---- Note labels (left column) ----
    ctx.font      = `${Math.min(10, cs - 2)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    for (let r = 0; r < rows; r++) {
      const y  = gridTop + r * (cs + GAP);
      const cy = y + cs / 2;
      const label = rowToNoteLabel(config.noteRange, r);
      const isActive = currentColumn >= 0 && (grid[currentColumn]?.[r] ?? false);
      ctx.fillStyle = isActive ? COLOR.labelActive : COLOR.labelText;
      ctx.fillText(label, LABEL_WIDTH - 4, cy + 3.5);
    }

    // ---- Column index header ----
    ctx.textAlign = 'center';
    ctx.font = `9px Inter, system-ui, sans-serif`;
    for (let c = 0; c < cols; c++) {
      if ((c + 1) % 4 === 0 || c === 0) {
        const x  = gridLeft + c * (cs + GAP) + cs / 2;
        ctx.fillStyle = (c === currentColumn) ? COLOR.labelActive : COLOR.headerText;
        ctx.fillText(String(c + 1), x, HEADER_HEIGHT - 4);
      }
    }
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ---- Mouse + Touch interaction ----

  private _boundPointerDown!: (e: PointerEvent) => void;
  private _boundPointerMove!: (e: PointerEvent) => void;
  private _boundPointerUp!:   (e: PointerEvent) => void;
  private _boundPointerLeave!:(e: PointerEvent) => void;

  private _bindMouse(): void {
    this._boundPointerDown  = this._onPointerDown.bind(this);
    this._boundPointerMove  = this._onPointerMove.bind(this);
    this._boundPointerUp    = this._onPointerUp.bind(this);
    this._boundPointerLeave = this._onPointerUp.bind(this);

    this.canvas.addEventListener('pointerdown',  this._boundPointerDown);
    this.canvas.addEventListener('pointermove',  this._boundPointerMove);
    this.canvas.addEventListener('pointerup',    this._boundPointerUp);
    this.canvas.addEventListener('pointerleave', this._boundPointerLeave);
    this.canvas.addEventListener('pointercancel',this._boundPointerUp);
    // Prevent browser scroll/zoom interfering with grid drawing on touch
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'crosshair';
  }

  private _unbindMouse(): void {
    this.canvas.removeEventListener('pointerdown',  this._boundPointerDown);
    this.canvas.removeEventListener('pointermove',  this._boundPointerMove);
    this.canvas.removeEventListener('pointerup',    this._boundPointerUp);
    this.canvas.removeEventListener('pointerleave', this._boundPointerLeave);
    this.canvas.removeEventListener('pointercancel',this._boundPointerUp);
  }

  private _hitTest(e: PointerEvent): [number, number] | null {
    if (!this.state) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cs = this._cellSize;
    const cols = this.state.config.width;
    const rows = this.state.grid[0]?.length ?? 16;

    const col = Math.floor((mx - LABEL_WIDTH) / (cs + GAP));
    const row = Math.floor((my - HEADER_HEIGHT) / (cs + GAP));

    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    return [col, row];
  }

  private _onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const cell = this._hitTest(e);
    if (!cell || !this.state) return;
    const [col, row] = cell;
    const cur = this.state.grid[col]?.[row] ?? false;
    this.paintMode = cur ? 'erase' : 'paint';
    this.lastPaintedCell = cell;
    this.events.onCellToggled(col, row, !cur);
    if (!cur) this.events.onTestNote(row);
    this._dirty = true;
  }

  private _onPointerMove(e: PointerEvent): void {
    if (!this.paintMode) return;
    e.preventDefault();
    const cell = this._hitTest(e);
    if (!cell || !this.state) return;
    const [col, row] = cell;
    if (this.lastPaintedCell?.[0] === col && this.lastPaintedCell?.[1] === row) return;
    this.lastPaintedCell = cell;
    const targetValue = this.paintMode === 'paint';
    const cur = this.state.grid[col]?.[row] ?? false;
    if (cur !== targetValue) {
      this.events.onCellToggled(col, row, targetValue);
      if (targetValue) this.events.onTestNote(row);
      this._dirty = true;
    }
  }

  private _onPointerUp(e: PointerEvent): void {
    this.canvas.releasePointerCapture(e.pointerId);
    this.paintMode = null;
    this.lastPaintedCell = null;
  }
}

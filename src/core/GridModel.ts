/**
 * GridModel — immutable-style grid state.
 * Analogous to the C# Grid.data (Tile[][]) but uses plain booleans for simplicity.
 */

export class GridModel {
  private readonly data: boolean[][];

  constructor(
    public readonly cols: number,
    public readonly rows: number,
    data?: boolean[][],
  ) {
    if (data) {
      this.data = data;
    } else {
      this.data = Array.from({ length: cols }, () => new Array<boolean>(rows).fill(false));
    }
  }

  get(col: number, row: number): boolean {
    return this.data[col]?.[row] ?? false;
  }

  set(col: number, row: number, value: boolean): GridModel {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return this;
    const next = this.data.map(c => [...c]);
    next[col][row] = value;
    return new GridModel(this.cols, this.rows, next);
  }

  toggle(col: number, row: number): [GridModel, boolean] {
    const newVal = !this.get(col, row);
    return [this.set(col, row, newVal), newVal];
  }

  clear(): GridModel {
    return new GridModel(this.cols, this.rows);
  }

  /** Resize the grid, preserving existing data */
  resize(newCols: number, newRows: number): GridModel {
    const next = Array.from({ length: newCols }, (_, c) =>
      Array.from({ length: newRows }, (__, r) => this.data[c]?.[r] ?? false)
    );
    return new GridModel(newCols, newRows, next);
  }

  /** Serialize to a plain 2D boolean array (col-major) */
  toArray(): boolean[][] {
    return this.data.map(col => [...col]);
  }

  /** Deserialize from a plain array, padding with false if needed */
  static fromArray(arr: boolean[][], cols: number, rows: number): GridModel {
    const data = Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (__, r) => arr[c]?.[r] ?? false)
    );
    return new GridModel(cols, rows, data);
  }

  /** Mutable helper — returns a mutable copy for batch updates */
  toMutable(): MutableGridModel {
    return new MutableGridModel(this.cols, this.rows, this.data.map(c => [...c]));
  }
}

/** Mutable version used by AppStore for in-place updates (performance optimization) */
export class MutableGridModel {
  constructor(
    public readonly cols: number,
    public readonly rows: number,
    public readonly data: boolean[][],
  ) {}

  get(col: number, row: number): boolean {
    return this.data[col]?.[row] ?? false;
  }

  set(col: number, row: number, value: boolean): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.data[col][row] = value;
    }
  }

  toggle(col: number, row: number): boolean {
    const newVal = !this.get(col, row);
    this.set(col, row, newVal);
    return newVal;
  }

  clear(): void {
    for (let c = 0; c < this.cols; c++)
      for (let r = 0; r < this.rows; r++)
        this.data[c][r] = false;
  }

  toImmutable(): GridModel {
    return GridModel.fromArray(this.data, this.cols, this.rows);
  }
}

/**
 * BitmapCodec — HEX-based point bitmap encoder/decoder.
 *
 * Direct port of C# GridGroup.ToBase64() / LoadGridDataFromHex().
 * Each 4 consecutive row booleans (in col-major order) → 1 hex char (0x0–0xF).
 * Highest bit = smaller row index.
 *
 * Encoding: for x in 0..width-1, for y in 0..rows-1 step 4,
 *   pack bits [y, y+1, y+2, y+3] into nibble → hex char.
 */

export class BitmapCodec {
  /**
   * Encode a grid to a hex string.
   * @param grid  grid[col][row] boolean array
   * @param cols  number of columns
   * @param rows  number of rows
   */
  static encode(grid: boolean[][], cols: number, rows: number): string {
    let hex = '';
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y += 4) {
        let nibble = 0;
        for (let i = 0; i < 4 && y + i < rows; i++) {
          if (grid[x]?.[y + i]) {
            nibble |= (1 << (3 - i));
          }
        }
        hex += nibble.toString(16).toUpperCase();
      }
    }
    return hex;
  }

  /**
   * Decode a hex string back to a grid.
   * Returns a boolean[][] of shape [cols][rows].
   */
  static decode(hex: string, cols: number, rows: number): boolean[][] {
    const grid: boolean[][] = Array.from({ length: cols }, () =>
      new Array<boolean>(rows).fill(false)
    );

    let hexIdx = 0;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y += 4) {
        if (hexIdx >= hex.length) break;
        const nibble = parseInt(hex[hexIdx++], 16);
        if (isNaN(nibble)) continue;
        for (let i = 0; i < 4 && y + i < rows; i++) {
          grid[x][y + i] = ((nibble >> (3 - i)) & 1) === 1;
        }
      }
    }
    return grid;
  }

  /** Expected hex string length for given dimensions */
  static encodedLength(cols: number, rows: number): number {
    return cols * Math.ceil(rows / 4);
  }
}

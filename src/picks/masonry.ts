/**
 * Gallery-wall layout: equal-width columns, every picture at its true aspect ratio, the same gap
 * between columns as between stacked pictures. Worked out from the sizes in pool.json alone, so
 * the wall is laid out before any image has loaded and nothing moves when they arrive.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Wall {
  /** One box per picture, in the order the pictures were given. Whole pixels. */
  boxes: Box[];
  height: number;
  columnWidth: number;
}

/** Columns by viewport width: 5 on desktop, 4 on small laptops, 3 on tablets, 2 on phones. */
export function columnsFor(viewportWidth: number): number {
  if (viewportWidth >= 1200) return 5;
  if (viewportWidth >= 900) return 4;
  if (viewportWidth >= 600) return 3;
  return 2;
}

/**
 * @param ratios height / width of each picture, in display order
 * @param width  width of the wall in px
 * @param gap    the one gap, in px, used both ways
 */
export function layoutWall(ratios: number[], width: number, columns: number, gap: number): Wall {
  const columnWidth = Math.max(1, Math.floor((width - gap * (columns - 1)) / columns));
  // Whole pixels everywhere, so every gap is exactly `gap`. The pixel or two left over is split between the sides.
  const left = Math.floor((width - (columnWidth * columns + gap * (columns - 1))) / 2);
  const heights = ratios.map((r) => Math.max(1, Math.round(columnWidth * r)));

  const cols: number[][] = Array.from({ length: columns }, () => []);
  const heightOf = (items: number[]) => items.reduce((sum, i) => sum + heights[i], 0) + gap * Math.max(0, items.length - 1);
  const spreadOf = (hs: number[]) => Math.max(...hs) - Math.min(...hs);

  // 1. Shortest column first: each picture, in order, goes where the wall is currently lowest.
  const running = new Array<number>(columns).fill(0);
  heights.forEach((_, i) => {
    let c = 0;
    for (let k = 1; k < columns; k++) if (running[k] < running[c]) c = k;
    cols[c].push(i);
    running[c] = heightOf(cols[c]);
  });

  // 2. If the bottom edge is too ragged, move one picture or swap two between columns, taking the
  //    change that evens the columns most, until it is within tolerance or nothing helps.
  const tolerance = 0.4 * columnWidth;
  for (let pass = 0; pass < 60; pass++) {
    const hs = cols.map(heightOf);
    const spread = spreadOf(hs);
    if (spread <= tolerance) break;
    let best: { a: number; b: number; ia: number; ib: number; spread: number } | null = null;
    const consider = (a: number, b: number, ia: number, ib: number, ha: number, hb: number) => {
      const next = hs.slice();
      next[a] = ha;
      next[b] = hb;
      const s = spreadOf(next);
      if (s < (best?.spread ?? spread) - 0.5) best = { a, b, ia, ib, spread: s };
    };
    for (let a = 0; a < columns; a++) {
      for (let b = 0; b < columns; b++) {
        if (a === b) continue;
        for (let ia = 0; ia < cols[a].length; ia++) {
          // Move one picture from a to b (ib = -1) …
          const without = cols[a].filter((_, k) => k !== ia);
          if (without.length) consider(a, b, ia, -1, heightOf(without), heightOf([...cols[b], cols[a][ia]]));
          // … or swap it with one of b's (each pair once).
          if (a < b) {
            for (let ib = 0; ib < cols[b].length; ib++) {
              const na = cols[a].map((v, k) => (k === ia ? cols[b][ib] : v));
              const nb = cols[b].map((v, k) => (k === ib ? cols[a][ia] : v));
              consider(a, b, ia, ib, heightOf(na), heightOf(nb));
            }
          }
        }
      }
    }
    if (!best) break;
    const { a, b, ia, ib } = best as { a: number; b: number; ia: number; ib: number };
    const moved = cols[a][ia];
    if (ib < 0) {
      cols[a].splice(ia, 1);
      cols[b].push(moved);
    } else {
      cols[a][ia] = cols[b][ib];
      cols[b][ib] = moved;
    }
  }

  // 3. Within a column, earlier pictures stay above later ones.
  const boxes = new Array<Box>(ratios.length);
  let height = 0;
  cols.forEach((items, c) => {
    let y = 0;
    for (const i of [...items].sort((p, q) => p - q)) {
      boxes[i] = { x: left + c * (columnWidth + gap), y, w: columnWidth, h: heights[i] };
      y += heights[i] + gap;
    }
    height = Math.max(height, y - gap);
  });
  return { boxes, height: Math.max(0, height), columnWidth };
}

// Game rules for the three arena modes. Boards are flat strings/arrays of
// 'X' | 'O' | '.' in row-major order. X always moves first.

export const MODES = Object.freeze({
  3: { N: 3, K: 3, label: '3×3 · 3 in a row' },
  5: { N: 5, K: 4, label: '5×5 · 4 in a row' },
  10: { N: 10, K: 5, label: '10×10 · 5 in a row' },
});
export const SIZES = [3, 5, 10];

export const other = (p) => (p === 'X' ? 'O' : 'X');
export const emptyBoard = (N) => '.'.repeat(N * N);

const winCache = new Map();
/** All K-windows (arrays of cell indices) on an N×N board. */
export function windows(N, K = MODES[N].K) {
  const key = `${N}/${K}`;
  if (winCache.has(key)) return winCache.get(key);
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const er = r + dr * (K - 1), ec = c + dc * (K - 1);
      if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
      out.push(Array.from({ length: K }, (_, i) => (r + dr * i) * N + c + dc * i));
    }
  }
  winCache.set(key, out);
  return out;
}

export function count(cells, p) { let n = 0; for (const v of cells) if (v === p) n++; return n; }

/** Side to move, or null if stone counts are impossible under X-first turn order. */
export function sideToMove(cells) {
  const x = count(cells, 'X'), o = count(cells, 'O');
  if (x === o) return 'X';
  if (x === o + 1) return 'O';
  return null;
}

/** Winning K-line on the board (array of indices), or null. */
export function winningLine(cells, N) {
  for (const w of windows(N)) {
    const v = cells[w[0]];
    if (v !== '.' && w.every((i) => cells[i] === v)) return w;
  }
  return null;
}
export const winner = (cells, N) => { const w = winningLine(cells, N); return w ? cells[w[0]] : null; };

/** Cells where `p` completes K in a row immediately. */
export function winCells(cells, N, p) {
  const K = MODES[N].K, set = new Set();
  for (const w of windows(N)) {
    let n = 0, e = -1, bad = false;
    for (const i of w) { const v = cells[i]; if (v === p) n++; else if (v === '.') e = i; else { bad = true; break; } }
    if (!bad && n === K - 1) set.add(e);
  }
  return [...set];
}

export const emptyCells = (cells) => { const out = []; for (let i = 0; i < cells.length; i++) if (cells[i] === '.') out.push(i); return out; };
export const place = (cells, i, p) => { const a = [...cells]; a[i] = p; return a; };
export const rowsOf = (cells, N) => Array.from({ length: N }, (_, r) => [...cells].slice(r * N, r * N + N).join(''));

/** Validate a position given to an agent: legal turn order, no winner, not full. */
export function validatePosition(cells, N) {
  if (cells.length !== N * N || [...cells].some((v) => v !== 'X' && v !== 'O' && v !== '.')) return 'malformed board';
  if (!sideToMove(cells)) return 'impossible stone counts';
  if (winner(cells, N)) return 'game already won';
  if (!cells.includes('.')) return 'board full';
  return null;
}

/** The exact stdin given to a Brainfuck agent. */
export function toInput(cells, N, p = sideToMove(cells)) {
  return `${N}\n${p}\n${rowsOf(cells, N).join('\n')}\n`;
}

/** Parse agent stdout "row col". Returns {index,r,c} or {error}. */
export function parseMove(output, cells, N) {
  const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(output);
  if (!m) return { error: `unparseable output ${JSON.stringify(output.slice(0, 40))}` };
  const r = +m[1], c = +m[2];
  if (r >= N || c >= N) return { error: `move ${r} ${c} is off the board`, r, c };
  const index = r * N + c;
  if (cells[index] !== '.') return { error: `square ${r} ${c} is occupied`, r, c, index };
  return { index, r, c };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Exact reference answers for benchmark positions, computed by brute force
// over the game tree (never by the engine's own heuristics).

import { MODES, other, winCells, emptyCells, place, winner, windows } from './game.js';

/**
 * Cells lying in >= 2 windows that hold K-2 of p's stones and nothing else.
 * Every move that creates two new immediate wins is in this set (it is only a
 * pre-filter; results are always confirmed by brute force).
 */
function forkCandidates(cells, N, p) {
  const K = MODES[N].K, hits = new Map();
  for (const w of windows(N)) {
    let n = 0, bad = false;
    for (const i of w) { if (cells[i] === p) n++; else if (cells[i] !== '.') { bad = true; break; } }
    if (!bad && n === K - 2) for (const i of w) if (cells[i] === '.') hits.set(i, (hits.get(i) || 0) + 1);
  }
  return [...hits].filter(([, h]) => h >= 2).map(([i]) => i);
}

/** Moves after which `p` has >= 2 distinct immediate wins (a double threat). */
export function forkMoves(cells, N, p) {
  return forkCandidates(cells, N, p).filter((m) => winCells(place(cells, m, p), N, p).length >= 2);
}

/** Can `p` (to move) force a win within 3 plies? */
export function winIn3(cells, N, p) {
  if (winCells(cells, N, p).length) return true;
  const q = other(p), theirs = winCells(cells, N, q);
  if (theirs.length > 1) return false;
  const cand = theirs.length ? theirs : forkCandidates(cells, N, p);
  return cand.some((m) => {
    const a = place(cells, m, p);
    return winCells(a, N, q).length === 0 && winCells(a, N, p).length >= 2;
  });
}

/** Does move m by `p` force a win within 5 plies (assuming no faster win exists)? */
export function winsIn5(cells, N, p, m) {
  const q = other(p), a = place(cells, m, p);
  if (winner(a, N)) return true;
  if (winCells(a, N, q).length) return false;
  const mine = winCells(a, N, p);
  if (mine.length >= 2) return true;
  if (mine.length === 1) return winIn3(place(a, mine[0], q), N, p);
  // quiet move: every reply must still lose; try the most relevant replies first
  const replies = emptyCells(a);
  const hot = new Set(forkCandidates(a, N, p));
  replies.sort((x, y) => hot.has(y) - hot.has(x));
  return replies.every((r) => winIn3(place(a, r, q), N, p));
}

/** True if `p` has a forced win in 5 plies starting with a forcing move (a threat). */
function hasThreatWin5(cells, N, p) {
  const q = other(p);
  return emptyCells(cells).some((m) => {
    const a = place(cells, m, p), mine = winCells(a, N, p);
    return mine.length === 1 && !winCells(a, N, q).length && winIn3(place(a, mine[0], q), N, p);
  });
}

/**
 * Moves m for `p` such that the opponent has no reply x that leaves `p`
 * without an immediate win while giving the opponent >= 2 immediate wins.
 * (Assumes neither side currently has an immediate win.)
 */
export function safeMoves(cells, N, p) {
  const q = other(p);
  return emptyCells(cells).filter((m) => {
    const a = place(cells, m, p);
    const mine = winCells(a, N, p);
    if (mine.length >= 2) return true;
    if (mine.length === 1) return winCells(place(a, mine[0], q), N, q).length < 2;
    return forkMoves(a, N, q).length === 0;
  });
}

const memo3 = new Map();
/** Game value for the side to move on 3×3 under perfect play: 1 win, 0 draw, -1 loss. */
export function value3(cells, p) {
  const key = cells.join('') + p;
  if (memo3.has(key)) return memo3.get(key);
  let best = -2;
  const empties = emptyCells(cells);
  if (!empties.length) best = 0;
  for (const m of empties) {
    const a = place(cells, m, p);
    const v = winner(a, 3) ? 1 : 0 - value3(a, other(p)) || 0;
    if (v > best) best = v;
    if (best === 1) break;
  }
  memo3.set(key, best);
  return best;
}

/** Moves that preserve the game-theoretic value on 3×3. */
export function optimalMoves3(cells, p) {
  const vals = emptyCells(cells).map((m) => {
    const a = place(cells, m, p);
    return [m, winner(a, 3) ? 1 : 0 - value3(a, other(p)) || 0];
  });
  const best = Math.max(...vals.map((v) => v[1]));
  return { moves: vals.filter((v) => v[1] === best).map((v) => v[0]), value: best, all: vals };
}

/**
 * Classify a position for the side to move. Returns {category, correct} or
 * null when the position has no clear tactical theme (or is already lost).
 */
export function classify(cells, N, p) {
  const q = other(p);
  const mine = winCells(cells, N, p);
  if (mine.length) return { category: 'win', correct: mine };
  const theirs = winCells(cells, N, q);
  if (theirs.length === 1) return { category: 'block', correct: theirs };
  if (theirs.length > 1) return null; // already lost
  const forks = forkMoves(cells, N, p);
  if (forks.length) return { category: 'fork', correct: forks };
  if (hasThreatWin5(cells, N, p)) {
    return { category: 'vcf', correct: emptyCells(cells).filter((m) => winsIn5(cells, N, p, m)) };
  }
  if (forkMoves(cells, N, q).length) {
    const safe = safeMoves(cells, N, p);
    const n = emptyCells(cells).length;
    if (safe.length && safe.length < n) return { category: 'defense', correct: safe };
  }
  return null;
}

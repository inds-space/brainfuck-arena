// Sparring partners for match play. These are the *opponents* the Brainfuck
// agent plays against; they never choose moves for the agent under test.

import { emptyCells, winCells, other, windows, MODES } from './game.js';
import { optimalMoves3, forkMoves } from './oracle.js';

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

function near(cells, N) {
  const out = emptyCells(cells).filter((i) => {
    const r = Math.floor(i / N), c = i % N;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const y = r + dr, x = c + dc;
      if ((dr || dc) && y >= 0 && y < N && x >= 0 && x < N && cells[y * N + x] !== '.') return true;
    }
    return false;
  });
  return out.length ? out : emptyCells(cells);
}

/** Gomoku-style line potential: own and enemy stones in open windows through each cell. */
function bestByPotential(cells, N, p, rand) {
  const K = MODES[N].K, q = other(p), score = new Map();
  for (const w of windows(N)) {
    let a = 0, b = 0;
    for (const i of w) { if (cells[i] === p) a++; else if (cells[i] === q) b++; }
    const v = (b ? 0 : 4 ** a) + (a ? 0 : 0.9 * 4 ** b);
    for (const i of w) if (cells[i] === '.') score.set(i, (score.get(i) || 0) + v);
  }
  let best = -1, out = [];
  for (const i of emptyCells(cells)) {
    const v = (score.get(i) || 0) * (1 + 0.05 * rand());
    if (v > best) { best = v; out = [i]; }
  }
  return out[0];
}

export const OPPONENTS = {
  random: {
    label: 'Random',
    description: 'Uniformly random legal move (seeded).',
    move: (cells, N, p, rand) => pick(emptyCells(cells), rand),
  },
  greedy: {
    label: 'Greedy',
    description: 'Wins if it can, blocks an immediate loss, otherwise plays next to existing stones.',
    move: (cells, N, p, rand) => {
      const w = winCells(cells, N, p);
      if (w.length) return pick(w, rand);
      const b = winCells(cells, N, other(p));
      if (b.length) return pick(b, rand);
      return pick(near(cells, N), rand);
    },
  },
  tactician: {
    label: 'Tactician',
    description: 'Wins, blocks, makes double threats, kills single enemy fork squares, otherwise maximises line potential.',
    move: (cells, N, p, rand) => {
      const q = other(p);
      const w = winCells(cells, N, p);
      if (w.length) return pick(w, rand);
      const b = winCells(cells, N, q);
      if (b.length) return pick(b, rand);
      const f = forkMoves(cells, N, p);
      if (f.length) return pick(f, rand);
      const ef = forkMoves(cells, N, q);
      if (ef.length === 1) return ef[0];
      return bestByPotential(cells, N, p, rand);
    },
  },
  perfect: {
    label: 'Perfect (3×3)',
    description: 'Exhaustive minimax; never loses on 3×3.',
    sizes: [3],
    move: (cells, N, p, rand) => pick(optimalMoves3(cells, p).moves, rand),
  },
};

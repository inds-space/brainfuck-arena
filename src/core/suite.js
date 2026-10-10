// Deterministic benchmark suite: positions + match schedule from a seed.

import { SIZES, rng, emptyBoard, emptyCells, place, other, winCells, windows, sideToMove, validatePosition } from './game.js';
import { classify, optimalMoves3 } from './oracle.js';

export const SUITE_VERSION = 1;
export const DEFAULT_SEED = 20261009;

export const CATEGORIES = {
  win: { label: 'Win in 1', description: 'Complete your own line when a winning square exists.' },
  block: { label: 'Block', description: 'Stop the opponent’s only immediate win.' },
  fork: { label: 'Fork', description: 'Create a double threat (forced win in 3 plies).' },
  vcf: { label: 'Forced win in 5', description: 'Win through a forcing sequence: threat, forced reply, double threat.' },
  defense: { label: 'Fork defense', description: 'Leave the opponent no unstoppable double threat next turn.' },
  minimax: { label: 'Perfect play', description: '3×3 only: choose a move that keeps the game-theoretic value.' },
  legal: { label: 'Legality', description: 'Dense late-game boards: any empty square is accepted.' },
  match: { label: 'Match play', description: 'Full games vs. sparring opponents, both colours.' },
};

const QUOTA = { win: 10, block: 10, fork: 10, vcf: 10, defense: 10, legal: 6, minimax: 20 };
const MATCHES = {
  3: [['random', 2], ['greedy', 2], ['tactician', 2], ['perfect', 2]],
  5: [['random', 2], ['greedy', 2], ['tactician', 4]],
  10: [['random', 2], ['greedy', 2], ['tactician', 4]],
};

const cellWindows = new Map();
function windowsThrough(N) {
  if (!cellWindows.has(N)) {
    const map = Array.from({ length: N * N }, () => []);
    for (const w of windows(N)) for (const i of w) map[i].push(w);
    cellWindows.set(N, map);
  }
  return cellWindows.get(N);
}

/**
 * Self-play generator: noisy line-building policy that never completes a
 * line, so every prefix is a legal, unfinished position with X moving first.
 */
function playout(N, rand, plies) {
  const thr = windowsThrough(N), noise = 0.5 + rand() * 4;
  let cells = [...emptyBoard(N)], p = 'X';
  for (let ply = 0; ply < plies; ply++) {
    const wins = new Set(winCells(cells, N, p));
    let cand = emptyCells(cells).filter((i) => !wins.has(i));
    if (!cand.length) break;
    const anyStone = cells.some((v) => v !== '.');
    const scored = cand.map((i) => {
      let s = rand() * noise;
      if (anyStone) for (const w of thr[i]) {
        let a = 0, b = 0;
        for (const j of w) { if (cells[j] === p) a++; else if (cells[j] === other(p)) b++; }
        if (!b) s += a * a; if (!a) s += 0.8 * b * b;
      }
      return [i, s];
    });
    scored.sort((x, y) => y[1] - x[1]);
    const i = rand() < 0.15 ? cand[Math.floor(rand() * cand.length)] : scored[Math.floor(rand() * Math.min(3, scored.length))][0];
    cells = place(cells, i, p);
    p = other(p);
  }
  return cells;
}

function* allPositions3() {
  const seen = new Set();
  const stack = [[...emptyBoard(3)]];
  while (stack.length) {
    const cells = stack.pop(), key = cells.join('');
    if (seen.has(key)) continue;
    seen.add(key);
    if (validatePosition(cells, 3)) continue;
    yield cells;
    const p = sideToMove(cells);
    for (const m of emptyCells(cells)) stack.push(place(cells, m, p));
  }
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

/** Build the full deterministic suite for a seed. */
export function buildSuite(seed = DEFAULT_SEED) {
  const tests = [];
  const add = (N, category, cells, correct) => {
    const p = sideToMove(cells);
    tests.push({ id: `${N}-${category}-${tests.filter((t) => t.size === N && t.category === category).length + 1}`, size: N, category, board: cells.join(''), toMove: p, correct: [...correct].sort((a, b) => a - b) });
  };

  for (const N of SIZES) {
    const rand = rng(seed ^ (N * 7919));
    const want = { win: QUOTA.win, block: QUOTA.block, fork: QUOTA.fork, vcf: QUOTA.vcf, defense: QUOTA.defense };
    const seen = new Set();
    if (N === 3) {
      const pool = shuffle([...allPositions3()], rand);
      for (const cells of pool) {
        const c = classify(cells, 3, sideToMove(cells));
        if (c && want[c.category] > 0) { want[c.category]--; add(3, c.category, cells, c.correct); seen.add(cells.join('')); }
      }
      let mm = QUOTA.minimax;
      for (const cells of pool) {
        if (!mm || seen.has(cells.join(''))) continue;
        const p = sideToMove(cells);
        const opt = optimalMoves3(cells, p);
        // only strategic positions: no immediate tactic, and some moves throw the game-theoretic value away
        if (!classify(cells, 3, p) && !winCells(cells, 3, other(p)).length && opt.moves.length < emptyCells(cells).length) {
          mm--; add(3, 'minimax', cells, opt.moves); seen.add(cells.join(''));
        }
      }
    } else {
      const maxPlies = N === 5 ? 16 : 40;
      for (let attempt = 0; attempt < 20000 && Object.values(want).some((v) => v > 0); attempt++) {
        const cells = playout(N, rand, 3 + Math.floor(rand() * (maxPlies - 3)));
        const key = cells.join('');
        if (seen.has(key) || validatePosition(cells, N)) continue;
        const c = classify(cells, N, sideToMove(cells));
        if (c && want[c.category] > 0) { want[c.category]--; seen.add(key); add(N, c.category, cells, c.correct); }
      }
    }
    // Legality: dense boards late in the game.
    for (let k = 0, made = 0; made < QUOTA.legal && k < 500; k++) {
      const cells = playout(N, rand, Math.floor(N * N * (0.6 + rand() * 0.35)));
      if (validatePosition(cells, N) || seen.has(cells.join(''))) continue;
      seen.add(cells.join('')); made++;
      add(N, 'legal', cells, emptyCells(cells));
    }
  }

  const matches = [];
  for (const N of SIZES) for (const [opponent, games] of MATCHES[N]) {
    for (let g = 0; g < games; g++) matches.push({ id: `${N}-${opponent}-${g + 1}`, size: N, opponent, agentPlays: g % 2 ? 'O' : 'X', seed: (seed + N * 1000 + g * 17 + opponent.length) >>> 0 });
  }
  return { version: SUITE_VERSION, seed, tests, matches };
}


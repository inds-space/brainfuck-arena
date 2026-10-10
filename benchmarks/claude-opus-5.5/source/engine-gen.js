// Generates ../engine.bf — Claude Opus 5.5's Tic-Tac-Toe AI, written in Brainfuck.
//
// This file is a *compiler*: it only emits Brainfuck text. All move selection
// happens when the emitted program runs inside the interpreter.
//
// Algorithm executed by the generated program (per board size, K = win length):
//   1. Parse "N\nP\nrows" into a padded board of B-cell blocks (K-1 wall
//      columns per row, padding rows above/below) so every K-window in the
//      4 directions is reachable with a constant forward stride.
//   2. Pass 1, for every window (anchor x direction): count own / enemy / wall
//      cells, then distribute to the window's empty cells:
//        K-1 own stones             -> WME   (immediate win cells)
//        K-1 enemy stones           -> WOPP  (cells we must block)
//        K-2 stones (de-duplicated) -> TME / TOPP (how many distinct win
//                                      cells a stone here would create)
//        fewer stones               -> SCORE (positional weight)
//   3. Pass 2 (2-ply fork lookahead) on every threat window:
//        DEF  = how many enemy fork squares (TOPP>=2) a move here defuses
//        FBAD = our forcing move here makes the forced reply an enemy fork
//   4. Tier each empty square:
//        7 win | 6 block | 5 double threat | 4 safe | 2 other
//   5. Search (4-ply, simulated moves): for every safe forcing move (TME=1),
//      actually play it, find and play the opponent's forced reply, update the
//      threat tables incrementally, and test whether we then own a winning
//      double threat. Successful moves are promoted to tier 5. Undo both moves.
//   6. Pick the best (tier, score), first in row-major order on ties, and
//      print "row col\n".

import { Gen } from './bfgen.js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIZES = { 3: 3, 5: 4, 10: 5 };
export const SEARCH_CAP = 24; // max forcing moves simulated per decision

// Positional weights per window class (index = stones in the window).
export const WEIGHTS = {
  3: { me: [1], tme: 4, opp: [0], topp: 3 },
  4: { me: [1, 3], tme: 9, opp: [0, 3], topp: 9 },
  5: { me: [1, 3, 6], tme: 12, opp: [0, 3, 7], topp: 12 },
};

// Static centrality bonus added to every square's score (tie-breaks toward the middle).
export const CENTER = { 3: 0, 5: 1, 10: 1 };
export const centrality = (N, r, c) => {
  const m = (N - 1) / 2, d = Math.max(Math.abs(r - m), Math.abs(c - m));
  return Math.max(0, Math.floor((m + 1 - d) * CENTER[N]));
};

// Block layout (one block per board square / wall / padding square).
// Fields after `//` are reused once their first meaning is no longer needed.
export const F = {
  RAIL: 0, NM: 1, REAL: 2, EMP: 3, ME: 4, OPP: 5, ROW: 6, COL: 7,
  WME: 8, WOPP: 9, TME: 10, TOPP: 11, SCORE: 12, DEF: 13, FBAD: 14,
  F2: 15, TIER: 15, // F2 until the tier sweep
  FGE2: 16, NL: 17,
  WK: 17, WK2: 14, // loop counters: NL after parsing, FBAD after the tier sweep
  WC: 18, NCAND: 18, NWF: 19, NAV: 20, // window codes until the tier sweep
  CA: 22, CB: 23, CC: 24, P: 25, T: 30,
};
export const B = 38;
const G = 16; // cells below G are global scratch
const GL = { CNT: 8, PHASE: 9, S: 10, FL: 11 };

export function layout(N) {
  const K = SIZES[N];
  const W = N + K - 1, R = N + K, nb = R * W;
  const pad = K * (W + 1); // zero blocks before the sentinel: simulated windows reach back this far
  const base = (i) => G + (i + 1 + pad) * B; // block -1 = sentinel, nb = terminator
  return { N, K, W, R, nb, base, dirs: [1, W, W + 1, W - 1] };
}

function program(g, N, opts) {
  const { K, W, nb, base, dirs } = layout(N);
  const wt = WEIGHTS[K];
  const term = base(nb), b0 = base(0);
  const P = (j) => F.P + j, T = (j) => F.T + j;
  const sweep = (body) => g.sweep(b0, B, F.RAIL, term, body);
  const setConst = (a, v) => { g.clr(a); g.add(a, v); };

  // Strided loop: body(x) for x = c, c+step, ..., c+(n-1)*step, carrying the
  // `packet` fields along; the packet ends at c + n*step. Code is emitted once.
  function walk(c, n, step, packet, body, ctr = F.WK) {
    g.add(c + ctr, n);
    g.go(c + ctr); g.raw('[');
    body(c);
    g.add(c + ctr, -1);
    for (const j of [...packet, ctr]) g.mov(c + j, [[c + step + j, 1]]);
    g.go(c + step + ctr); g.p = c + ctr; g.raw(']');
    g.p = c + n * step + ctr;
  }

  // ---- static init ----
  for (let i = -1; i < nb; i++) {
    const b = base(i), br = Math.floor(i / W) - 1, bc = ((i % W) + W) % W;
    g.add(b + F.RAIL, 1);
    if (i >= 0) g.add(b + F.NM, 1);
    if (i >= 0 && br >= 0 && br < N && bc < N) {
      g.add(b + F.REAL, 1); g.add(b + F.ROW, br); g.add(b + F.COL, bc); g.add(b + F.SCORE, centrality(N, br, bc));
    }
    if (i >= 0 && br >= 0 && br < N && bc === N) g.add(b + F.NL, 1);
  }
  g.add(term + F.NM, 1);

  // ---- rest of header: ["0"] "\n" P "\n" ----
  if (N === 10) { g.inp(0); g.clr(0); }
  g.inp(0); g.clr(0);
  g.inp(0); g.eqConst(0, 79, b0 + F.CA); // CA = we play 'O'
  g.inp(0); g.clr(0);

  // ---- parse rows ----
  sweep((c) => {
    g.ifD(c + F.NL, () => { g.inp(c + T(0)); g.clr(c + T(0)); });
    g.copy(c + F.REAL, c + T(0), c + T(1));
    g.ifD(c + T(0), () => {
      g.inp(c + T(1)); g.copy(c + T(1), c + T(2), c + T(3));
      g.eqConst(c + T(1), 88, c + F.ME);
      g.eqConst(c + T(2), 79, c + F.OPP);
      g.copy(c + F.CA, c + T(1), c + T(2));
      g.ifD(c + T(1), () => { // we are O: swap
        g.mov(c + F.ME, [[c + T(2), 1]]); g.mov(c + F.OPP, [[c + F.ME, 1]]); g.mov(c + T(2), [[c + F.OPP, 1]]);
      });
      g.add(c + F.EMP, 1);
      g.copy(c + F.ME, c + F.EMP, c + T(1), -1);
      g.copy(c + F.OPP, c + F.EMP, c + T(1), -1);
    });
    g.mov(c + F.CA, [[c + B + F.CA, 1]]);
  });
  g.clr(term + F.CA);

  // ---- pass 1: window scan ----
  sweep((c) => {
    g.copy(c + F.REAL, c + T(0), c + T(1));
    g.ifD(c + T(0), () => dirs.forEach((d, di) => window1(c, d * B, di, 0)));
  });

  /**
   * Evaluate the window anchored at block c (stride `step`) and apply its
   * contribution to the empty cells. sign 0 = full pass-1 contribution
   * (score + window code); +1 / -1 = add / remove only the threat tables
   * (used while simulating moves; +1 also flags new own win cells in NWF).
   */
  function window1(c, step, di, sign) {
    const cell = (i) => c + i * step;
    const pc = c - step, L = cell(K - 1);
    // packet P0..P4 = own, enemy, wall counts, own/enemy stone just before the window
    g.copy(pc + F.ME, c + P(3), pc + T(0));
    g.copy(pc + F.OPP, c + P(4), pc + T(0));
    const gather = (x) => {
      g.copy(x + F.ME, x + P(0), x + T(0));
      g.copy(x + F.OPP, x + P(1), x + T(0));
      g.add(x + P(2), 1); g.copy(x + F.REAL, x + P(2), x + T(0), -1);
    };
    walk(c, K - 1, step, [0, 1, 2, 3, 4].map(P), gather);
    gather(L);
    // classify at the last cell. dup = stone before the window and last stone both ours/theirs
    g.mov(L + P(3), [[L + T(0), 1]]); g.copy(L + F.ME, L + T(0), L + T(1)); g.eqConst(L + T(0), 2, L + T(2));
    g.mov(L + P(4), [[L + T(0), 1]]); g.copy(L + F.OPP, L + T(0), L + T(1)); g.eqConst(L + T(0), 2, L + T(3));
    g.eqConst(L + P(2), 0, L + T(4));
    g.mov(L + P(0), [[L + T(5), 1]]);
    g.mov(L + P(1), [[L + T(6), 1]]);
    // result packet: P0 score, P1 win-me, P2 win-opp, P3 threat-me, P4 threat-opp
    const actions = (cnt, dupT, kind) => {
      const lo = kind === 'me' ? 0 : 1;
      for (let v = lo; v <= K - 1; v++) {
        if (sign && v < K - 2) continue; // simulation only tracks threats
        g.copy(cnt, L + T(0), L + T(1)); g.eqConst(L + T(0), v, L + T(1));
        g.ifD(L + T(1), () => {
          if (v === K - 1) g.add(L + P(kind === 'me' ? 1 : 2), 1);
          else if (v === K - 2) {
            g.add(L + T(0), 1); g.mov(dupT, [[L + T(0), -1]]);
            g.ifD(L + T(0), () => {
              g.add(L + P(kind === 'me' ? 3 : 4), 1);
              if (!sign) g.add(L + P(0), kind === 'me' ? wt.tme : wt.topp);
            });
          } else g.add(L + P(0), wt[kind][v]);
        });
      }
    };
    g.ifD(L + T(4), () => {
      g.copy(L + T(6), L + T(0), L + T(1));
      g.add(L + T(7), 1); g.ifD(L + T(0), () => g.add(L + T(7), -1)); // T7 = no enemy stones
      g.add(L + T(0), 1);
      g.ifD(L + T(7), () => { g.add(L + T(0), -1); actions(L + T(5), L + T(2), 'me'); });
      g.ifD(L + T(0), () => {
        g.copy(L + T(5), L + T(0), L + T(1));
        g.add(L + T(1), 1); g.ifD(L + T(0), () => g.add(L + T(1), -1)); // no own stones
        g.ifD(L + T(1), () => actions(L + T(6), L + T(3), 'opp'));
      });
    });
    for (const t of [2, 3, 5, 6]) g.clr(L + T(t));
    // distribute back to the empty cells
    const f = sign || 1;
    const distribute = (x) => {
      g.copy(x + F.EMP, x + T(0), x + T(1));
      g.ifD(x + T(0), () => {
        if (!sign) g.copy(x + P(0), x + F.SCORE, x + T(1));
        g.copy(x + P(1), x + F.WME, x + T(1), f);
        g.copy(x + P(2), x + F.WOPP, x + T(1), f);
        g.copy(x + P(3), x + F.TME, x + T(1), f);
        g.copy(x + P(4), x + F.TOPP, x + T(1), f);
        if (sign > 0) { g.copy(x + P(1), x + T(0), x + T(1)); g.ifD(x + T(0), () => g.clr(x + F.NWF)); }
      });
    };
    walk(L, K - 1, -step, (sign ? [1, 2, 3, 4] : [0, 1, 2, 3, 4]).map(P), distribute);
    distribute(c);
    if (!sign) {
      g.mov(c + P(3), [[c + F.WC + di, 1]]);
      g.mov(c + P(4), [[c + F.WC + di, 2]]);
      for (let j = 0; j < 3; j++) g.clr(c + P(j));
    } else for (let j = 1; j < 5; j++) g.clr(c + P(j));
  }

  // ---- per-square fork flags; CA accumulates the enemy fork count ----
  sweep((c) => {
    g.copy(c + F.TOPP, c + T(0), c + T(1)); g.eqConst(c + T(0), 2, c + F.F2);
    g.copy(c + F.TOPP, c + T(0), c + T(1)); g.geConst(c + T(0), 2, c + F.FGE2);
    g.copy(c + F.FGE2, c + F.CA, c + T(0));
    g.mov(c + F.CA, [[c + B + F.CA, 1]]);
  });
  g.mov(term + F.CA, [[b0 + F.CA, 1]]);

  // ---- pass 2: fork lookahead over threat windows ----
  if (opts.lookahead) {
    sweep((c) => {
      dirs.forEach((d, di) => {
        const step = d * B;
        g.copy(c + F.WC + di, c + T(4), c + T(5));
        g.copy(c + T(4), c + T(5), c + T(6));
        g.eqConst(c + T(5), 1, c + T(6));
        g.ifD(c + T(6), () => window2(c, step, F.FGE2, F.FBAD));
        g.eqConst(c + T(4), 2, c + T(6));
        g.ifD(c + T(6), () => window2(c, step, F.F2, F.DEF));
      });
    });
  }

  // X_i += sum(G over window) - G_i, for each empty cell i
  function window2(c, step, Gf, X) {
    const L = c + (K - 1) * step;
    const gather = (x) => g.copy(x + Gf, x + P(0), x + T(0));
    walk(c, K - 1, step, [P(0)], gather);
    gather(L);
    const distribute = (x) => {
      g.copy(x + F.EMP, x + T(0), x + T(1));
      g.ifD(x + T(0), () => { g.copy(x + P(0), x + X, x + T(1)); g.copy(x + Gf, x + X, x + T(1), -1); });
    };
    walk(L, K - 1, -step, [P(0)], distribute);
    distribute(c);
    g.clr(c + P(0));
  }

  // ---- tier sweep: carry CA = enemy fork count, CB = search candidates, CC = squares with tier >= 5 ----
  sweep((c) => {
    g.clr(c + F.TIER);
    for (let j = 0; j < 4; j++) g.clr(c + F.WC + j);
    g.add(c + F.NCAND, 1);
    g.copy(c + F.EMP, c + T(0), c + T(1));
    g.ifD(c + T(0), () => {
      const tier = c + F.TIER, flag = c + P(1);
      g.add(tier, 2);
      if (opts.lookahead) {
        g.copy(c + F.TME, c + T(0), c + T(1)); g.eqConst(c + T(0), 0, c + T(2));
        g.copy(c + F.TME, c + T(0), c + T(1)); g.eqConst(c + T(0), 1, c + T(3));
        g.copy(c + T(3), c + P(2), c + T(0)); // P2 = forcing move
        g.ifD(c + T(2), () => {
          g.copy(c + F.DEF, c + T(0), c + T(1)); g.copy(c + F.FGE2, c + T(0), c + T(1));
          g.copy(c + F.CA, c + T(1), c + T(4)); g.eqVar(c + T(0), c + T(1), flag);
        });
        g.ifD(c + T(3), () => { g.copy(c + F.FBAD, c + T(0), c + T(1)); g.eqConst(c + T(0), 0, flag); });
        g.ifD(flag, () => {
          setConst(tier, 4);
          if (opts.search) g.ifD(c + P(2), () => { g.add(c + F.CB, 1); g.add(c + F.NCAND, -1); });
        });
        g.clr(c + P(2));
      }
      g.copy(c + F.TME, c + T(0), c + T(1)); g.geConst(c + T(0), 2, c + T(2));
      g.ifD(c + T(2), () => { setConst(tier, 5); g.add(c + P(1), 1); });
      g.copy(c + F.WOPP, c + T(0), c + T(1));
      g.ifD(c + T(0), () => { setConst(tier, 6); g.add(c + P(1), 1); });
      g.copy(c + F.WME, c + T(0), c + T(1));
      g.ifD(c + T(0), () => { setConst(tier, 7); g.add(c + P(1), 1); });
      g.ifD(c + P(1), () => g.add(c + F.CC, 1));
    });
    g.clr(c + F.FBAD);
    for (const f of [F.CA, F.CB, F.CC]) g.mov(c + f, [[c + B + f, 1]]);
  });
  // search budget: none if something already wins / must be blocked, at most SEARCH_CAP
  g.clr(term + F.CA);
  g.ifD(term + F.CC, () => g.clr(term + F.CB));
  g.copy(term + F.CB, term + T(0), term + T(1)); g.geConst(term + T(0), SEARCH_CAP + 1, term + T(3));
  g.ifD(term + T(3), () => setConst(term + F.CB, SEARCH_CAP));
  g.mov(term + F.CB, [[GL.CNT, 1]]);

  // ---- search: simulate each safe forcing move and its forced reply ----
  if (opts.search) {
    const nav = (src, reset) => sweep((c) => {
      g.clr(c + F.NAV); g.copy(c + src, c + F.NAV, c + T(0));
      if (reset) setConst(c + F.NWF, 1);
    });
    g.loop(GL.CNT, () => {
      g.add(GL.CNT, -1);
      g.add(GL.PHASE, 4);
      g.loop(GL.PHASE, () => {
        // phase 4: play candidate (first NCAND=0) | 3: play forced reply (NWF=0)
        // phase 2: take back reply              | 1: take back candidate, record result
        const phaseIs = (k, body) => {
          g.copy(GL.PHASE, GL.FL, GL.FL + 1); g.eqConst(GL.FL, k, GL.FL + 1); g.ifD(GL.FL + 1, body);
        };
        phaseIs(4, () => { nav(F.NCAND, true); g.add(b0 + F.CA, 1); });
        phaseIs(3, () => { nav(F.NWF, false); g.add(b0 + F.CA, 2); });
        phaseIs(2, () => { nav(F.NWF, false); g.add(b0 + F.CA, 3); });
        phaseIs(1, () => { nav(F.NCAND, false); g.add(b0 + F.CA, 4); g.mov(GL.S, [[b0 + F.CB, 1]]); });
        applySweep();
        phaseIs(3, checkSweep);
        g.add(GL.PHASE, -1);
      });
    });
  }

  // Apply op CA (1 play own stone, 2 play enemy stone, 3 remove, 4 remove +
  // record result CB) at the first block with NAV = 0. CC = done.
  function applySweep() {
    sweep((c) => {
      g.copy(c + F.NAV, c + T(0), c + T(1));
      g.add(c + T(2), 1); g.ifD(c + T(0), () => g.add(c + T(2), -1));
      g.copy(c + F.CC, c + T(0), c + T(1)); g.ifD(c + T(0), () => g.clr(c + T(2)));
      g.ifD(c + T(2), () => { g.add(c + F.CC, 1); simulate(c); });
      for (const f of [F.CA, F.CB, F.CC]) g.mov(c + f, [[c + B + f, 1]]);
    });
    for (const f of [F.CA, F.CB, F.CC]) g.clr(term + f);
  }

  function simulate(c) {
    // every window containing c, plus the one whose dedupe check looks at c
    const affected = (sign) => dirs.forEach((d) => {
      walk(c + d * B, K + 1, -d * B, [], (a) => {
        g.copy(a + F.REAL, a + T(0), a + T(1));
        g.ifD(a + T(0), () => window1(a, d * B, 0, sign));
      }, F.WK2);
    });
    const op = (k, body) => { g.copy(c + F.CA, c + T(0), c + T(1)); g.eqConst(c + T(0), k, c + T(1)); g.ifD(c + T(1), body); };
    affected(-1);
    op(1, () => { g.add(c + F.ME, 1); g.add(c + F.EMP, -1); });
    op(2, () => { g.add(c + F.OPP, 1); g.add(c + F.EMP, -1); });
    op(3, () => { g.clr(c + F.ME); g.clr(c + F.OPP); setConst(c + F.EMP, 1); });
    op(4, () => {
      g.clr(c + F.ME); g.clr(c + F.OPP); setConst(c + F.EMP, 1);
      g.add(c + F.NCAND, 1);
      g.copy(c + F.CB, c + T(0), c + T(1)); g.ifD(c + T(0), () => setConst(c + F.TIER, 5));
    });
    affected(1);
  }

  // After candidate + forced reply: success iff we have a double-threat
  // square and the enemy cannot win first (or our fork square blocks its only win).
  function checkSweep() {
    sweep((c) => {
      g.copy(c + F.WOPP, c + T(0), c + T(1)); g.ifD(c + T(0), () => g.add(c + T(3), 1));
      g.copy(c + F.TME, c + T(0), c + T(1)); g.geConst(c + T(0), 2, c + T(4));
      g.copy(c + T(3), c + F.CA, c + T(0));
      g.copy(c + T(4), c + F.CB, c + T(0));
      g.ifD(c + T(3), () => g.copy(c + T(4), c + F.CC, c + T(0)));
      g.clr(c + T(4));
      for (const f of [F.CA, F.CB, F.CC]) g.mov(c + f, [[c + B + f, 1]]);
    });
    g.copy(term + F.CA, term + T(0), term + T(1)); g.eqConst(term + T(0), 0, term + T(2));
    g.eqConst(term + F.CA, 1, term + T(3));
    g.ifD(term + T(2), () => { g.copy(term + F.CB, term + T(0), term + T(1)); g.ifD(term + T(0), () => g.add(GL.S, 1)); });
    g.ifD(term + T(3), () => { g.copy(term + F.CC, term + T(0), term + T(1)); g.ifD(term + T(0), () => g.add(GL.S, 1)); });
    for (const f of [F.CB, F.CC]) g.clr(term + f);
  }

  // ---- choose: carry CB = best tier, CC = best score; mark improvements (NM = 0) ----
  sweep((c) => {
    g.copy(c + F.EMP, c + T(0), c + T(1));
    g.ifD(c + T(0), () => {
      const tier = c + F.TIER, flag = c + P(1);
      g.copy(tier, c + T(0), c + T(1)); g.copy(c + F.CB, c + T(1), c + T(4)); g.gt(c + T(0), c + T(1), flag);
      g.copy(tier, c + T(0), c + T(2)); g.copy(c + F.CB, c + T(1), c + T(2)); g.eqVar(c + T(0), c + T(1), c + T(4));
      g.ifD(c + T(4), () => {
        g.copy(c + F.SCORE, c + T(0), c + T(1)); g.copy(c + F.CC, c + T(1), c + T(2)); g.gt(c + T(0), c + T(1), flag);
      });
      g.ifD(flag, () => {
        g.clr(c + F.NM); g.clr(c + F.CB); g.clr(c + F.CC);
        g.copy(tier, c + F.CB, c + T(0)); g.copy(c + F.SCORE, c + F.CC, c + T(0));
      });
    });
    for (const f of [F.CB, F.CC]) g.mov(c + f, [[c + B + f, 1]]);
  });
  for (const f of [F.CB, F.CC]) g.clr(term + f);

  // ---- output: walk back to the last improvement, print, walk forward to the terminator ----
  g.go(term + F.NM); g.raw('[' + '<'.repeat(B) + ']');
  g.add(term + F.ROW, 48); g.out(term + F.ROW);
  g.add(term + T(0), 32); g.out(term + T(0));
  g.add(term + F.COL, 48); g.out(term + F.COL);
  g.add(term + T(0), -22); g.out(term + T(0)); g.clr(term + T(0));
  g.go(term + F.RAIL); g.raw('[' + '>'.repeat(B) + ']');
}

export const VARIANTS = {
  full: { lookahead: true, search: true, title: 'threat analysis + 2-ply fork lookahead + 4-ply forcing search' },
  '2ply': { lookahead: true, search: false, title: 'threat analysis + 2-ply fork lookahead' },
  threats: { lookahead: false, search: false, title: 'threat analysis only' },
};

export function buildEngine(variant = 'full') {
  const opts = VARIANTS[variant];
  const g = new Gen();
  const header = [
    `Brainfuck Arena Tic-Tac-Toe engine by Claude Opus 5.5 (${opts.title})`,
    'Claude Opus 5.5 entry, generated by its source/engine-gen.js. Input: N newline P newline rows. Output: row col.',
    'Sizes: 3x3 (3 in a row), 5x5 (4 in a row), 10x10 (5 in a row).',
  ];
  g.raw(comment(header));
  g.inp(0);
  g.copy(0, 4, 5); g.eqConst(4, 51, 1);
  g.copy(0, 4, 5); g.eqConst(4, 53, 2);
  g.eqConst(0, 49, 3);
  for (const [flag, N] of [[1, 3], [2, 5], [3, 10]]) g.ifD(flag, () => program(g, N, opts));
  return wrap(g.code());
}

// Header comments must not contain BF command characters.
const comment = (lines) => lines.map((l) => l.replace(/[+\-<>[\].,]/g, ' ')).join('\n') + '\n\n';

function wrap(src, width = 100) {
  const cut = src.indexOf('\n\n') + 2;
  const head = src.slice(0, cut), body = src.slice(cut);
  const lines = [];
  for (let i = 0; i < body.length; i += width) lines.push(body.slice(i, i + width));
  return head + lines.join('\n') + '\n';
}

export const ENGINE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine.bf');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = buildEngine('full');
  writeFileSync(ENGINE_FILE, src);
  console.log(`wrote benchmarks/claude-opus-5.5/engine.bf (${src.length.toLocaleString('en-US')} bytes)`);
}

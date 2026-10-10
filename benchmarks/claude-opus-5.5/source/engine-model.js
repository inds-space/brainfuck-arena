// Executable specification of what engine.bf computes, used ONLY by the test
// suite to cross-check the generated Brainfuck (same 8-bit arithmetic, same
// tie-breaking). The arena never calls this to pick moves.

import { SIZES, WEIGHTS, SEARCH_CAP, VARIANTS, centrality } from './engine-gen.js';

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

export function modelAnalyze(N, me, rows, variant = 'full') {
  const { lookahead, search } = VARIANTS[variant];
  const at = (r, c) => (r >= 0 && r < N && c >= 0 && c < N ? rows[r][c] : '#');
  const S = tables(N, me, rows);
  const mk = () => Array.from({ length: N }, () => new Array(N).fill(0));
  const f2 = (y, x) => (S.topp[y][x] === 2 ? 1 : 0), fge2 = (y, x) => (S.topp[y][x] >= 2 ? 1 : 0);
  S.def = mk(); S.fbad = mk();
  let forks = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) forks += fge2(r, c);
  if (lookahead) for (const { cells, mine } of S.wc) {
    const g = mine ? fge2 : f2, X = mine ? S.fbad : S.def;
    const sum = cells.reduce((a, [y, x]) => a + g(y, x), 0);
    for (const [y, x] of cells) if (at(y, x) === '.') X[y][x] = (X[y][x] + sum - g(y, x)) & 255;
  }

  const tiers = mk(), cand = [];
  let high = false;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (at(r, c) !== '.') continue;
    let tier = 2;
    if (lookahead) {
      const t = S.tme[r][c];
      if ((t === 0 && S.def[r][c] + fge2(r, c) === forks) || (t === 1 && S.fbad[r][c] === 0)) {
        tier = 4;
        if (t === 1 && search) cand.push([r, c]);
      }
    }
    if (S.tme[r][c] >= 2) tier = 5;
    if (S.wopp[r][c]) tier = 6;
    if (S.wme[r][c]) tier = 7;
    if (tier >= 5) high = true;
    tiers[r][c] = tier;
  }

  // forcing-move search: play candidate, play the forced reply, look for a winning double threat
  const opp = me === 'X' ? 'O' : 'X';
  const put = (rs, r, c, v) => rs.map((row, y) => (y === r ? row.slice(0, c) + v + row.slice(c + 1) : row));
  const searched = [];
  if (!high) for (const [r, c] of cand.slice(0, SEARCH_CAP)) {
    const a = put(rows, r, c, me), Ta = tables(N, me, a);
    let w = null;
    for (let y = 0; y < N && !w; y++) for (let x = 0; x < N && !w; x++) if (Ta.wme[y][x]) w = [y, x];
    const b = put(a, w[0], w[1], opp), Tb = tables(N, me, b);
    let A = 0, F0 = 0, F1 = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wo = Tb.wopp[y][x] > 0, fk = Tb.tme[y][x] >= 2;
      A += wo; F0 += fk; F1 += wo && fk;
    }
    const ok = (A === 0 && F0 > 0) || (A === 1 && F1 > 0);
    searched.push({ move: [r, c], reply: w, ok });
    if (ok) tiers[r][c] = 5;
  }

  let best = null;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (at(r, c) !== '.') continue;
    const tier = tiers[r][c], sc = S.score[r][c];
    if (!best || tier > best.tier || (tier === best.tier && sc > best.score)) best = { r, c, tier, score: sc };
  }
  return { move: best && [best.r, best.c], tiers, ...S, forks, searched };
}

/** Pass-1 threat tables for `me` on `rows`. */
function tables(N, me, rows) {
  const K = SIZES[N], wt = WEIGHTS[K];
  const opp = me === 'X' ? 'O' : 'X';
  const at = (r, c) => (r >= 0 && r < N && c >= 0 && c < N ? rows[r][c] : '#');
  const mk = () => Array.from({ length: N }, () => new Array(N).fill(0));
  const S = { wme: mk(), wopp: mk(), tme: mk(), topp: mk(), score: mk(), wc: [] };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) S.score[r][c] = rows[r][c] === '.' ? centrality(N, r, c) : 0;

  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) DIRS.forEach(([dr, dc]) => {
    const cells = Array.from({ length: K }, (_, i) => [r + i * dr, c + i * dc]);
    let nm = 0, no = 0, nw = 0;
    for (const [y, x] of cells) { const v = at(y, x); nm += v === me; no += v === opp; nw += v === '#'; }
    const prev = at(r - dr, c - dc), last = at(...cells[K - 1]);
    const pk = { s: 0, wme: 0, wopp: 0, tme: 0, topp: 0 };
    if (nw === 0) {
      if (no === 0) {
        if (nm === K - 1) pk.wme = 1;
        else if (nm === K - 2) { if (!(prev === me && last === me)) { pk.tme = 1; pk.s = wt.tme; } }
        else if (nm < K - 2) pk.s = wt.me[nm];
      } else if (nm === 0) {
        if (no === K - 1) pk.wopp = 1;
        else if (no === K - 2) { if (!(prev === opp && last === opp)) { pk.topp = 1; pk.s = wt.topp; } }
        else if (no < K - 2) pk.s = wt.opp[no];
      }
    }
    for (const [y, x] of cells) if (at(y, x) === '.') {
      S.score[y][x] = (S.score[y][x] + pk.s) & 255;
      S.wme[y][x] += pk.wme; S.wopp[y][x] += pk.wopp; S.tme[y][x] += pk.tme; S.topp[y][x] += pk.topp;
    }
    if (pk.tme || pk.topp) S.wc.push({ cells, mine: !!pk.tme });
  });

  return S;
}

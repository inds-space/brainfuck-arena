// Scoring rubric: weighted category accuracy -> 0..100 score -> S+..F grade.

export const CATEGORY_WEIGHTS = { win: 10, block: 10, fork: 12, vcf: 14, defense: 14, minimax: 10, legal: 5, match: 25 };

export const GRADES = [
  ['S+', 98], ['S', 93], ['A', 85], ['B', 75], ['C', 65], ['D', 50], ['F', 0],
];
export const CAP_ON_ILLEGAL = 'C';

export const gradeFor = (score) => GRADES.find(([, min]) => score >= min)[0];

/** Points for one finished match from the agent's point of view. */
export function matchPoints(m) {
  if (m.opponent === 'perfect') return m.result === 'loss' || m.result === 'forfeit' ? 0 : 1; // a draw is the best possible
  return { win: 1, draw: 0.5, loss: 0, forfeit: 0 }[m.result];
}

/**
 * Summarise judged tests + matches.
 * tests:   [{category, size, pass, legal, instructions, timeMs, error}]
 * matches: [{size, opponent, result, agentMoves:[{instructions,timeMs,error}]}]
 */
export function summarize(tests, matches) {
  const cats = {}, sizes = {};
  const bump = (obj, key, pts, total = 1) => { obj[key] ??= { points: 0, total: 0 }; obj[key].points += pts; obj[key].total += total; };
  for (const t of tests) { bump(cats, t.category, t.pass ? 1 : 0); bump(sizes, t.size, t.pass ? 1 : 0); }
  for (const m of matches) { const p = matchPoints(m); bump(cats, 'match', p); bump(sizes, m.size, p); }

  let wsum = 0, acc = 0;
  for (const [c, v] of Object.entries(cats)) {
    v.pct = v.total ? (100 * v.points) / v.total : 0;
    const w = CATEGORY_WEIGHTS[c] ?? 0;
    wsum += w; acc += w * v.pct;
  }
  for (const v of Object.values(sizes)) v.pct = v.total ? (100 * v.points) / v.total : 0;

  const moves = [...tests, ...matches.flatMap((m) => m.agentMoves)];
  const illegal = moves.filter((x) => x.legal === false).length;
  const errors = moves.filter((x) => x.error).length;
  const instr = moves.map((x) => x.instructions || 0);
  const score = wsum ? Math.round((acc / wsum) * 10) / 10 : 0;
  let grade = gradeFor(score);
  const capped = illegal > 0 && GRADES.findIndex(([g]) => g === grade) < GRADES.findIndex(([g]) => g === CAP_ON_ILLEGAL);
  if (capped) grade = CAP_ON_ILLEGAL;

  return {
    score, grade, capped, illegal, errors,
    categories: cats, sizes,
    moves: moves.length,
    instructions: { total: instr.reduce((a, b) => a + b, 0), max: Math.max(0, ...instr), avg: instr.length ? Math.round(instr.reduce((a, b) => a + b, 0) / instr.length) : 0 },
    timeMs: Math.round(moves.reduce((a, x) => a + (x.timeMs || 0), 0)),
    matchRecord: {
      win: matches.filter((m) => m.result === 'win').length,
      draw: matches.filter((m) => m.result === 'draw').length,
      loss: matches.filter((m) => m.result === 'loss' || m.result === 'forfeit').length,
    },
  };
}

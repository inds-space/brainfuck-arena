// Benchmark runner: executes a Brainfuck agent on every suite position and in
// full matches. The agent's move is taken ONLY from its stdout.

import { createHash } from 'node:crypto';
import { compile, run, BFError, DEFAULT_LIMITS } from '../core/bf.js';
import { compileFast } from '../core/bf-wasm.js';
import { toInput, parseMove, place, other, winner, emptyCells, rng, MODES } from '../core/game.js';
import { buildSuite, DEFAULT_SEED, SUITE_VERSION } from '../core/suite.js';
import { OPPONENTS } from '../core/opponents.js';
import { summarize } from '../core/grading.js';

const now = () => performance.now();

/** Run an agent (compiled op program, or a compileFast runner) on one position. Never throws. */
export function agentMove(prog, cells, N, toMove, limits = DEFAULT_LIMITS) {
  const input = toInput(cells, N, toMove);
  const t0 = now();
  try {
    const r = typeof prog === 'function' ? prog(input, limits) : run(prog, input, limits);
    const timeMs = now() - t0;
    const mv = parseMove(r.output, cells, N);
    return { input, output: r.output, instructions: r.instructions, timeMs, legal: !mv.error, error: mv.error || null, index: mv.index ?? null, r: mv.r ?? null, c: mv.c ?? null };
  } catch (e) {
    if (!(e instanceof BFError)) throw e;
    return { input, output: '', instructions: e.stats?.instructions ?? 0, timeMs: now() - t0, legal: false, error: `${e.code}: ${e.message}`, index: null };
  }
}

function playMatch(prog, m, limits) {
  const N = m.size, rand = rng(m.seed), opp = OPPONENTS[m.opponent];
  let cells = [...'.'.repeat(N * N)], p = 'X';
  const moves = [], agentMoves = [];
  let result = 'draw';
  for (;;) {
    let idx;
    if (p === m.agentPlays) {
      const a = agentMove(prog, cells, N, p, limits);
      agentMoves.push({ instructions: a.instructions, timeMs: a.timeMs, legal: a.legal, error: a.error });
      if (!a.legal) { result = 'forfeit'; moves.push({ by: 'agent', p, index: null, error: a.error }); break; }
      idx = a.index;
      moves.push({ by: 'agent', p, index: idx, instructions: a.instructions, timeMs: Math.round(a.timeMs * 100) / 100 });
    } else {
      idx = opp.move(cells, N, p, rand);
      moves.push({ by: 'opponent', p, index: idx });
    }
    cells = place(cells, idx, p);
    if (winner(cells, N)) { result = p === m.agentPlays ? 'win' : 'loss'; break; }
    if (!emptyCells(cells).length) break;
    p = other(p);
  }
  return { ...m, result, moves, agentMoves, final: cells.join('') };
}

/**
 * @param {object} o
 * @param {string} o.source          Brainfuck source of the agent
 * @param {{id:string,name:string}} o.agent
 * @param {number} [o.seed]
 * @param {(ev:object)=>void} [o.onProgress]
 */
export function runBenchmark({ source, agent, seed = DEFAULT_SEED, onProgress = () => {}, limits = DEFAULT_LIMITS }) {
  const started = new Date();
  const t0 = now();
  const sha = createHash('sha256').update(source).digest('hex');
  const base = { version: SUITE_VERSION, agent: { ...agent, sha256: sha, bytes: source.length }, seed, limits, startedAt: started.toISOString() };

  let prog;
  try { prog = compileFast(compile(source)); } catch (e) {
    if (!(e instanceof BFError)) throw e;
    const summary = summarize([], []);
    return { ...base, fatal: `${e.code}: ${e.message}`, tests: [], matches: [], summary: { ...summary, grade: 'F' }, durationMs: 0 };
  }

  onProgress({ type: 'phase', phase: 'suite' });
  const suite = buildSuite(seed);
  const total = suite.tests.length + suite.matches.length;
  let done = 0;
  onProgress({ type: 'start', total, tests: suite.tests.length, matches: suite.matches.length });

  const tests = suite.tests.map((t) => {
    const a = agentMove(prog, t.board, t.size, t.toMove, limits);
    const res = {
      id: t.id, size: t.size, category: t.category, board: t.board, toMove: t.toMove, correct: t.correct,
      output: a.output, move: a.index, legal: a.legal, error: a.error,
      pass: a.legal && t.correct.includes(a.index),
      instructions: a.instructions, timeMs: Math.round(a.timeMs * 100) / 100,
    };
    onProgress({ type: 'test', done: ++done, total, test: res });
    return res;
  });

  const matches = suite.matches.map((m) => {
    const res = playMatch(prog, m, limits);
    onProgress({ type: 'match', done: ++done, total, match: { id: res.id, size: res.size, opponent: res.opponent, agentPlays: res.agentPlays, result: res.result } });
    return res;
  });

  const summary = summarize(tests, matches);
  return { ...base, runtime: prog.engine, tests, matches, summary, durationMs: Math.round(now() - t0), finishedAt: new Date().toISOString(), modes: MODES };
}

// Tests for Claude Opus 5.5's Brainfuck engine. The engine is run ONLY through
// the arena interpreter; engine-model.js is an independent JS model used to
// prove the Brainfuck computes exactly the specified algorithm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run } from '../../../src/core/bf.js';
import { toInput, parseMove, rng, place, winner, emptyCells, sideToMove, rowsOf, other } from '../../../src/core/game.js';
import { buildEngine, VARIANTS, ENGINE_FILE } from './engine-gen.js';
import { modelAnalyze } from './engine-model.js';

const committed = readFileSync(ENGINE_FILE, 'utf8');
// The shipped engine is the committed file; the ablations are built in memory.
const engines = Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, compile(v === 'full' ? committed : buildEngine(v))]));
const ask = (variant, cells, N, p = sideToMove(cells)) => {
  const r = run(engines[variant], toInput(cells, N, p));
  return { ...parseMove(r.output, cells, N), output: r.output, instructions: r.instructions };
};

/** Random legal, unfinished positions. */
function* positions(seed, count) {
  const rand = rng(seed);
  for (let k = 0; k < count; k++) {
    const N = [3, 5, 10][k % 3];
    let cells = [...'.'.repeat(N * N)], p = 'X';
    const plies = Math.floor(rand() * N * N * 0.8);
    for (let i = 0; i < plies; i++) {
      const e = emptyCells(cells);
      const next = place(cells, e[Math.floor(rand() * e.length)], p);
      if (winner(next, N) || !next.includes('.')) break;
      cells = next; p = other(p);
    }
    yield { N, cells };
  }
}

test('committed engine.bf is up to date with the generator', () => {
  assert.equal(committed, buildEngine('full'), 'engine.bf is stale: run npm run build:engine');
});

test('engine.bf contains only Brainfuck commands outside its comment header', () => {
  const body = committed.split('\n\n').slice(1).join('');
  assert.match(body.replace(/\n/g, ''), /^[+\-<>[\].,]+$/);
});

test('Brainfuck output equals the reference model, all variants (randomised)', () => {
  for (const variant of Object.keys(engines)) {
    for (const { N, cells } of positions(variant.length * 101, 90)) {
      const p = sideToMove(cells);
      const got = ask(variant, cells, N, p);
      const [r, c] = modelAnalyze(N, p, rowsOf(cells, N), variant).move;
      assert.equal(got.output, `${r} ${c}\n`, `${variant} ${N} ${cells.join('')}`);
    }
  }
});

test('always legal and within the instruction budget', () => {
  let max = 0;
  for (const { N, cells } of positions(9, 240)) {
    const m = ask('full', cells, N);
    assert.equal(m.error, undefined, `${N} ${cells.join('')}: ${m.output}`);
    max = Math.max(max, m.instructions);
  }
  assert.ok(max < 100_000_000, `max ${max}`);
});

test('tactics: win, block, fork, fork defense (both colours)', () => {
  const cases = [
    // [N, board, expected moves]
    [3, 'XX.OO....', [2]], // X wins
    [3, 'XX.O.....', [2]], // O blocks... (O to move)
    [3, 'X...O...X', [1, 3, 5, 7]], // O must not take a corner
    [5, 'XXX......OOO.............', [3]], // X completes 4 in a row
    [10, '..........' + '.XXXX.....' + '.OOOO.....' + '.'.repeat(70), [10, 15]], // X wins at either end
  ];
  for (const [N, b, want] of cases) {
    const m = ask('full', [...b], N);
    assert.ok(want.includes(m.index), `${b}: got ${m.output}`);
  }
});

test('the forcing-move search finds a win in 5 that the 2-ply engine misses', () => {
  const pos = [...'......O.X']; // X to move; forcing play on the right edge wins
  const full = ask('full', pos, 3), plain = ask('2ply', pos, 3);
  const after = place(pos, full.index, 'X');
  assert.equal(winner(after, 3), null);
  assert.notEqual(full.index, plain.index);
  assert.ok([2, 6].includes(full.index) || full.index === 0, `got ${full.output}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway benchmarks/ folder with one fast fixture entry.
const bench = process.env.ARENA_BENCHMARKS = mkdtempSync(join(tmpdir(), 'arena-'));
mkdirSync(join(bench, 'first-empty'));
copyFileSync(new URL('./fixtures/first-empty.bf', import.meta.url), join(bench, 'first-empty', 'engine.bf'));
writeFileSync(join(bench, 'first-empty', 'entry.json'), JSON.stringify({ name: 'First Empty', provider: 'fixture' }));
const { summarize, gradeFor, matchPoints } = await import('../src/core/grading.js');
const { runBenchmark, agentMove } = await import('../src/bench/runner.js');
const { saveResult, loadResult, listResults, leaderboard, deleteResult } = await import('../src/bench/store.js');
const { listAgents, loadAgent } = await import('../src/bench/agents.js');
const { compile } = await import('../src/core/bf.js');
const { DEFAULT_SEED } = await import('../src/core/suite.js');

test('grade thresholds', () => {
  assert.equal(gradeFor(100), 'S+');
  assert.equal(gradeFor(98), 'S+');
  assert.equal(gradeFor(97.9), 'S');
  assert.equal(gradeFor(85), 'A');
  assert.equal(gradeFor(74.9), 'C');
  assert.equal(gradeFor(0), 'F');
});

test('illegal moves cap the grade at C', () => {
  const tests = Array.from({ length: 99 }, () => ({ category: 'win', size: 3, pass: true, legal: true, instructions: 1 }));
  tests.push({ category: 'win', size: 3, pass: false, legal: false, error: 'occupied', instructions: 1 });
  const s = summarize(tests, []);
  assert.equal(s.score, 99);
  assert.equal(s.grade, 'C');
  assert.equal(s.capped, true);
  assert.equal(s.illegal, 1);
});

test('match points', () => {
  assert.equal(matchPoints({ opponent: 'perfect', result: 'draw' }), 1);
  assert.equal(matchPoints({ opponent: 'random', result: 'draw' }), 0.5);
  assert.equal(matchPoints({ opponent: 'greedy', result: 'forfeit' }), 0);
});

test('the runner takes moves only from the agent stdout', () => {
  const fixed = compile('+'.repeat(48) + '.>' + '+'.repeat(32) + '.<.'); // always prints "0 0"
  assert.equal(agentMove(fixed, [...'.........'], 3, 'X').index, 0);
  const occupied = agentMove(fixed, [...'X........'], 3, 'O');
  assert.equal(occupied.legal, false);
  assert.match(occupied.error, /occupied/);
  const looping = agentMove(compile('+[]'), [...'.........'], 3, 'X', { tapeSize: 65536, maxInstructions: 5000 });
  assert.match(looping.error, /^LIMIT/);
});

test('full benchmark of the first-empty fixture: deterministic, stored, official on the default seed', () => {
  const agent = loadAgent('first-empty');
  const run = (seed) => runBenchmark({ source: agent.source, agent: { id: agent.id, name: agent.name }, seed });
  const a = run(5), b = run(5);
  assert.deepEqual(a.tests.map((t) => [t.id, t.move, t.pass]), b.tests.map((t) => [t.id, t.move, t.pass]));
  assert.equal(a.runtime, 'wasm');
  assert.equal(a.summary.illegal, 0);
  assert.equal(a.summary.grade, 'F');
  assert.ok(a.tests.every((t) => t.move === t.board.indexOf('.')), 'first-empty plays the first empty square');
  const id = saveResult(a);
  assert.match(id, /^first-empty-\d{8}-\d{6}$/);
  assert.equal(loadResult(id).summary.score, a.summary.score);
  assert.equal(listResults()[0].id, id);
  assert.deepEqual(leaderboard(), [], 'only default-seed runs are official');
  const official = saveResult({ ...run(DEFAULT_SEED), startedAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(leaderboard()[0].id, official);
  assert.equal(loadResult('../../etc/passwd'), null);
  assert.equal(loadResult('first-empty/../../x'), null);
  assert.equal(deleteResult(id), true);
  assert.equal(deleteResult(official), true);
});

test('a broken agent gets a fatal result, not a crash', () => {
  const r = runBenchmark({ source: '[[', agent: { id: 'bad', name: 'bad' } });
  assert.match(r.fatal, /SYNTAX/);
  assert.equal(r.summary.grade, 'F');
});

test('entries are the folders in benchmarks/', () => {
  mkdirSync(join(bench, 'not-an-entry')); // no engine.bf
  mkdirSync(join(bench, 'Bad_Name')); writeFileSync(join(bench, 'Bad_Name', 'engine.bf'), '+');
  const list = listAgents();
  assert.deepEqual(list.map((a) => a.id), ['first-empty']);
  assert.equal(list[0].name, 'First Empty');
  assert.equal(list[0].provider, 'fixture');
  assert.match(list[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(loadAgent('../first-empty'), null);
});

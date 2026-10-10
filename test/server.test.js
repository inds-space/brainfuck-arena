import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bench = process.env.ARENA_BENCHMARKS = mkdtempSync(join(tmpdir(), 'arena-srv-'));
mkdirSync(join(bench, 'first-empty'));
copyFileSync(new URL('./fixtures/first-empty.bf', import.meta.url), join(bench, 'first-empty', 'engine.bf'));
const { createApp } = await import('../server.js');

let server, base;
before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = async (path, opts) => { const r = await fetch(base + path, opts); return { status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };

test('static app, core modules and SPA fallback', async () => {
  assert.match((await get('/')).body, /Brainfuck Arena/);
  assert.match((await get('/core/bf.js')).type, /javascript/);
  assert.match((await get('/results/x', { headers: { accept: 'text/html' } })).body, /<html/);
  assert.equal((await get('/core/..%2f..%2fpackage.json')).status, 403);
});

test('metadata and agents', async () => {
  const meta = (await get('/api/meta')).body;
  assert.deepEqual(Object.keys(meta.modes), ['3', '5', '10']);
  assert.equal(meta.limits.maxInstructions, 100_000_000);
  const agents = (await get('/api/agents')).body;
  assert.deepEqual(agents.map((a) => a.id), ['first-empty']);
  const src = await get('/api/agents/first-empty/source');
  assert.match(src.body, /First empty/);
  assert.equal((await get('/api/agents/nope/source')).status, 404);
});

test('no uploads: entries only come from benchmarks/', async () => {
  assert.equal((await get('/api/agents', { method: 'POST', body: '{}' })).status, 404);
});

test('benchmark run over the API with live progress events', async () => {
  const bad = await get('/api/runs', { method: 'POST', body: JSON.stringify({ agentId: 'first-empty', seed: -1 }) });
  assert.equal(bad.status, 400);
  const start = await get('/api/runs', { method: 'POST', body: JSON.stringify({ agentId: 'first-empty', seed: 3 }) });
  assert.equal(start.status, 200);
  const busy = await get('/api/runs', { method: 'POST', body: JSON.stringify({ agentId: 'first-empty', seed: 3 }) });
  assert.equal(busy.status, 409);
  const res = await fetch(`${base}/api/runs/${start.body.run.id}/events`);
  const text = await res.text(); // stream ends when the run finishes
  const events = text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
  const all = [...events[0].events, ...events.slice(1)];
  assert.ok(all.some((e) => e.type === 'test'));
  assert.ok(all.some((e) => e.type === 'match'));
  const done = all.find((e) => e.type === 'done');
  assert.ok(done, 'done event');
  const result = (await get(`/api/results/${done.resultId}`)).body;
  assert.equal(result.agent.id, 'first-empty');
  assert.equal(result.seed, 3);
  assert.equal((await get('/api/results')).body[0].id, done.resultId);
  assert.equal((await get(`/api/results/${done.resultId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await get(`/api/results/${done.resultId}`)).status, 404);
});

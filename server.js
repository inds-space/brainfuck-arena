#!/usr/bin/env node
// Brainfuck Arena — local web server (no dependencies, no network access needed).
// Local use only: the public site is the static build (npm run build:site).
//   node server.js            -> http://localhost:8080
//   PORT=3000 node server.js

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { listAgents, loadAgent, agentPath } from './src/bench/agents.js';
import { listResults, loadResult, deleteResult, leaderboard } from './src/bench/store.js';
import { MODES } from './src/core/game.js';
import { CATEGORIES, DEFAULT_SEED, SUITE_VERSION } from './src/core/suite.js';
import { CATEGORY_WEIGHTS, GRADES, CAP_ON_ILLEGAL } from './src/core/grading.js';
import { DEFAULT_LIMITS } from './src/core/bf.js';
import { OPPONENTS } from './src/core/opponents.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC = [['/core/', join(ROOT, 'src', 'core')], ['/', join(ROOT, 'public')]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.bf': 'text/plain; charset=utf-8' };

/** Static benchmark metadata (also pre-rendered by cli/build-site.js). */
export const apiMeta = () => ({
  modes: MODES, categories: CATEGORIES, weights: CATEGORY_WEIGHTS, grades: GRADES, capOnIllegal: CAP_ON_ILLEGAL,
  limits: DEFAULT_LIMITS, defaultSeed: DEFAULT_SEED, suiteVersion: SUITE_VERSION,
  opponents: Object.fromEntries(Object.entries(OPPONENTS).map(([k, v]) => [k, { label: v.label, description: v.description }])),
});

// ---- benchmark run state (one run at a time) ----
let active = null; // { id, agentId, agentName, seed, status, done, total, events, listeners:Set, worker, resultId, error }
const history = new Map(); // finished runs by id (for late SSE subscribers)

function startRun(agentId, seed) {
  const agent = listAgents().find((a) => a.id === agentId);
  if (!agent) throw httpError(404, `Unknown agent "${agentId}"`);
  if (active && active.status === 'running') throw httpError(409, 'A benchmark is already running.');
  const run = { id: randomUUID(), agentId, agentName: agent.name, seed, status: 'running', done: 0, total: 0, events: [], listeners: new Set(), startedAt: new Date().toISOString() };
  const emit = (ev) => { run.events.push(ev); for (const l of run.listeners) l(ev); };
  run.worker = new Worker(new URL('./src/bench/run-worker.js', import.meta.url), { workerData: { agentId, seed } });
  run.worker.on('message', (msg) => {
    if (msg.type === 'progress') {
      const ev = msg.ev;
      if (ev.type === 'start') run.total = ev.total;
      if (ev.done) run.done = ev.done;
      emit(ev);
    } else if (msg.type === 'done') {
      run.status = 'done'; run.resultId = msg.id;
      emit({ type: 'done', resultId: msg.id, summary: msg.summary, fatal: msg.fatal });
    } else if (msg.type === 'error') {
      run.status = 'error'; run.error = msg.message;
      emit({ type: 'error', message: msg.message });
    }
  });
  run.worker.on('error', (e) => { run.status = 'error'; run.error = e.message; emit({ type: 'error', message: e.message }); });
  run.worker.on('exit', () => {
    if (run.status === 'running') { run.status = 'cancelled'; emit({ type: 'cancelled' }); }
    for (const l of run.listeners) l(null);
    run.listeners.clear();
  });
  active = run;
  history.set(run.id, run);
  return run;
}

const publicRun = (r) => r && { id: r.id, agentId: r.agentId, agentName: r.agentName, seed: r.seed, status: r.status, done: r.done, total: r.total, resultId: r.resultId || null, error: r.error || null, startedAt: r.startedAt };

// ---- http helpers ----
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}
async function readJson(req, limit = 10 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw httpError(413, 'Request body too large.'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw httpError(400, 'Invalid JSON body.'); }
}

async function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    const file = normalize(join(dir, rel));
    if (!file.startsWith(dir + sep) && file !== dir) return send(res, 403, { error: 'Forbidden' });
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(await readFile(file));
    }
  }
  // SPA fallback
  if (req.headers.accept?.includes('text/html')) {
    res.writeHead(200, { 'Content-Type': TYPES['.html'] });
    return res.end(await readFile(join(ROOT, 'public', 'index.html')));
  }
  send(res, 404, { error: 'Not found' });
}

const routes = [
  ['GET', /^\/api\/health$/, () => ({ ok: true })],
  ['GET', /^\/api\/meta$/, apiMeta],
  ['GET', /^\/api\/agents$/, () => listAgents()],
  ['GET', /^\/api\/agents\/([\w.-]+)\/source$/, async (req, res, [, id]) => {
    const path = agentPath(id);
    if (!path) throw httpError(404, 'Unknown agent');
    res.writeHead(200, { 'Content-Type': TYPES['.bf'], 'Cache-Control': 'no-cache' });
    res.end(await readFile(path));
  }],
  ['GET', /^\/api\/results$/, () => listResults()],
  ['GET', /^\/api\/leaderboard$/, () => leaderboard()],
  ['GET', /^\/api\/results\/([\w.-]+)$/, (req, res, [, id]) => loadResult(id) || Promise.reject(httpError(404, 'Result not found'))],
  ['DELETE', /^\/api\/results\/([\w.-]+)$/, (req, res, [, id]) => (deleteResult(id) ? { ok: true } : Promise.reject(httpError(404, 'Result not found')))],
  ['GET', /^\/api\/runs\/current$/, () => ({ run: publicRun(active) })],
  ['POST', /^\/api\/runs$/, async (req) => {
    const { agentId, seed = DEFAULT_SEED } = await readJson(req);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw httpError(400, 'seed must be an integer between 0 and 4294967295');
    if (!loadAgent(agentId)) throw httpError(404, `Unknown agent "${agentId}"`);
    return { run: publicRun(startRun(agentId, seed)) };
  }],
  ['POST', /^\/api\/runs\/([\w-]+)\/cancel$/, (req, res, [, id]) => {
    const run = history.get(id);
    if (!run) throw httpError(404, 'Unknown run');
    if (run.status === 'running') run.worker.terminate();
    return { ok: true };
  }],
  ['GET', /^\/api\/runs\/([\w-]+)\/events$/, (req, res, [, id]) => {
    const run = history.get(id);
    if (!run) throw httpError(404, 'Unknown run');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const write = (ev) => { if (ev) res.write(`data: ${JSON.stringify(ev)}\n\n`); else res.end(); };
    write({ type: 'snapshot', run: publicRun(run), events: run.events });
    if (run.status !== 'running') return res.end();
    run.listeners.add(write);
    req.on('close', () => run.listeners.delete(write));
  }],
];

export function createApp() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, re, handler] of routes) {
          const m = re.exec(url.pathname);
          if (!m) continue;
          if (req.method !== method) continue;
          const out = await handler(req, res, m);
          if (!res.headersSent) send(res, 200, out);
          return;
        }
        throw httpError(404, 'No such endpoint');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed');
      await serveStatic(req, res, url.pathname);
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Internal server error' });
      else res.end();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => console.log(`Brainfuck Arena running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}

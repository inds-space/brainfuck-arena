#!/usr/bin/env node
// Builds the public site into dist/: the web app plus every API response it
// reads, pre-rendered as files. No server, no database: brainfuck-arena.inds.space
// is these static files on a Cloudflare Worker. Run, upload and delete are local-only.
//
// Also writes .cloudflare/output/ (Cloudflare's Build Output, assets-only Worker)
// so `cf deploy --prebuilt` can ship it without any npm dependencies.

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listAgents, agentPath } from '../src/bench/agents.js';
import { listResults, loadResult, leaderboard } from '../src/bench/store.js';
import { apiMeta } from '../server.js';

const DIST = join(ROOT, 'dist');
const json = (rel, data) => { mkdirSync(join(DIST, rel, '..'), { recursive: true }); writeFileSync(join(DIST, rel), JSON.stringify(data)); };

rmSync(DIST, { recursive: true, force: true });
cpSync(join(ROOT, 'public'), DIST, { recursive: true });
cpSync(join(ROOT, 'src', 'core'), join(DIST, 'core'), { recursive: true });
const config = join(DIST, 'js', 'config.js');
writeFileSync(config, readFileSync(config, 'utf8').replace('export const STATIC = false;', 'export const STATIC = true;'));
copyFileSync(join(DIST, 'index.html'), join(DIST, 'benchmark.html')); // brainfuck-arena.inds.space/benchmark

const agents = listAgents().map(({ updatedAt, ...a }) => a); // mtime is checkout noise
const results = listResults();
json('api/meta.json', apiMeta());
json('api/agents.json', agents);
json('api/results.json', results);
json('api/leaderboard.json', leaderboard());
for (const r of results) json(`api/results/${r.id}.json`, loadResult(r.id));
for (const a of agents) { mkdirSync(join(DIST, 'api', 'agents'), { recursive: true }); copyFileSync(agentPath(a.id), join(DIST, 'api', 'agents', `${a.id}.bf`)); }

// ponytail: Build Output spec is v0 (draft); if cf changes it, regenerate with `cf build`.
const OUT = join(ROOT, '.cloudflare', 'output', 'v0');
rmSync(join(ROOT, '.cloudflare', 'output'), { recursive: true, force: true });
cpSync(DIST, join(OUT, 'workers', 'default', 'assets'), { recursive: true });
writeFileSync(join(OUT, 'config.json'), JSON.stringify({ buildContext: { isPreview: false } }));
writeFileSync(join(OUT, 'workers', 'default', 'worker.config.json'), JSON.stringify({
  name: 'brainfuck-arena', compatibilityDate: '2026-10-06', domains: ['brainfuck-arena.inds.space'], workersDev: false,
  assets: { htmlHandling: 'auto-trailing-slash', notFoundHandling: '404-page' },
}, null, 2));

console.log(`dist/: ${agents.length} entries, ${results.length} results (+ .cloudflare/output for cf deploy --prebuilt)`);

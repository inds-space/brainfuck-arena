// Result storage: one JSON file per benchmark run in benchmarks/<entry>/results/.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH, ID_RE } from './agents.js';
import { DEFAULT_SEED } from '../core/suite.js';

const dirOf = (entry) => join(BENCH(), entry, 'results');
const entries = () => (existsSync(BENCH()) ? readdirSync(BENCH()).filter((d) => ID_RE.test(d) && existsSync(dirOf(d))) : []);
const fileOf = (id) => (ID_RE.test(id || '') ? entries().map((e) => join(dirOf(e), `${id}.json`)).find(existsSync) : undefined);

/** Saves into the entry's results/ folder; the entry folder must exist. */
export function saveResult(result) {
  const stamp = result.startedAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const id = `${result.agent.id}-${stamp}`;
  mkdirSync(dirOf(result.agent.id), { recursive: true });
  writeFileSync(join(dirOf(result.agent.id), `${id}.json`), JSON.stringify({ ...result, id }));
  return id;
}

export function loadResult(id) {
  const f = fileOf(id);
  return f ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

export function deleteResult(id) {
  const f = fileOf(id);
  if (!f) return false;
  unlinkSync(f);
  return true;
}

/** Summaries of all stored runs, newest first. */
export function listResults() {
  return entries().flatMap((e) => readdirSync(dirOf(e)).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const r = JSON.parse(readFileSync(join(dirOf(e), f), 'utf8'));
      return { id: r.id, agent: r.agent, seed: r.seed, version: r.version, startedAt: r.startedAt, durationMs: r.durationMs, fatal: r.fatal || null, summary: r.summary };
    } catch { return null; }
  })).filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The official result per entry: its most recent run on the default seed. */
export function leaderboard() {
  const best = new Map();
  for (const r of listResults()) if (r.seed === DEFAULT_SEED && !best.has(r.agent.id)) best.set(r.agent.id, r);
  return [...best.values()].sort((a, b) => b.summary.score - a.summary.score);
}

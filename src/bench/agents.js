// Entry registry: every folder in benchmarks/ with an engine.bf is an entry.
//   benchmarks/<id>/engine.bf    the Brainfuck program
//   benchmarks/<id>/entry.json   name, model, provider, ... and Ind's tier
//   benchmarks/<id>/results/     official benchmark results (see store.js)

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Benchmarks root; ARENA_BENCHMARKS overrides it (tests use a temp dir). */
export const BENCH = () => process.env.ARENA_BENCHMARKS || join(ROOT, 'benchmarks');
export const ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/; // e.g. claude-opus-5.5; no slashes, no ".."

const sha = (s) => createHash('sha256').update(s).digest('hex');

function describe(id) {
  const dir = join(BENCH(), id);
  const path = join(dir, 'engine.bf');
  const source = readFileSync(path, 'utf8');
  const meta = existsSync(join(dir, 'entry.json')) ? JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')) : {};
  return {
    name: id, description: '', indTier: null, indNote: null, ...meta, id,
    file: `benchmarks/${id}/engine.bf`, bytes: source.length,
    commands: source.replace(/[^+\-<>[\].,]/g, '').length, sha256: sha(source), updatedAt: statSync(path).mtime.toISOString(),
  };
}

export function listAgents() {
  if (!existsSync(BENCH())) return [];
  return readdirSync(BENCH()).filter((d) => ID_RE.test(d) && existsSync(join(BENCH(), d, 'engine.bf'))).sort().map(describe);
}

export function agentPath(id) {
  if (!ID_RE.test(id || '')) return null;
  const path = join(BENCH(), id, 'engine.bf');
  return existsSync(path) ? path : null;
}

export function loadAgent(id) {
  const path = agentPath(id);
  return path ? { ...describe(id), source: readFileSync(path, 'utf8') } : null;
}

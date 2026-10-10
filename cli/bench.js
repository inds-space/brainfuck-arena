#!/usr/bin/env node
// Official benchmark from the terminal.
//   npm run bench                              # every entry in benchmarks/
//   npm run bench -- --entry claude-opus-5.5   # one entry (results saved in its results/)
//   npm run bench -- --file my.bf              # any Brainfuck file (never saved)
//   options: --seed N  --no-save  --json  --quiet

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { runBenchmark } from '../src/bench/runner.js';
import { listAgents, loadAgent } from '../src/bench/agents.js';
import { saveResult } from '../src/bench/store.js';
import { DEFAULT_SEED, CATEGORIES } from '../src/core/suite.js';

const { values: opt } = parseArgs({
  options: {
    entry: { type: 'string' }, file: { type: 'string' },
    seed: { type: 'string', default: String(DEFAULT_SEED) }, 'no-save': { type: 'boolean' },
    json: { type: 'boolean' }, quiet: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
});
if (opt.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 6).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

const seed = Number(opt.seed);
if (!Number.isInteger(seed) || seed < 0) { console.error('--seed must be a non-negative integer'); process.exit(2); }

let agents;
if (opt.file) { agents = [{ id: basename(opt.file, '.bf').toLowerCase().replace(/[^a-z0-9.-]/g, '-'), name: basename(opt.file), source: readFileSync(opt.file, 'utf8') }]; opt['no-save'] = true; }
else if (opt.entry) {
  const a = loadAgent(opt.entry);
  if (!a) { console.error(`Unknown entry "${opt.entry}". Known: ${listAgents().map((x) => x.id).join(', ') || 'none'}`); process.exit(2); }
  agents = [a];
} else agents = listAgents().map((a) => loadAgent(a.id));
if (!agents.length) { console.error('No entries found in benchmarks/.'); process.exit(2); }

const fmt = (n) => n.toLocaleString('en-US');
const out = [];
for (const a of agents) {
  if (!opt.quiet && !opt.json) process.stderr.write(`\n▶ ${a.name}  (seed ${seed})\n`);
  const result = runBenchmark({
    source: a.source, agent: { id: a.id, name: a.name }, seed,
    onProgress: (ev) => {
      if (opt.quiet || opt.json || (ev.type !== 'test' && ev.type !== 'match')) return;
      const w = 30, f = Math.round((ev.done / ev.total) * w);
      process.stderr.write(`\r  [${'█'.repeat(f)}${'·'.repeat(w - f)}] ${ev.done}/${ev.total}`);
    },
  });
  if (!opt['no-save']) result.id = saveResult(result);
  out.push(result);
  if (opt.json) continue;
  const s = result.summary;
  process.stderr.write('\n');
  if (result.fatal) { console.log(`  FATAL ${result.fatal}`); continue; }
  console.log(`\n  ${a.name}: grade ${s.grade}  score ${s.score}/100${s.capped ? '  (capped: illegal moves)' : ''}`);
  console.log('  ' + '-'.repeat(54));
  for (const [c, v] of Object.entries(s.categories)) {
    console.log(`  ${CATEGORIES[c].label.padEnd(18)} ${String(+v.points.toFixed(1)).padStart(5)}/${String(v.total).padEnd(4)} ${v.pct.toFixed(1).padStart(6)}%`);
  }
  console.log('  ' + '-'.repeat(54));
  for (const [n, v] of Object.entries(s.sizes)) console.log(`  ${(`${n}×${n}`).padEnd(18)} ${v.pct.toFixed(1).padStart(18)}%`);
  console.log(`  matches W/D/L      ${s.matchRecord.win}/${s.matchRecord.draw}/${s.matchRecord.loss}`);
  console.log(`  illegal moves      ${s.illegal}   runtime errors ${s.errors}`);
  console.log(`  instructions       avg ${fmt(s.instructions.avg)}  max ${fmt(s.instructions.max)}  (limit 100,000,000)`);
  console.log(`  time               ${(result.durationMs / 1000).toFixed(1)} s for ${s.moves} agent moves`);
  console.log(`  runtime            ${result.runtime}`);
  if (result.id) console.log(`  saved              benchmarks/${a.id}/results/${result.id}.json`);
}
if (opt.json) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));

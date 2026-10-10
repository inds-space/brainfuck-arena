// Web Worker: runs Brainfuck agents compiled to WebAssembly (same results as the
// benchmark's reference interpreter; falls back to it on any error).
import { compile } from '/core/bf.js';
import { compileFast } from '/core/bf-wasm.js';

const programs = new Map();
self.onmessage = ({ data }) => {
  const { id, agentId, source, input } = data;
  const t0 = performance.now();
  try {
    if (source != null) programs.set(agentId, compileFast(compile(source)));
    const prog = programs.get(agentId);
    if (!prog) throw new Error('Agent not loaded');
    const r = prog(input);
    self.postMessage({ id, ok: true, output: r.output, instructions: r.instructions, runtime: prog.engine, timeMs: performance.now() - t0 });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.code ? `${e.code}: ${e.message}` : e.message, instructions: e.stats?.instructions ?? 0, timeMs: performance.now() - t0 });
  }
};

// Worker thread: runs one benchmark so the HTTP server stays responsive.
import { parentPort, workerData } from 'node:worker_threads';
import { runBenchmark } from './runner.js';
import { loadAgent } from './agents.js';
import { saveResult } from './store.js';

const { agentId, seed } = workerData;
try {
  const agent = loadAgent(agentId);
  if (!agent) throw new Error(`Unknown agent ${agentId}`);
  const result = runBenchmark({
    source: agent.source, agent: { id: agent.id, name: agent.name }, seed,
    onProgress: (ev) => parentPort.postMessage({ type: 'progress', ev }),
  });
  const id = saveResult(result);
  parentPort.postMessage({ type: 'done', id, summary: result.summary, fatal: result.fatal || null });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
}

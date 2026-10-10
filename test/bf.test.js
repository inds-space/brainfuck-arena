import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, compile, BFError } from '../src/core/bf.js';
import { compileFast } from '../src/core/bf-wasm.js';
import { rng } from '../src/core/game.js';

// Character-at-a-time reference interpreter with identical counting rules.
function naive(src, input = '', limit = 300000) {
  const code = [...src].filter((c) => '+-<>[].,'.includes(c));
  const match = {}, st = [];
  code.forEach((c, i) => { if (c === '[') st.push(i); if (c === ']') { const o = st.pop(); match[o] = i; match[i] = o; } });
  const t = new Uint8Array(65536);
  let p = 0, pc = 0, n = 0, ip = 0, out = '';
  while (pc < code.length) {
    const c = code[pc]; n++;
    if (n > limit || p < 0 || p > 65535) return null;
    if (c === '+') t[p]++; else if (c === '-') t[p]--; else if (c === '>') p++; else if (c === '<') p--;
    else if (c === '.') out += String.fromCharCode(t[p]);
    else if (c === ',') t[p] = ip < input.length ? input.charCodeAt(ip++) : 0;
    else if (c === '[') { if (!t[p]) { pc = match[pc] + 1; continue; } }
    else if (c === ']') { if (t[p]) { pc = match[pc] + 1; continue; } }
    pc++;
  }
  return { out, n };
}

test('hello world', () => {
  const src = '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.';
  assert.equal(run(src).output, 'Hello World!\n');
});

test('8-bit cells wrap in both directions', () => {
  assert.equal(run('-.').output.charCodeAt(0), 255);
  assert.equal(run('-+.').output.charCodeAt(0), 0);
  assert.equal(run('+'.repeat(256) + '.').output.charCodeAt(0), 0);
  assert.equal(run('[+]+[-]+++.').output.charCodeAt(0), 3);
});

test('EOF reads 0 and input is consumed in order', () => {
  assert.equal(run(',.,.,.', 'ab').output, 'ab\0');
  assert.equal(run(',[.,]', 'xyz').output, 'xyz');
});

test('comments are ignored', () => {
  assert.equal(run('hello +++ world .').output.charCodeAt(0), 3);
});

test('unbalanced brackets are a SYNTAX error', () => {
  for (const src of ['[', ']', '[[]', '][']) {
    assert.throws(() => compile(src), (e) => e instanceof BFError && e.code === 'SYNTAX');
  }
});

test('tape bounds are enforced (65,536 cells)', () => {
  assert.throws(() => run('<'), (e) => e.code === 'TAPE');
  assert.throws(() => run('+[>+]'), (e) => e.code === 'TAPE');
  assert.equal(run('>'.repeat(65535) + '+.').output.charCodeAt(0), 1);
  assert.throws(() => run('>'.repeat(65536)), (e) => e.code === 'TAPE');
});

test('instruction limit is enforced', () => {
  assert.throws(() => run('+[]'), (e) => e.code === 'LIMIT' && e.stats.instructions > 100_000_000);
  assert.throws(() => run('+[]', '', { maxInstructions: 1000 }), (e) => e.code === 'LIMIT');
  assert.equal(run('+++', '', { maxInstructions: 3 }).instructions, 3);
  assert.throws(() => run('++++', '', { maxInstructions: 3 }), (e) => e.code === 'LIMIT');
});

test('output is capped', () => {
  assert.throws(() => run('+[.]'), (e) => e.code === 'OUTPUT');
});

test('instruction counts match a naive interpreter exactly (differential fuzz)', () => {
  const rand = rng(42);
  const gen = (d) => {
    let s = '';
    const n = 1 + Math.floor(rand() * 10);
    for (let i = 0; i < n; i++) {
      const r = rand();
      if (r < 0.3) s += '+'.repeat(1 + Math.floor(rand() * 5));
      else if (r < 0.45) s += '-';
      else if (r < 0.6) s += '>';
      else if (r < 0.7) s += '<';
      else if (r < 0.75) s += '.';
      else if (r < 0.8) s += ',';
      else if (d < 3) s += `[${rand() < 0.3 ? '-' : ''}${gen(d + 1)}]`;
    }
    return s;
  };
  let checked = 0;
  for (let k = 0; k < 4000; k++) {
    const src = `>>>>${gen(0)}`;
    const ref = naive(src, 'fuzz input');
    if (!ref || ref.out.length > 60000) continue;
    const got = run(src, 'fuzz input', { maxInstructions: 1e7 });
    assert.equal(got.output, ref.out, src);
    assert.equal(got.instructions, ref.n, src);
    checked++;
  }
  assert.ok(checked > 2000, `only ${checked} programs checked`);
});

// Same result as run(): output + count on success, the identical BFError otherwise.
const outcome = (f) => { try { const r = f(); return { output: r.output, instructions: r.instructions }; } catch (e) { return { code: e.code, message: e.message, instructions: e.stats?.instructions }; } };

test('WebAssembly compiler: same results as the interpreter (differential fuzz incl. errors)', () => {
  const rand = rng(7);
  const ops = ['+', '++', '-', '>', '>>', '<', '.', ',', '[-]', '[+]', '[>]', '[<<]', '[->+<]', '[->>++<<]'];
  const gen = (d) => {
    let s = '';
    for (let i = 0, n = 1 + Math.floor(rand() * 9); i < n; i++) s += rand() < 0.2 && d < 3 ? `[${gen(d + 1)}]` : ops[Math.floor(rand() * ops.length)];
    return s;
  };
  let errors = 0;
  for (let k = 0; k < 3000; k++) {
    const src = (k % 3 ? '>>>>' : '') + gen(0);
    const limits = { maxInstructions: k % 2 ? 5000 : 200000 };
    const fast = compileFast(src);
    assert.equal(fast.engine, 'wasm');
    const want = outcome(() => run(src, 'fuzz input', limits));
    assert.deepEqual(outcome(() => fast('fuzz input', limits)), want, src);
    if (want.code) errors++;
    else assert.equal(fast.fallbacks, 0, `successful run fell back to the interpreter: ${src}`);
  }
  assert.ok(errors > 200, `only ${errors} error cases exercised`);
});

test('WebAssembly compiler: bounds, limit, output cap and long programs', () => {
  for (const src of ['<', '+[>+]', '>'.repeat(65536), '+[]', '+[.]', '>'.repeat(65535) + '+.', '+'.repeat(256) + '.', ',[.,]']) {
    assert.deepEqual(outcome(() => compileFast(src)('xyz')), outcome(() => run(src, 'xyz')), src.slice(0, 20));
  }
  assert.deepEqual(outcome(() => compileFast('+++')('', { maxInstructions: 3 })), { output: '', instructions: 3 });
  assert.equal(outcome(() => compileFast('++++')('', { maxInstructions: 3 })).code, 'LIMIT');
  const big = '+>'.repeat(20000) + '[-]<'.repeat(5000) + '.'; // spans many generated functions
  assert.deepEqual(outcome(() => compileFast(big)()), outcome(() => run(big)));
});

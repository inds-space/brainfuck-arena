// Brainfuck -> WebAssembly compiler. Isomorphic (Node + browser/worker), no toolchain:
// it turns the op list from bf.js straight into a .wasm binary.
//
// Exactness: the module counts instructions with the same rules as bf.js. It checks
// the instruction limit at every loop back-edge and at the end, and checks tape and
// output bounds on every access. Any failure traps (`unreachable`). A trap means
// "something went wrong", so the move is re-run on the reference interpreter, which
// reports the exact error. A run that completes without trapping gives the same
// output and instruction count as bf.js; test/bf.test.js checks this differentially.
//
// Memory (3 pages): [0, 64K) tape · [64K, 128K) stdin · [128K, 192K) stdout.

import { compile, run, DEFAULT_LIMITS } from './bf.js';

const ADD = 0, MOVE = 1, OUT = 2, IN = 3, OPEN = 4, CLOSE = 5, CLEAR = 6, SCAN = 7, MUL = 8;
const TAPE = 65536, IN_BASE = 65536, OUT_BASE = 131072;
const CHUNK = 1500; // ops per generated function, so no single function gets huge

// globals
const G_N = 0, G_MAX = 1, G_INPOS = 2, G_INLEN = 3, G_OUTLEN = 4;
// locals of chunk functions: p (param), v, q
const L_P = 0, L_V = 1, L_Q = 2;

const uleb = (n, out) => { do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); };
const sleb = (n, out) => {
  for (;;) {
    const b = n & 0x7f; n >>= 7;
    if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { out.push(b); return; }
    out.push(b | 0x80);
  }
};

class Bytes {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  push(...xs) { for (const x of xs) { if (this.len === this.buf.length) this.grow(1); this.buf[this.len++] = x; } }
  grow(k) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.len + k)); b.set(this.buf.subarray(0, this.len)); this.buf = b; }
  append(bytes) { if (this.len + bytes.length > this.buf.length) this.grow(bytes.length); this.buf.set(bytes, this.len); this.len += bytes.length; }
  bytes() { return this.buf.subarray(0, this.len); }
}

/** Compile an op program (from bf.js compile) to WebAssembly module bytes. */
export function toWasm(prog) {
  const { op, a, b, cost, muls } = prog;
  const len = op.length;
  const close = new Int32Array(len); // OPEN index -> matching CLOSE index
  { const st = []; for (let i = 0; i < len; i++) { if (op[i] === OPEN) st.push(i); else if (op[i] === CLOSE) close[st.pop()] = i; } }

  const bodies = [null]; // function bodies by index; 0 = exported `run`

  // Emits ops [i, j) as a new function (param p) (result p); returns its index.
  function fn(i, j) {
    const idx = bodies.length;
    bodies.push(null);
    const c = [];
    let pending = 0; // statically known instruction cost not yet added to $n
    const flush = () => { if (pending) { c.push(0x23, G_N, 0x42); sleb(pending, c); c.push(0x7c, 0x24, G_N); pending = 0; } };
    const addDyn = (emitI64) => { c.push(0x23, G_N); emitI64(); c.push(0x7c, 0x24, G_N); };
    const cell = () => c.push(0x20, L_P, 0x2d, 0, 0); // tape[p] (i32.load8_u)
    const trapIf = () => c.push(0x04, 0x40, 0x00, 0x0b); // if (cond) unreachable
    const limitCheck = () => { c.push(0x23, G_N, 0x23, G_MAX, 0x56); trapIf(); };
    const bounds = (local) => { c.push(0x20, local, 0x41); sleb(TAPE, c); c.push(0x4f); trapIf(); };

    const seq = (s, e) => {
      // Split long sequences into calls so each function stays small.
      if (e - s > CHUNK) {
        let k = s;
        while (k < e) {
          let m = k, size = 0;
          while (m < e && (size === 0 || size + (op[m] === OPEN ? close[m] - m + 1 : 1) <= CHUNK)) {
            const w = op[m] === OPEN ? close[m] - m + 1 : 1;
            size += w; m += w;
          }
          if (m - k === 1 || (op[k] === OPEN && close[k] + 1 === m)) item(k); // a single item: inline it
          else { flush(); const f = fn(k, m); c.push(0x20, L_P, 0x10); uleb(f, c); c.push(0x21, L_P); }
          k = m;
        }
        return;
      }
      for (let k = s; k < e;) k = item(k);
    };

    // Emits the item at k (one op, or a whole loop); returns the next index.
    function item(k) {
      switch (op[k]) {
        case ADD: c.push(0x20, L_P); cell(); c.push(0x41); sleb(a[k], c); c.push(0x6a, 0x3a, 0, 0); pending += cost[k]; return k + 1;
        case MOVE: c.push(0x20, L_P, 0x41); sleb(a[k], c); c.push(0x6a, 0x21, L_P); bounds(L_P); pending += cost[k]; return k + 1;
        case OUT:
          c.push(0x23, G_OUTLEN, 0x41); sleb(65536, c); c.push(0x4f); trapIf();
          c.push(0x23, G_OUTLEN); cell(); c.push(0x3a, 0); uleb(OUT_BASE, c);
          c.push(0x23, G_OUTLEN, 0x41, 1, 0x6a, 0x24, G_OUTLEN);
          pending += 1; return k + 1;
        case IN:
          c.push(0x20, L_P);
          c.push(0x23, G_INPOS, 0x23, G_INLEN, 0x49, 0x04, 0x7f); // if (result i32) inPos < inLen
          c.push(0x23, G_INPOS, 0x2d, 0); uleb(IN_BASE, c);
          c.push(0x23, G_INPOS, 0x41, 1, 0x6a, 0x24, G_INPOS);
          c.push(0x05, 0x41, 0, 0x0b);
          c.push(0x3a, 0, 0);
          pending += 1; return k + 1;
        case CLEAR: // [-] costs 1 + 2v, [+] costs 1 + 2(256 - v) unless v = 0
          pending += 1;
          cell(); c.push(0x22, L_V);
          c.push(0x04, 0x40);
          addDyn(() => { if (a[k]) { c.push(0x41); sleb(256, c); c.push(0x20, L_V, 0x6b); } else c.push(0x20, L_V); c.push(0x41, 1, 0x74, 0xad); });
          c.push(0x20, L_P, 0x41, 0, 0x3a, 0, 0, 0x0b);
          return k + 1;
        case SCAN: { // [>>>] : 1 + iterations * (|stride| + 1)
          pending += 1;
          const s = a[k];
          c.push(0x02, 0x40, 0x03, 0x40);
          cell(); c.push(0x45, 0x0d, 1);
          c.push(0x20, L_P, 0x41); sleb(s, c); c.push(0x6a, 0x21, L_P); bounds(L_P);
          addDyn(() => { c.push(0x42); sleb(Math.abs(s) + 1, c); });
          c.push(0x0c, 0, 0x0b, 0x0b);
          return k + 1;
        }
        case MUL: { // [->+>++<<] : 1 + v * (bodyLen + 1)
          pending += 1;
          const pairs = muls[a[k]];
          cell(); c.push(0x22, L_V, 0x04, 0x40);
          for (let j = 0; j < pairs.length; j += 2) {
            c.push(0x20, L_P, 0x41); sleb(pairs[j], c); c.push(0x6a, 0x22, L_Q); c.push(0x41); sleb(TAPE, c); c.push(0x4f); trapIf();
            c.push(0x20, L_Q, 0x20, L_Q, 0x2d, 0, 0, 0x20, L_V, 0x41); sleb(pairs[j + 1], c); c.push(0x6c, 0x6a, 0x3a, 0, 0);
          }
          c.push(0x20, L_P, 0x41, 0, 0x3a, 0, 0);
          addDyn(() => { c.push(0x20, L_V, 0xad, 0x42); sleb(b[k] + 1, c); c.push(0x7e); });
          c.push(0x0b);
          return k + 1;
        }
        case OPEN: {
          const e = close[k];
          pending += 1; flush();
          cell(); c.push(0x04, 0x40, 0x03, 0x40); // if (tape[p]) loop
          seq(k + 1, e);
          pending += 1; flush(); limitCheck();
          cell(); c.push(0x0d, 0, 0x0b, 0x0b); // br_if loop; end loop; end if
          return e + 1;
        }
        default: throw new Error(`unexpected op ${op[k]} at ${k}`);
      }
    }

    seq(i, j);
    flush();
    c.push(0x20, L_P, 0x0b);
    const body = [1, 2, 0x7f]; // locals: 2 x i32 (v, q)
    bodies[idx] = Uint8Array.from([...body, ...c]);
    return idx;
  }

  const root = fn(0, len);
  // run(inLen i32, max i64) -> outLen
  const main = [0];
  main.push(0x20, 0, 0x24, G_INLEN, 0x20, 1, 0x24, G_MAX, 0x42, 0, 0x24, G_N, 0x41, 0, 0x24, G_INPOS, 0x41, 0, 0x24, G_OUTLEN);
  main.push(0x41, 0, 0x10); uleb(root, main); main.push(0x1a);
  main.push(0x23, G_N, 0x23, G_MAX, 0x56, 0x04, 0x40, 0x00, 0x0b);
  main.push(0x23, G_OUTLEN, 0x0b);
  bodies[0] = Uint8Array.from(main);

  const out = new Bytes();
  const section = (id, content) => { const h = [id]; uleb(content.length, h); out.push(...h); out.append(content); };
  const vec = (items) => { const h = []; uleb(items.length, h); return [...h, ...items.flat()]; };
  const str = (s) => [s.length, ...[...s].map((ch) => ch.charCodeAt(0))];

  out.push(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
  section(1, Uint8Array.from(vec([[0x60, 1, 0x7f, 1, 0x7f], [0x60, 2, 0x7f, 0x7e, 1, 0x7f]]))); // types
  { const f = [1]; for (let k = 1; k < bodies.length; k++) f.push(0); const h = []; uleb(bodies.length, h); section(3, Uint8Array.from([...h, ...f])); } // functions
  section(5, Uint8Array.from([1, 0x00, 3])); // memory: 3 pages
  section(6, Uint8Array.from(vec([[0x7e, 1, 0x42, 0, 0x0b], [0x7e, 1, 0x42, 0, 0x0b], [0x7f, 1, 0x41, 0, 0x0b], [0x7f, 1, 0x41, 0, 0x0b], [0x7f, 1, 0x41, 0, 0x0b]])));
  section(7, Uint8Array.from(vec([[...str('run'), 0x00, 0], [...str('mem'), 0x02, 0], [...str('n'), 0x03, G_N]])));
  { // code
    const code = new Bytes();
    const h = []; uleb(bodies.length, h); code.push(...h);
    for (const body of bodies) { const s = []; uleb(body.length, s); code.push(...s); code.append(body); }
    section(10, code.bytes());
  }
  return out.bytes().slice();
}

/**
 * Compile Brainfuck to a run(input, limits) function with the same results as bf.js run().
 * Falls back to the interpreter if WebAssembly is unavailable or the module fails to build.
 */
export function compileFast(program) {
  const prog = typeof program === 'string' ? compile(program) : program;
  const slow = (input = '', limits = {}) => run(prog, input, limits);
  let inst;
  try { inst = new WebAssembly.Instance(new WebAssembly.Module(toWasm(prog)), {}); } catch { return Object.assign(slow, { engine: 'interpreter' }); }
  const { run: wrun, mem, n } = inst.exports;
  const fast = (input = '', limits = {}) => {
    const { tapeSize, maxInstructions } = { ...DEFAULT_LIMITS, ...limits };
    const inBytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
    if (tapeSize !== TAPE || inBytes.length > 65536) return slow(input, limits);
    const m = new Uint8Array(mem.buffer);
    m.fill(0, 0, TAPE);
    m.set(inBytes, IN_BASE);
    let outLen;
    try { outLen = wrun(inBytes.length, BigInt(maxInstructions)); } catch (e) {
      if (e instanceof WebAssembly.RuntimeError || e instanceof RangeError) { fast.fallbacks++; return slow(input, limits); } // exact error from the reference
      throw e;
    }
    let output = '';
    for (let j = 0; j < outLen; j += 4096) output += String.fromCharCode(...m.subarray(OUT_BASE + j, OUT_BASE + Math.min(outLen, j + 4096)));
    return { ok: true, output, instructions: Number(n.value) };
  };
  return Object.assign(fast, { engine: 'wasm', fallbacks: 0 });
}

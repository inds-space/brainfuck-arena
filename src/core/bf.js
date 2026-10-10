// Brainfuck interpreter: 8-bit wrapping cells, 65,536-cell tape, 0 on EOF,
// hard instruction limit. Isomorphic (Node + browser/worker).
//
// The source is compiled to a compact op list (run-length folding, clear loops,
// scan loops, multiply-move loops) for speed, but every op carries the exact
// number of raw Brainfuck instructions it stands for, so the reported
// instruction count is identical to a naive one-char-at-a-time interpreter:
//   - every executed command counts 1
//   - `[` counts once per entry, `]` counts once per iteration (it jumps back
//     to the instruction after its matching `[`).

export const DEFAULT_LIMITS = Object.freeze({ tapeSize: 65536, maxInstructions: 100_000_000 });

const MAX_OUTPUT = 65536;
const ADD = 0, MOVE = 1, OUT = 2, IN = 3, OPEN = 4, CLOSE = 5, CLEAR = 6, SCAN = 7, MUL = 8;

export class BFError extends Error {
  constructor(code, message, stats) { super(message); this.code = code; this.stats = stats; }
}

/** Compile source into an op program. Throws BFError('SYNTAX') on unbalanced brackets. */
export function compile(src) {
  const code = [];
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    // + , - . < > [ ]
    if (c === 43 || c === 44 || c === 45 || c === 46 || c === 60 || c === 62 || c === 91 || c === 93) code.push(c);
  }
  // Bracket check first (with positions in filtered code).
  let depth = 0;
  for (const c of code) {
    if (c === 91) depth++;
    else if (c === 93 && --depth < 0) throw new BFError('SYNTAX', 'Unmatched ]');
  }
  if (depth !== 0) throw new BFError('SYNTAX', 'Unmatched [');

  const op = [], a = [], b = [], cost = [], muls = [];
  const emit = (o, x = 0, y = 0, k = 0) => { op.push(o); a.push(x); b.push(y); cost.push(k); return op.length - 1; };
  const stack = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === 43 || c === 45) {
      let n = 0, k = 0;
      while (i < code.length && (code[i] === 43 || code[i] === 45)) { n += code[i] === 43 ? 1 : -1; k++; i++; }
      emit(ADD, n & 255, 0, k);
    } else if (c === 60 || c === 62) {
      let n = 0, k = 0;
      while (i < code.length && (code[i] === 60 || code[i] === 62)) { n += code[i] === 62 ? 1 : -1; k++; i++; }
      emit(MOVE, n, 0, k);
    } else if (c === 46) { emit(OUT, 0, 0, 1); i++; }
    else if (c === 44) { emit(IN, 0, 0, 1); i++; }
    else if (c === 91) {
      const pat = loopPattern(code, i);
      if (pat) {
        if (pat.kind === 'clear') emit(CLEAR, pat.plus ? 1 : 0, 0, 0);
        else if (pat.kind === 'scan') emit(SCAN, pat.stride, 0, 0);
        else { muls.push(pat.pairs); emit(MUL, muls.length - 1, pat.bodyLen, 0); }
        i = pat.end + 1;
      } else { stack.push(emit(OPEN, 0, 0, 1)); i++; }
    } else { // ]
      const o = stack.pop();
      const cl = emit(CLOSE, o + 1, 0, 1);
      a[o] = cl + 1; // jump target when cell is zero
      i++;
    }
  }
  return { op: Int32Array.from(op), a: Int32Array.from(a), b: Int32Array.from(b), cost: Int32Array.from(cost), muls, rawLength: code.length };
}

// Recognise innermost simple loops: [-] / [+], [>>>] / [<<], and balanced
// multiply-moves like [->+>++<<] (counter decremented exactly once).
function loopPattern(code, start) {
  let j = start + 1;
  while (j < code.length && code[j] !== 91 && code[j] !== 93) {
    if (code[j] === 44 || code[j] === 46) return null;
    j++;
  }
  if (code[j] !== 93) return null;
  const body = code.slice(start + 1, j);
  if (body.length === 1 && (body[0] === 45 || body[0] === 43)) return { kind: 'clear', plus: body[0] === 43, end: j };
  if (body.length > 0 && body.every((c) => c === 62)) return { kind: 'scan', stride: body.length, end: j };
  if (body.length > 0 && body.every((c) => c === 60)) return { kind: 'scan', stride: -body.length, end: j };
  let p = 0; const delta = new Map();
  for (const c of body) {
    if (c === 62) p++; else if (c === 60) p--;
    else delta.set(p, (delta.get(p) || 0) + (c === 43 ? 1 : -1));
  }
  if (p !== 0 || delta.get(0) !== -1) return null;
  const pairs = [];
  for (const [off, k] of delta) if (off !== 0 && (k & 255) !== 0) pairs.push(off, k & 255);
  return { kind: 'mul', pairs, bodyLen: body.length, end: j };
}

/**
 * Run a compiled (or source) program.
 * @returns {{output:string, instructions:number, maxPointer:number, ok:true}}
 * @throws BFError with code LIMIT | TAPE | SYNTAX
 */
export function run(program, input = '', limits = {}) {
  const prog = typeof program === 'string' ? compile(program) : program;
  const { tapeSize, maxInstructions } = { ...DEFAULT_LIMITS, ...limits };
  const { op, a, b, cost, muls } = prog;
  const tape = new Uint8Array(tapeSize);
  const inBytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let inPos = 0;
  const out = [];
  let p = 0, pc = 0, n = 0, maxP = 0;
  const len = op.length;
  const fail = (code, msg) => { throw new BFError(code, msg, { instructions: n, maxPointer: maxP }); };

  while (pc < len) {
    switch (op[pc]) {
      case ADD: tape[p] = (tape[p] + a[pc]) & 255; n += cost[pc]; break;
      case MOVE:
        p += a[pc]; n += cost[pc];
        if (p < 0 || p >= tapeSize) fail('TAPE', `Pointer moved off the tape (${p})`);
        if (p > maxP) maxP = p;
        break;
      case OUT:
        if (out.length >= MAX_OUTPUT) fail('OUTPUT', `Output exceeded ${MAX_OUTPUT} bytes`);
        out.push(tape[p]); n++; break;
      case IN: tape[p] = inPos < inBytes.length ? inBytes[inPos++] : 0; n++; break;
      case OPEN:
        n++;
        if (tape[p] === 0) { pc = a[pc]; continue; }
        break;
      case CLOSE:
        n++;
        if (tape[p] !== 0) {
          pc = a[pc];
          if (n > maxInstructions) fail('LIMIT', `Instruction limit of ${maxInstructions.toLocaleString('en-US')} exceeded`);
          continue;
        }
        break;
      case CLEAR: { // [-] runs v iterations, [+] runs 256-v
        const v = tape[p];
        n += 1 + 2 * (v === 0 ? 0 : a[pc] ? 256 - v : v); tape[p] = 0; break;
      }
      case SCAN: {
        const s = a[pc]; let k = 0;
        while (tape[p] !== 0) { p += s; k++; if (p < 0 || p >= tapeSize) fail('TAPE', `Pointer moved off the tape (${p})`); }
        if (p > maxP) maxP = p;
        n += 1 + k * (Math.abs(s) + 1); break;
      }
      case MUL: {
        const v = tape[p];
        n += 1;
        if (v !== 0) {
          const pairs = muls[a[pc]];
          for (let j = 0; j < pairs.length; j += 2) {
            const q = p + pairs[j];
            if (q < 0 || q >= tapeSize) fail('TAPE', `Pointer moved off the tape (${q})`);
            if (q > maxP) maxP = q;
            tape[q] = (tape[q] + v * pairs[j + 1]) & 255;
          }
          tape[p] = 0;
          n += v * (b[pc] + 1);
        }
        break;
      }
    }
    pc++;
    if (n > maxInstructions) fail('LIMIT', `Instruction limit of ${maxInstructions.toLocaleString('en-US')} exceeded`);
  }
  let output = '';
  for (let j = 0; j < out.length; j += 4096) output += String.fromCharCode(...out.slice(j, j + 4096));
  return { ok: true, output, instructions: n, maxPointer: maxP };
}

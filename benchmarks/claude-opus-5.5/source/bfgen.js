// Tiny Brainfuck code generator with static pointer tracking.
//
// Every helper emits plain Brainfuck. The generator always knows where the
// tape pointer is (`this.p`), so `go(addr)` emits the exact run of `<`/`>`.
// Loop bodies must return the pointer to where they started, which `loop()`
// enforces. The only places where the pointer moves dynamically are explicit
// sweeps/scans whose exit position is still statically known (see `sweep`).

export class Gen {
  constructor() { this.parts = []; this.p = 0; }

  raw(s) { this.parts.push(s); }
  code() { return this.parts.join(''); }

  go(a) {
    const d = a - this.p;
    if (d) this.raw(d > 0 ? '>'.repeat(d) : '<'.repeat(-d));
    this.p = a;
  }
  add(a, n) {
    n = ((n % 256) + 256) % 256;
    if (!n) return;
    this.go(a);
    this.raw(n <= 128 ? '+'.repeat(n) : '-'.repeat(256 - n));
  }
  clr(a) { this.go(a); this.raw('[-]'); }
  inp(a) { this.go(a); this.raw(','); }
  out(a) { this.go(a); this.raw('.'); }

  /** while (cell a != 0) body — body must be pointer-neutral (enforced). */
  loop(a, body) { this.go(a); this.raw('['); body(); this.go(a); this.raw(']'); }

  /** dst_i += f_i * src for each [dst, f]; src becomes 0. */
  mov(src, dsts) {
    this.loop(src, () => { this.add(src, -1); for (const [d, f] of dsts) this.add(d, f); });
  }
  /** dst += f * src, src preserved (tmp must be 0, stays 0). */
  copy(src, dst, tmp, f = 1) { this.mov(src, [[dst, f], [tmp, 1]]); this.mov(tmp, [[src, 1]]); }

  /** if (c) body — c is cleared. */
  ifD(c, body) { this.loop(c, () => { this.clr(c); body(); }); }

  /**
   * Non-destructive if/else on x, O(1) regardless of x. Needs two zero cells at
   * x+d and x+2d. thenB may modify x; neither body may touch those two cells.
   */
  ifElseKeep(x, d, thenB, elseB = () => {}) {
    const t0 = x + d, t1 = x + 2 * d;
    this.add(t0, 1);
    this.go(x); this.raw('['); thenB(); this.go(t0); this.raw('-]');
    // path "then" now sits on t0, path "else" still on x
    this.p = t0; this.go(t1); this.raw('[');
    // only the else path enters here, standing on t0
    this.p = t0; this.go(x); elseB(); this.go(t0); this.raw('-'); this.go(t1); this.raw(']');
    this.p = t1;
  }

  /** f += (x == k); x destroyed. */
  eqConst(x, k, f) { this.add(f, 1); this.add(x, -k); this.ifD(x, () => this.add(f, -1)); }

  /** f += (x >= k); x destroyed. Needs x+1, x+2 zero. */
  geConst(x, k, f) {
    for (let j = 1; j < k; j++) this.ifElseKeep(x, 1, () => this.add(x, -1));
    this.ifD(x, () => this.add(f, 1));
  }

  /** f += (a > b); a and b destroyed. Needs b+1, b+2 zero. O(min(a,b)). */
  gt(a, b, f) {
    this.loop(a, () => {
      this.add(a, -1);
      this.ifElseKeep(b, 1, () => this.add(b, -1), () => { this.add(f, 1); this.clr(a); });
    });
    this.clr(b);
  }

  /** f += (a == b); a and b destroyed. */
  eqVar(a, b, f) { this.mov(b, [[a, -1]]); this.eqConst(a, 0, f); }

  /**
   * Sweep over consecutive blocks of size B while the cell at offset `rail`
   * is non-zero. `body(base)` addresses the current block as `base + field`
   * and may touch neighbouring blocks. Each iteration advances one block.
   * After the sweep the pointer is on `endBase + rail` (first block whose rail is 0).
   */
  sweep(startBase, B, rail, endBase, body) {
    this.go(startBase + rail); this.raw('[');
    body(startBase);
    this.go(startBase + B + rail);
    this.p = startBase + rail; this.raw(']');
    this.p = endBase + rail;
  }
}

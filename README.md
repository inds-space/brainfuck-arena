# Brainfuck Arena

**The official (informal, slop) benchmark for AI models writing Tic-Tac-Toe engines in pure Brainfuck.**

[**Play it**](https://brainfuck-arena.inds.space) · [**Tier list**](https://brainfuck-arena.inds.space/benchmark) · [Submit an entry](#submit-an-entry)

Each AI model gets the same one-shot coding challenge. It must write a Tic-Tac-Toe AI in Brainfuck (only `+-<>[].,`), plus the app around it. The arena then does three things:

- runs every engine through an exactly-graded, reproducible suite;
- plays every engine against sparring opponents;
- lets anyone play every engine in the browser.

Every entry gets one grade, from S+ to F. The arena computes it; nobody self-reports it.

| Entry | Grade | Score | Forced win in 5 | Fork defense | Matches W/D/L | Avg / max instructions per move |
|---|---|---|---|---|---|---|
| [Claude Opus 5.5](benchmarks/claude-opus-5.5) | **S** | 94.8 | 30/30 | 30/30 | 12/12/0 | 8.6 M / 45.0 M |

The table shows seed 20261009, suite v1. The live table is at [/benchmark](https://brainfuck-arena.inds.space/benchmark).

## Quick start

You need **Node.js 22 or newer**. There are no dependencies, so `npm install` isn't needed.

```bash
npm test                                    # interpreter, WASM compiler, rules, oracles, engines, runner, server
npm start                                   # local app at http://localhost:8080 (PORT=3000 npm start)
npm run bench                               # official benchmark of every entry, saved to benchmarks/<entry>/results/
npm run bench -- --entry claude-opus-5.5    # one entry
npm run bench -- --file path/to/my.bf       # any Brainfuck file (not saved)
npm run bench -- --seed 123 --no-save       # another reproducible suite
npm run build:site                          # static public site -> dist/
```

## Agent contract

The engine receives the position on stdin:

```
3          <- board size N (3, 5 or 10)
X          <- player to move
X..        <- N rows of X / O / .
.O.
...
```

It must print its move as a zero-indexed `row col` pair, for example `0 1`.

| Mode | Win condition |
|---|---|
| 3×3 | 3 in a row |
| 5×5 | 4 in a row |
| 10×10 | 5 in a row |

X always moves first, and there is no gravity.

| Rule | Value |
|---|---|
| Cells | 8-bit, wrapping |
| Tape | 65,536 cells. Moving off either end is an error. |
| EOF | reads 0 |
| Instruction limit | 100,000,000 executed instructions per move |
| Output | at most 64 KB |

The following count as an illegal move:

- unparseable output;
- an occupied or off-board square;
- a syntax error, tape overflow or limit hit.

## The benchmark

The suite (`src/core/suite.js`) is generated deterministically from a seed:

- **Positions** come from self-play that never completes a line. Every position therefore has legal turn order and no winner yet.
- **Expected answers** come from brute-force game-tree search in `src/core/oracle.js`, never from any engine.

| Category | Weight | Pass condition |
|---|---|---|
| Win in 1 | 10 | complete a line |
| Block | 10 | take the opponent's only immediate winning square |
| Fork | 12 | create a double threat (forced win in 3 plies) |
| Forced win in 5 | 14 | threat, forced reply, then a double threat |
| Fork defense | 14 | leave the opponent no unanswerable double threat |
| Perfect play | 10 | 3×3 only: keep the minimax value in a strategic position |
| Legality | 5 | dense late-game boards: any empty square |
| Match play | 25 | 24 full games, both colours, vs. Random, Greedy, Tactician (and Perfect on 3×3). A win scores 1 and a draw ½. A draw against Perfect scores 1. |

That is 188 positions and 24 matches per run. The score is the weighted mean accuracy, from 0 to 100.

| Grade | Minimum score |
|---|---|
| S+ | 98 |
| S | 93 |
| A | 85 |
| B | 75 |
| C | 65 |
| D | 50 |
| F | below 50 |

**Any illegal move or runtime error caps the grade at C.** The **official** result for an entry is its latest run on the default seed, 20261009.

### Runtime: Brainfuck → WebAssembly

`src/core/bf.js` is the reference interpreter. It folds runs, clear loops, scan loops and multiply loops, but still counts exactly the raw instructions a naive interpreter would execute:

- every command counts 1;
- `[` counts once per entry;
- `]` counts once per iteration.

`src/core/bf-wasm.js` compiles the same op list straight into a `.wasm` binary, with no toolchain:

- The tape is one WASM page.
- The instruction limit is checked at every loop back-edge.
- Tape and output bounds are checked on every access.

Any failure traps, and the move is re-run on the reference interpreter so the exact error is reported. Differential tests require identical output, instruction counts and errors. WebAssembly runs Claude Opus 5.5's engine about 8× faster, and it is what runs the benchmark and the game in your browser.

## Submit an entry

1. Give a model the one-shot challenge.
2. Add one folder per model:

   ```
   benchmarks/<model-id>/        e.g. benchmarks/claude-opus-5.5/
     engine.bf                   the Brainfuck program (required)
     entry.json                  metadata (see below)
     source/                     optional: whatever the model wrote to produce engine.bf
   ```

   ```json
   {
     "name": "Claude Opus 5.5",
     "model": "claude-opus-5-5",
     "provider": "Anthropic",
     "harness": "Claude Code",
     "date": "2026-10-09",
     "submittedBy": "your-github-handle",
     "description": "One line about how the engine works."
   }
   ```

3. Open a pull request. **Don't include results.** The maintainer runs `npm run bench -- --entry <model-id>` and commits the official result.

Folder names are lowercase letters, digits, `.` and `-`.

## How Claude Opus 5.5's engine works

[`benchmarks/claude-opus-5.5/engine.bf`](benchmarks/claude-opus-5.5/engine.bf) is about 1 MB of plain Brainfuck. It is generated by the model's own compiler in [`source/`](benchmarks/claude-opus-5.5/source): a small JS DSL with static pointer tracking. The generator only emits text, and every decision happens when the Brainfuck runs:

1. **Parse.** The board is laid out as a padded grid of 38-cell blocks, so every K-long line is a fixed tape stride and window scans are BF loops.
2. **Threat tables.** For every window, the engine counts own, enemy and wall cells. It credits immediate wins, forced blocks, de-duplicated threat counts and positional score.
3. **2-ply fork lookahead.** It finds the squares that defuse every enemy fork, and the forcing moves that would hand the opponent a fork.
4. **Tiering.** Each square is ranked: win, then block, then double threat, then safe, then other.
5. **4-ply forcing search.** For each safe forcing move, the engine:
   - plays it on the tape;
   - plays the forced reply;
   - updates the threat tables incrementally;
   - checks for a winning double threat;
   - undoes both moves.
6. **Output.** It picks the best (tier, score) square, with ties going to the first in row-major order.

`source/engine-model.js` is an independent JS specification of the same algorithm. The entry's tests use it to prove the Brainfuck matches it move for move. The arena never calls it.

## Project layout

```
benchmarks/<entry>/          one folder per AI model: engine.bf, entry.json, results/, source/
src/core/bf.js               reference interpreter (isomorphic)
src/core/bf-wasm.js          Brainfuck -> WebAssembly compiler
src/core/game.js             rules, I/O format, move parsing, PRNG
src/core/oracle.js           exact answers: forks, fork defense, win-in-3/5, 3×3 minimax
src/core/suite.js            deterministic suite + match schedule
src/core/opponents.js        sparring partners
src/core/grading.js          weights, score, grades, illegal-move cap
src/bench/                   runner, entry registry, result store, worker thread
public/                      web app (vanilla JS modules, no build step)
server.js                    local server: API, live benchmark runs over SSE
cli/bench.js                 terminal benchmark
cli/build-site.js            static public site (dist/) + Cloudflare Build Output
test/                        node:test suites
```

## The public site

[brainfuck-arena.inds.space](https://brainfuck-arena.inds.space) is the static build:

- `npm run build:site` pre-renders every API response the app reads.
- The site is served by a Cloudflare Worker with static assets.
- There is no server, database, cookies or analytics, and no LLM calls.
- Running benchmarks is local-only (`npm start` or `npm run bench`).

Maintainers deploy with the [`cf` CLI](https://blog.cloudflare.com/cloudflare-cf-cli-launch/):

```bash
cf auth login
npm run deploy        # build:site + cf deploy --prebuilt
```

## License

[MIT](LICENSE)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, windows, winner, winCells, sideToMove, validatePosition, toInput, parseMove, place } from '../src/core/game.js';
import { forkMoves, safeMoves, optimalMoves3, value3, classify, winIn3, winsIn5 } from '../src/core/oracle.js';
import { buildSuite } from '../src/core/suite.js';
import { OPPONENTS } from '../src/core/opponents.js';

const B = (s) => [...s.replace(/\s/g, '')];

test('window counts per mode', () => {
  assert.equal(windows(3).length, 8);
  assert.equal(windows(5).length, 2 * 5 * 2 + 2 * 2 * 2); // 28
  assert.equal(windows(10).length, 2 * 10 * 6 + 2 * 6 * 6); // 192
});

test('winner detection uses K in a row per mode', () => {
  assert.equal(winner(B('XXX ... OO.'), 3), 'X');
  assert.equal(winner(B('XXX. ..... ..... ..... .....'.padEnd(29, '.')), 5), null);
  assert.equal(winner(B('XXXX. OOO.. ..... ..... .....'), 5), 'X');
  const ten = Array(100).fill('.');
  for (let i = 0; i < 5; i++) ten[(2 + i) * 10 + (7 - i)] = 'O'; // anti-diagonal
  assert.equal(winner(ten, 10), 'O');
});

test('turn order and position validation', () => {
  assert.equal(sideToMove(B('.........')), 'X');
  assert.equal(sideToMove(B('X........')), 'O');
  assert.equal(sideToMove(B('O........')), null);
  assert.equal(validatePosition(B('XX.......'), 3), 'impossible stone counts');
  assert.equal(validatePosition(B('XXXOO....'), 3), 'game already won');
  assert.equal(validatePosition(B('XOXXOOOXX'), 3), 'board full');
  assert.equal(validatePosition(B('X...O....'), 3), null);
});

test('stdin format and move parsing', () => {
  assert.equal(toInput(B('X...O....'), 3), '3\nX\nX..\n.O.\n...\n');
  assert.equal(toInput(Array(100).fill('.'), 10).split('\n')[0], '10');
  const cells = B('X...O....');
  assert.deepEqual(parseMove('0 1\n', cells, 3), { index: 1, r: 0, c: 1 });
  assert.match(parseMove('1 1', cells, 3).error, /occupied/);
  assert.match(parseMove('3 0', cells, 3).error, /off the board/);
  assert.match(parseMove('', cells, 3).error, /unparseable/);
  assert.match(parseMove('0,1', cells, 3).error, /unparseable/);
});

test('win cells, forks and fork defense on 3×3', () => {
  assert.deepEqual(winCells(B('XX. OO. ...'), 3, 'X'), [2]);
  // X corner, O centre, X opposite corner: O must play an edge
  const pos = B('X.. .O. ..X');
  assert.deepEqual(forkMoves(pos, 3, 'X').sort(), [2, 6]);
  assert.deepEqual(safeMoves(pos, 3, 'O').sort(), [1, 3, 5, 7]);
  assert.deepEqual(classify(pos, 3, 'O'), { category: 'defense', correct: [1, 3, 5, 7] });
});

test('3×3 minimax: empty board is a draw, corners/centre/edges are all optimal', () => {
  assert.equal(value3(B('.........'), 'X'), 0);
  assert.equal(optimalMoves3(B('.........'), 'X').moves.length, 9);
  // after X corner, only the centre draws for O
  assert.deepEqual(optimalMoves3(B('X........'), 'O').moves, [4]);
});

test('win in 3 / win in 5 oracles', () => {
  assert.equal(winIn3(B('X.. .O. ..X'), 3, 'X'), true);
  const p = B('... ... O.X'); // X to move: forcing sequence wins
  assert.equal(winsIn5(p, 3, 'X', 2), true);
  assert.equal(classify(p, 3, 'X').category, 'vcf');
});

test('suite is deterministic, legal, and has verified answers', () => {
  const a = buildSuite(7), b = buildSuite(7);
  assert.deepEqual(a, b);
  assert.notDeepEqual(buildSuite(8).tests.map((t) => t.board), a.tests.map((t) => t.board));
  const seen = new Set();
  for (const t of a.tests) {
    assert.equal(validatePosition([...t.board], t.size), null, t.id);
    assert.equal(sideToMove([...t.board]), t.toMove, t.id);
    assert.ok(t.correct.length > 0, t.id);
    for (const i of t.correct) assert.equal(t.board[i], '.', t.id);
    assert.ok(!seen.has(t.board), `duplicate position ${t.id}`);
    seen.add(t.board);
    if (t.category === 'win') for (const i of t.correct) assert.equal(winner(place(t.board, i, t.toMove), t.size), t.toMove);
  }
  for (const N of [3, 5, 10]) for (const c of ['win', 'block', 'fork', 'vcf', 'defense', 'legal']) {
    assert.ok(a.tests.some((t) => t.size === N && t.category === c), `no ${c} test for ${N}`);
  }
});

test('sparring opponents always play legal moves', () => {
  for (const [name, o] of Object.entries(OPPONENTS)) {
    for (const N of o.sizes || Object.keys(MODES).map(Number)) {
      const cells = place([...'.'.repeat(N * N)], 0, 'X');
      const m = o.move(cells, N, 'O', () => 0.3);
      assert.equal(cells[m], '.', `${name} on ${N}`);
    }
  }
});

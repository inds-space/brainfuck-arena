// Play against an agent, or set up any position and ask what it would do.
// Agent moves come from its Brainfuck, compiled to WebAssembly in a Web Worker.
import { h, put, api, fmt, boardEl, Engine, toast } from './ui.js';
import { toInput, parseMove, winningLine, sideToMove, validatePosition } from '/core/game.js';
import { classify, optimalMoves3 } from '/core/oracle.js';

const engine = new Engine();

export async function playView(view, q, meta) {
  const agents = await api('/api/agents');
  const state = {
    mode: q.get('mode') === 'lab' ? 'lab' : 'play',
    agent: agents.some((a) => a.id === q.get('agent')) ? q.get('agent') : agents[0]?.id,
    size: [3, 5, 10].includes(+q.get('size')) ? +q.get('size') : 3,
    human: 'X', cells: null, busy: false, over: null, last: null, log: [], brush: 'X', answer: null, oracle: null,
  };
  const qb = q.get('board');
  state.cells = qb && qb.length === state.size * state.size && /^[XO.]+$/.test(qb) ? [...qb] : Array(state.size * state.size).fill('.');

  const agentSel = h('select', { 'aria-label': 'Agent', onchange: () => { state.agent = agentSel.value; reset(); } }, agents.map((a) => h('option', { value: a.id, selected: a.id === state.agent }, a.name)));
  const sizeSel = h('select', { 'aria-label': 'Board size', onchange: () => { state.size = +sizeSel.value; reset(true); } }, Object.entries(meta.modes).map(([n, m]) => h('option', { value: n, selected: +n === state.size }, m.label)));
  const sideSel = h('select', { 'aria-label': 'Your side', onchange: () => { state.human = sideSel.value; reset(); } }, h('option', { value: 'X' }, 'You play X (first)'), h('option', { value: 'O' }, 'You play O'));
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const left = h('div', { class: 'card' });
  const right = h('div', { class: 'stack' });

  for (const [k, label] of [['play', 'Play vs agent'], ['lab', 'Position lab']]) {
    tabs.append(h('button', { class: state.mode === k ? 'on' : '', role: 'tab', onclick: () => { state.mode = k; for (const b of tabs.children) b.classList.toggle('on', b.textContent === label); reset(true); } }, label));
  }

  function reset(clearBoard = true) {
    if (clearBoard) state.cells = Array(state.size * state.size).fill('.');
    Object.assign(state, { over: null, last: null, log: [], answer: null, oracle: null, busy: false });
    render();
    if (state.mode === 'play' && state.human === 'O') agentTurn();
  }

  async function ask(cells, p) {
    const input = toInput(cells, state.size, p);
    const res = await engine.move(state.agent, input);
    const mv = res.ok ? parseMove(res.output, cells, state.size) : { error: res.error };
    return { ...res, input, move: mv };
  }

  async function agentTurn() {
    state.busy = true; render();
    try {
      const p = sideToMove(state.cells);
      const r = await ask(state.cells, p);
      if (r.move.error) {
        state.over = { text: `Agent forfeits: ${r.move.error}`, kind: 'bad' };
        state.log.unshift({ who: 'agent', text: `illegal: ${r.move.error}`, r });
      } else {
        state.cells[r.move.index] = p; state.last = r.move.index;
        state.log.unshift({ who: 'agent', text: `${p} → ${r.move.r} ${r.move.c}`, r });
        checkOver();
      }
    } catch (e) { toast(e.message, 'error'); }
    state.busy = false; render();
  }

  function checkOver() {
    const line = winningLine(state.cells, state.size);
    if (line) {
      const w = state.cells[line[0]];
      state.over = { text: w === state.human ? 'You win!' : `${agents.find((a) => a.id === state.agent).name} wins.`, kind: w === state.human ? 'good' : 'bad', line };
    } else if (!state.cells.includes('.')) state.over = { text: 'Draw.', kind: '' };
  }

  function onPlayClick(i) {
    if (state.busy || state.over || state.cells[i] !== '.' || sideToMove(state.cells) !== state.human) return;
    state.cells[i] = state.human; state.last = i;
    state.log.unshift({ who: 'you', text: `${state.human} → ${Math.floor(i / state.size)} ${i % state.size}` });
    checkOver();
    render();
    if (!state.over) agentTurn();
  }

  function onLabClick(i) {
    if (state.busy) return;
    state.cells[i] = state.cells[i] === state.brush ? '.' : state.brush;
    state.answer = null; state.oracle = null;
    render();
  }

  async function labAsk() {
    const err = validatePosition(state.cells, state.size);
    if (err) { toast(`Invalid position: ${err}`, 'error'); return; }
    state.busy = true; render();
    const p = sideToMove(state.cells);
    try { state.answer = await ask(state.cells, p); } catch (e) { toast(e.message, 'error'); }
    // reference analysis (exhaustive search, runs in this tab)
    const c = classify(state.cells, state.size, p);
    state.oracle = c ? { label: meta.categories[c.category].label, correct: c.correct } : state.size === 3 ? { label: 'Perfect play (minimax)', correct: optimalMoves3(state.cells, p).moves } : { label: 'No forced tactic — any sound move', correct: [] };
    state.busy = false; render();
  }

  function render() {
    const N = state.size;
    const play = state.mode === 'play';
    const toMove = sideToMove(state.cells);
    const invalid = !play && validatePosition(state.cells, N);
    let status;
    if (play) status = state.over ? h('span', { class: `tag ${state.over.kind}` }, state.over.text) : state.busy ? h('span', { class: 'row muted' }, h('div', { class: 'spinner' }), 'Agent is thinking (running Brainfuck)…') : h('span', {}, 'Your move', h('span', { class: 'muted' }, ` (${state.human})`));
    else status = invalid ? h('span', { class: 'tag warn' }, invalid) : h('span', {}, `${toMove} to move`);

    const ans = state.answer;
    const board = boardEl(state.cells, N, {
      onClick: play ? onPlayClick : onLabClick,
      editable: !play,
      last: play ? state.last : null,
      win: state.over?.line,
      pick: !play && ans && !ans.move.error ? ans.move.index : null,
      pass: !play && ans && state.oracle && state.oracle.correct.length ? state.oracle.correct.includes(ans.move.index) : null,
      correct: !play ? state.oracle?.correct : null,
      ghost: !play && ans && !ans.move.error ? { index: ans.move.index, p: toMove } : null,
    });

    put(left, 
      h('div', { class: 'card-head' }, h('div', {}, status), play
        ? h('button', { class: 'btn sm', onclick: () => reset() }, 'New game')
        : h('div', { class: 'row', style: { gap: '6px' } }, ['X', 'O', '.'].map((b) => h('button', { class: `chip${state.brush === b ? ' on' : ''}`, onclick: () => { state.brush = b; render(); } }, b === '.' ? 'Erase' : `Place ${b}`)), h('button', { class: 'btn sm', onclick: () => reset() }, 'Clear'))),
      h('div', { class: 'board-wrap' }, board),
      !play ? h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn primary', disabled: state.busy || !!invalid, onclick: labAsk }, state.busy ? 'Running…' : 'Ask agent for a move'), h('span', { class: 'muted small' }, 'Click squares to edit. Side to move follows from stone counts (X first).')) : null);

    sideSel.hidden = !play;
    const last = state.log.find((e) => e.r);
    const stats = (r) => h('dl', { class: 'kv' },
      h('dt', {}, 'Instructions'), h('dd', {}, `${fmt.int(r.instructions)} / ${fmt.int(meta.limits.maxInstructions)}`),
      h('dt', {}, 'Time (browser)'), h('dd', {}, `${fmt.ms(r.timeMs)}${r.runtime ? ` · ${r.runtime === 'wasm' ? 'WebAssembly' : 'interpreter'}` : ''}`),
      h('dt', {}, 'stdout'), h('dd', { class: 'mono' }, JSON.stringify(r.output ?? '')),
      r.error ? [h('dt', {}, 'Error'), h('dd', { style: { color: 'var(--bad)' } }, r.error)] : null);

    if (play) {
      put(right, 
        h('div', { class: 'card' }, h('h2', {}, 'Last agent move'), last ? stats(last.r) : h('p', { class: 'muted' }, 'The agent has not moved yet.')),
        h('div', { class: 'card' }, h('h2', {}, 'Move log'), state.log.length ? h('div', { class: 'log' }, state.log.map((e, k) => h('div', { class: 'entry' }, h('span', {}, h('b', {}, e.who === 'you' ? 'You' : 'Agent'), ` ${e.text}`), e.r ? h('span', { class: 'muted mono' }, fmt.compact(e.r.instructions)) : null))) : h('p', { class: 'muted' }, 'No moves yet.')));
    } else {
      put(right, 
        h('div', { class: 'card' }, h('h2', {}, 'Agent answer'), ans ? [ans.move.error ? h('div', { class: 'notice error', style: { marginBottom: '10px' } }, ans.move.error) : h('p', {}, 'Plays ', h('b', { class: 'mono' }, `${ans.move.r} ${ans.move.c}`)), stats(ans)] : h('p', { class: 'muted' }, 'Set up a position and ask the agent.')),
        h('div', { class: 'card' }, h('h2', {}, 'Reference analysis'), state.oracle ? [h('p', {}, h('b', {}, state.oracle.label)), h('p', { class: 'muted small' }, state.oracle.correct.length ? `Accepted squares (green dots): ${state.oracle.correct.map((i) => `${Math.floor(i / N)} ${i % N}`).join(', ')}` : 'No unique tactical answer in this position.')] : h('p', { class: 'muted' }, 'Exhaustive-search verdict appears here after asking.')),
        h('div', { class: 'card' }, h('h2', {}, 'stdin'), h('pre', { class: 'io' }, toInput(state.cells, N, toMove || 'X'))));
    }
  }

  put(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Play & Lab'), h('p', {}, 'Every move the AI makes is computed by its Brainfuck code, compiled to WebAssembly and run in your browser.')), h('div', { class: 'row' }, agentSel, sizeSel, sideSel)),
    tabs, h('div', { class: 'split' }, left, right));
  sideSel.value = state.human;
  render();
}


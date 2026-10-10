import { h, put, icon, api, apiUrl, toast, fmt, gradeEl, bar, meter, loading, errorBox, boardEl } from './ui.js';
import { playView } from './play.js';
import { STATIC, REPO } from './config.js';

const view = document.getElementById('view');
let meta = null;
let cleanup = null; // per-view teardown (event sources, timers)

// [href, label, icon, localOnly]. Absolute hrefs so they also work from /benchmark.
const NAV = [
  ['/#/', 'Dashboard', 'dashboard', true],
  ['/#/play', 'Play & Lab', 'play'],
  ['/benchmark', 'Benchmark', 'tier'],
  ['/#/run', 'Run benchmark', 'run', true],
  ['/#/results', 'Results', 'results'],
  ['/#/compare', 'Compare', 'compare'],
  ['/#/agents', 'Entries', 'agents'],
  ['/#/about', 'How it works', 'about'],
].filter((n) => !(STATIC && n[3]));

const ROUTES = [
  [/^#?\/?$/, (q) => (STATIC ? playView(view, q, meta) : dashboard())],
  [/^#\/benchmark$/, tierView],
  [/^#\/run$/, runView],
  [/^#\/results$/, resultsView],
  [/^#\/results\/([\w.-]+)$/, resultDetail],
  [/^#\/compare$/, compareView],
  [/^#\/play$/, (q) => playView(view, q, meta)],
  [/^#\/agents$/, agentsView],
  [/^#\/about$/, aboutView],
];

const catLabel = (c) => meta?.categories[c]?.label || c;
const sizeLabel = (n) => `${n}×${n}`;
const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

function pageHead(title, sub, ...actions) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, title), sub && h('p', {}, sub)), actions.length ? h('div', { class: 'row' }, actions) : null);
}

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  // brainfuck-arena.inds.space/benchmark opens the tier list
  const onBench = /^\/benchmark(\.html)?\/?$/.test(location.pathname);
  const hash = location.hash.split('?')[0] || (onBench ? '#/benchmark' : '#/');
  document.getElementById('sidebar').classList.remove('open');
  for (const a of document.querySelectorAll('#nav a')) {
    const target = a.getAttribute('href').replace(/^\/benchmark$/, '/#/benchmark').slice(1);
    a.classList.toggle('active', target === '#/' ? hash === '#/' : hash.startsWith(target));
  }
  const match = ROUTES.map(([re, fn]) => [re.exec(hash), fn]).find(([m]) => m);
  put(view, loading());
  window.scrollTo(0, 0);
  try {
    if (!meta) meta = await api('/api/meta');
    if (!match) { put(view, h('div', { class: 'empty-state' }, h('h3', {}, 'Page not found'), h('a', { href: '#/' }, 'Back to dashboard'))); return; }
    const out = await match[1](...match[0].slice(1), query());
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    put(view, errorBox(e));
  }
}

// ---------------------------------------------------------------- dashboard
async function dashboard() {
  const [board, results, agents, current] = await Promise.all([api('/api/leaderboard'), api('/api/results'), api('/api/agents'), api('/api/runs/current')]);
  const top = board[0];
  const quickAgent = h('select', { 'aria-label': 'Agent' }, agents.map((a) => h('option', { value: a.id }, a.name)));
  const page = [
    pageHead('Dashboard', 'Brainfuck AI engines, measured on 3×3, 5×5 and 10×10 Tic-Tac-Toe.',
      h('a', { class: 'btn', href: '#/play' }, 'Play'),
      h('a', { class: 'btn', href: '/benchmark' }, 'Tier list'),
      h('a', { class: 'btn primary', href: '#/run' }, icon('run'), 'Run benchmark')),
    current.run?.status === 'running' && h('div', { class: 'notice', style: { marginBottom: '16px' } }, h('div', { class: 'row' }, h('div', { class: 'spinner' }), `Benchmark running: ${current.run.agentName} — ${current.run.done}/${current.run.total || '…'}`, h('span', { class: 'spacer' }), h('a', { href: '#/run' }, 'Watch live →'))),
    h('div', { class: 'grid g4', style: { marginBottom: '16px' } },
      statCard('Top grade', top ? h('span', { class: 'row' }, gradeEl(top.summary.grade), h('span', {}, top.summary.score.toFixed(1))) : '—', top ? top.agent.name : 'No runs yet'),
      statCard('Benchmark runs', fmt.int(results.length), `${new Set(results.map((r) => r.agent.id)).size} entries benchmarked`),
      statCard('Entries', fmt.int(agents.length), `${board.length} with an official result`),
      statCard('Official seed', String(meta.defaultSeed), 'same seed ⇒ same positions')),
    h('div', { class: 'split' },
      h('div', { class: 'card flush' },
        h('div', { class: 'card-head', style: { padding: '16px 18px 0' } }, h('h2', {}, 'Leaderboard'), h('span', { class: 'muted small' }, 'latest official run per entry')),
        board.length ? leaderboardTable(board) : h('div', { class: 'empty-state' }, h('h3', {}, 'No official results yet'), h('p', {}, `Run the benchmark on the official seed (${meta.defaultSeed}) to populate the leaderboard.`), h('a', { class: 'btn primary', href: '#/run' }, 'Run benchmark'))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, 'Quick run'),
          h('p', { class: 'muted' }, 'Runs the full deterministic suite: tactics on all three boards plus full matches.'),
          h('div', { class: 'row' }, quickAgent, h('button', { class: 'btn primary', onclick: () => { location.hash = `#/run?agent=${quickAgent.value}&start=1`; } }, 'Start'))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Recent runs'), h('a', { href: '#/results', class: 'small' }, 'All results →')),
          results.length ? h('div', { class: 'stack', style: { gap: '10px' } }, results.slice(0, 5).map((r) => h('a', { href: `#/results/${r.id}`, class: 'row', style: { color: 'inherit', textDecoration: 'none' } },
            gradeEl(r.summary.grade), h('div', { style: { minWidth: 0, flex: 1 } }, h('div', { style: { fontWeight: 600 } }, r.agent.name), h('div', { class: 'muted small' }, `${fmt.date(r.startedAt)} · seed ${r.seed}`)),
            h('div', { class: 'num', style: { fontWeight: 700 } }, r.summary.score.toFixed(1))))) : h('p', { class: 'muted' }, 'Nothing yet.')),
        rubricCard())),
  ];
  put(view, ...page.filter(Boolean));
}

function statCard(label, value, sub) {
  return h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub' }, sub));
}

function leaderboardTable(rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Entry'), h('th', {}, 'Grade'), h('th', { style: { width: '30%' } }, 'Score'), h('th', { class: 'num hide-sm' }, 'W/D/L'), h('th', { class: 'num hide-sm' }, 'Avg instr.'))),
    h('tbody', {}, rows.map((r, i) => h('tr', { style: { cursor: 'pointer' }, onclick: () => { location.hash = `#/results/${r.id}`; } },
      h('td', { class: 'muted' }, i + 1),
      h('td', {}, h('div', { style: { fontWeight: 600 } }, r.agent.name), h('div', { class: 'faint small mono' }, r.agent.sha256.slice(0, 10))),
      h('td', {}, gradeEl(r.summary.grade)),
      h('td', {}, h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { style: { flex: 1 } }, bar(r.summary.score)), h('b', { class: 'num' }, r.summary.score.toFixed(1)))),
      h('td', { class: 'num hide-sm' }, `${r.summary.matchRecord.win}/${r.summary.matchRecord.draw}/${r.summary.matchRecord.loss}`),
      h('td', { class: 'num hide-sm' }, fmt.compact(r.summary.instructions.avg)))))));
}

function rubricCard() {
  return h('div', { class: 'card' }, h('h2', {}, 'Grading'),
    h('div', { class: 'row', style: { gap: '6px', marginBottom: '10px' } }, meta.grades.map(([g, min]) => h('span', { class: 'row', style: { gap: '4px' } }, gradeEl(g), h('span', { class: 'muted small' }, `≥${min}`)))),
    h('p', { class: 'muted small' }, `Score = weighted accuracy over categories. Any illegal move or runtime error caps the grade at ${meta.capOnIllegal}.`),
    h('a', { href: '#/about', class: 'small' }, 'Full rubric →'));
}

// ---------------------------------------------------------------- run
async function runView(q) {
  const [agents, current] = await Promise.all([api('/api/agents'), api('/api/runs/current')]);
  const agentSel = h('select', { id: 'agent' }, agents.map((a) => h('option', { value: a.id, selected: a.id === q.get('agent') }, a.name)));
  const seedIn = h('input', { type: 'number', min: 0, value: meta.defaultSeed, id: 'seed', style: { width: '150px' } });
  const startBtn = h('button', { class: 'btn primary', type: 'submit' }, icon('run'), 'Start benchmark');
  const out = h('div', { class: 'stack' });
  let es = null;

  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    startBtn.disabled = true;
    try {
      const { run } = await api('/api/runs', { method: 'POST', body: { agentId: agentSel.value, seed: Number(seedIn.value) } });
      watch(run);
    } catch (err) { toast(err.message, 'error'); startBtn.disabled = false; }
  } },
  h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '14px' } },
    h('label', { class: 'field', for: 'agent' }, 'Entry', agentSel),
    h('label', { class: 'field', for: 'seed' }, 'Suite seed', seedIn),
    startBtn,
    h('span', { class: 'muted small', style: { maxWidth: '380px' } }, 'Same seed ⇒ identical positions and opponent moves, so runs are directly comparable.')));

  function watch(run) {
    startBtn.disabled = true;
    const state = { total: run.total, done: 0, pass: 0, fail: 0, cats: {}, feed: [], matches: [] };
    const pctEl = h('div', { class: 'pct' }, '0%');
    const barEl = h('div', { class: 'bar lg', style: { flex: 1 } }, h('i', { style: { width: '0%' } }));
    const counts = h('div', { class: 'muted' }, 'Generating suite…');
    const catsEl = h('div', {});
    const feedEl = h('div', { class: 'live-feed' });
    const matchEl = h('div', { class: 'log' });
    const cancelBtn = h('button', { class: 'btn danger sm', onclick: () => api(`/api/runs/${run.id}/cancel`, { method: 'POST' }).catch((e) => toast(e.message, 'error')) }, 'Cancel');
    const doneEl = h('div', {});
    put(out, 
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, `Running: ${run.agentName}`), h('span', { class: 'row' }, h('span', { class: 'tag' }, `seed ${run.seed}`), cancelBtn)),
        h('div', { class: 'progress-big' }, pctEl, barEl), counts, doneEl),
      h('div', { class: 'split' },
        h('div', { class: 'card' }, h('h2', {}, 'Latest positions'), h('div', { class: 'legend', style: { marginBottom: '10px' } }, h('span', {}, h('i', { style: { background: 'var(--good)' } }), 'correct move'), h('span', {}, h('i', { style: { background: 'var(--bad)' } }), 'wrong / illegal')), feedEl),
        h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', {}, 'Accuracy so far'), catsEl), h('div', { class: 'card' }, h('h2', {}, 'Matches'), matchEl))));

    const render = () => {
      const p = state.total ? (100 * state.done) / state.total : 0;
      pctEl.textContent = `${Math.floor(p)}%`;
      barEl.firstChild.style.width = `${p}%`;
      if (state.total) counts.textContent = `${state.done} / ${state.total} items · positions: ${state.pass} solved, ${state.fail} missed`;
      put(catsEl, ...Object.entries(state.cats).map(([c, v]) => meter(catLabel(c), (100 * v.p) / v.t, `${v.p}/${v.t}`)));
    };
    const onEvent = (ev) => {
      if (ev.type === 'snapshot') { state.total = ev.run.total; ev.events.forEach(onEvent); return; }
      if (ev.type === 'start') state.total = ev.total;
      if (ev.type === 'test') {
        const t = ev.test; state.done = ev.done; t.pass ? state.pass++ : state.fail++;
        const c = (state.cats[t.category] ||= { p: 0, t: 0 }); c.t++; if (t.pass) c.p++;
        feedEl.prepend(h('div', { class: 'test-card', title: `${t.id}: ${t.output.trim() || t.error}` }, boardEl(t.board, t.size, { pick: t.move, pass: t.pass, correct: t.correct }), h('div', { class: 'meta' }, h('span', { class: 'faint' }, sizeLabel(t.size)), h('span', { class: `tag ${t.pass ? 'good' : 'bad'}` }, t.pass ? '✓' : '✗'))));
        while (feedEl.children.length > 30) feedEl.lastChild.remove();
      }
      if (ev.type === 'match') {
        state.done = ev.done;
        const m = ev.match, cls = { win: 'good', loss: 'bad', forfeit: 'bad', draw: '' }[m.result];
        matchEl.prepend(h('div', { class: 'entry' }, h('span', {}, `${sizeLabel(m.size)} vs ${meta.opponents[m.opponent].label} (as ${m.agentPlays})`), h('span', { class: `tag ${cls}` }, m.result)));
      }
      if (ev.type === 'done') {
        cancelBtn.remove();
        if (ev.fatal) put(doneEl, h('div', { class: 'notice error', style: { marginTop: '12px' } }, `Agent failed to load: ${ev.fatal}`), h('a', { href: `#/results/${ev.resultId}` }, 'Open report →'));
        else put(doneEl, h('div', { class: 'row', style: { marginTop: '14px' } }, gradeEl(ev.summary.grade, true), h('div', {}, h('div', { style: { fontSize: '22px', fontWeight: 800 } }, `${ev.summary.score.toFixed(1)} / 100`), h('div', { class: 'muted' }, `${ev.summary.illegal} illegal · ${ev.summary.errors} errors · avg ${fmt.compact(ev.summary.instructions.avg)} instructions/move`)), h('span', { class: 'spacer' }), h('a', { class: 'btn primary', href: `#/results/${ev.resultId}` }, 'Open full report →')));
        startBtn.disabled = false;
        toast(`Benchmark finished: grade ${ev.summary.grade}`);
      }
      if (ev.type === 'error' || ev.type === 'cancelled') {
        cancelBtn.remove();
        put(doneEl, h('div', { class: 'notice error', style: { marginTop: '12px' } }, ev.type === 'cancelled' ? 'Run cancelled.' : `Run failed: ${ev.message}`));
        startBtn.disabled = false;
      }
      render();
    };
    es?.close();
    es = new EventSource(`/api/runs/${run.id}/events`);
    es.onmessage = (m) => onEvent(JSON.parse(m.data));
    es.onerror = () => { es.close(); };
  }

  put(view, pageHead('Run benchmark', `${meta.limits.maxInstructions.toLocaleString('en-US')} instructions per move · ${meta.limits.tapeSize.toLocaleString('en-US')}-cell tape · 8-bit wrapping cells · EOF = 0`), form, h('div', { style: { height: '16px' } }), out);
  if (current.run && current.run.status === 'running') watch(current.run);
  else if (q.get('start') === '1') form.requestSubmit();
  return () => es?.close();
}

// ---------------------------------------------------------------- results list
async function resultsView() {
  const results = await api('/api/results');
  const selected = new Set();
  const compareBtn = h('button', { class: 'btn', disabled: true, onclick: () => { location.hash = `#/compare?ids=${[...selected].join(',')}`; } }, icon('compare'), 'Compare selected');
  const agentsSeen = [...new Map(results.map((r) => [r.agent.name, r.agent.name])).keys()];
  const filter = h('select', { 'aria-label': 'Filter by entry', onchange: () => draw() }, h('option', { value: '' }, 'All entries'), agentsSeen.map((n) => h('option', { value: n }, n)));
  const tbody = h('tbody');
  const draw = () => {
    const rows = results.filter((r) => !filter.value || r.agent.name === filter.value);
    put(tbody, ...rows.map((r) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${r.id}`, checked: selected.has(r.id), onclick: (e) => e.stopPropagation(), onchange: () => { cb.checked ? selected.add(r.id) : selected.delete(r.id); compareBtn.disabled = selected.size < 2; compareBtn.lastChild.textContent = `Compare selected${selected.size ? ` (${selected.size})` : ''}`; } });
      const del = !STATIC && h('button', { class: 'btn sm icon danger', title: 'Delete result', 'aria-label': 'Delete result', onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete result ${r.id}?`)) return;
        try { await api(`/api/results/${r.id}`, { method: 'DELETE' }); results.splice(results.indexOf(r), 1); selected.delete(r.id); draw(); toast('Result deleted'); } catch (err) { toast(err.message, 'error'); }
      } }, icon('trash'));
      return h('tr', { style: { cursor: 'pointer' }, onclick: () => { location.hash = `#/results/${r.id}`; } },
        h('td', {}, cb),
        h('td', {}, h('div', { style: { fontWeight: 600 } }, r.agent.name), h('div', { class: 'faint small mono' }, r.agent.sha256.slice(0, 10))),
        h('td', {}, gradeEl(r.summary.grade)),
        h('td', { class: 'num' }, h('b', {}, r.summary.score.toFixed(1))),
        h('td', { class: 'hide-sm' }, Object.entries(r.summary.sizes).map(([n, v]) => h('span', { class: 'tag', style: { marginRight: '4px' } }, `${sizeLabel(n)} ${v.pct.toFixed(0)}%`))),
        h('td', { class: 'num hide-sm' }, r.summary.illegal ? h('span', { class: 'tag bad' }, r.summary.illegal) : '0'),
        h('td', { class: 'num hide-sm' }, fmt.compact(r.summary.instructions.avg)),
        h('td', { class: 'nowrap' }, h('div', {}, fmt.date(r.startedAt)), h('div', { class: 'faint small' }, `seed ${r.seed} · ${fmt.ms(r.durationMs)}`)),
        h('td', {}, del));
    }));
  };
  draw();
  put(view, 
    pageHead('Results', 'Every benchmark run, stored in benchmarks/<entry>/results/.', filter, compareBtn),
    results.length
      ? h('div', { class: 'card flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Entry'), h('th', {}, 'Grade'), h('th', { class: 'num' }, 'Score'), h('th', { class: 'hide-sm' }, 'By board'), h('th', { class: 'num hide-sm' }, 'Illegal'), h('th', { class: 'num hide-sm' }, 'Avg instr.'), h('th', {}, 'When'), h('th', {}))), tbody)))
      : h('div', { class: 'card empty-state' }, h('h3', {}, 'No results stored'), h('p', {}, 'Runs you start with `npm run bench` (or from the local app) appear here.'), STATIC ? null : h('a', { class: 'btn primary', href: '#/run' }, 'Run benchmark')));
}

// ---------------------------------------------------------------- result detail
async function resultDetail(id) {
  const r = await api(`/api/results/${id}`);
  const s = r.summary;
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  const tabs = { overview: 'Overview', positions: `Positions (${r.tests.length})`, matches: `Matches (${r.matches.length})` };
  const show = (k) => {
    for (const b of tabsEl.children) b.classList.toggle('on', b.dataset.k === k);
    put(body, k === 'overview' ? overview() : k === 'positions' ? positions() : matchesTab());
  };
  for (const [k, label] of Object.entries(tabs)) tabsEl.append(h('button', { 'data-k': k, role: 'tab', onclick: () => show(k) }, label));

  function overview() {
    return h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', {}, 'Categories'), Object.entries(s.categories).map(([c, v]) => meter(catLabel(c), v.pct, `${+v.points.toFixed(1)}/${v.total}`)),
        h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Weights: ', Object.entries(meta.weights).map(([c, w]) => `${catLabel(c)} ${w}`).join(' · '))),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h2', {}, 'Board sizes'), Object.entries(s.sizes).map(([n, v]) => meter(meta.modes[n].label, v.pct))),
        h('div', { class: 'card' }, h('h2', {}, 'Performance'),
          h('dl', { class: 'kv' },
            h('dt', {}, 'Agent moves'), h('dd', {}, fmt.int(s.moves)),
            h('dt', {}, 'Instructions (avg)'), h('dd', {}, fmt.int(s.instructions.avg)),
            h('dt', {}, 'Instructions (max)'), h('dd', {}, `${fmt.int(s.instructions.max)} of ${fmt.int(r.limits.maxInstructions)}`),
            h('dt', {}, 'Instructions (total)'), h('dd', {}, fmt.int(s.instructions.total)),
            h('dt', {}, 'Interpreter time'), h('dd', {}, fmt.ms(s.timeMs)),
            h('dt', {}, 'Wall time'), h('dd', {}, fmt.ms(r.durationMs)),
            h('dt', {}, 'Illegal moves'), h('dd', {}, s.illegal ? h('span', { class: 'tag bad' }, s.illegal) : '0'),
            h('dt', {}, 'Runtime errors'), h('dd', {}, s.errors ? h('span', { class: 'tag bad' }, s.errors) : '0'),
            h('dt', {}, 'Matches W/D/L'), h('dd', {}, `${s.matchRecord.win} / ${s.matchRecord.draw} / ${s.matchRecord.loss}`)))));
  }

  function positions() {
    const f = { size: '', category: '', status: '' };
    const grid = h('div', { class: 'test-grid' });
    const chips = (key, opts) => h('div', { class: 'row', style: { gap: '6px' } }, opts.map(([v, label]) => {
      const c = h('button', { class: `chip${f[key] === v ? ' on' : ''}`, onclick: () => { f[key] = v; for (const x of c.parentNode.children) x.classList.toggle('on', x === c); draw(); } }, label);
      return c;
    }));
    const cats = [...new Set(r.tests.map((t) => t.category))];
    const draw = () => {
      const list = r.tests.filter((t) => (!f.size || String(t.size) === f.size) && (!f.category || t.category === f.category) && (!f.status || (f.status === 'pass' ? t.pass : !t.pass)));
      put(grid, ...(list.length ? list.map((t) => h('button', { class: 'test-card', type: 'button', onclick: () => openTest(t) },
        boardEl(t.board, t.size, { pick: t.move, pass: t.pass, correct: t.correct }),
        h('div', { class: 'meta' }, h('span', { class: 'mono faint' }, t.id), h('span', { class: `tag ${t.pass ? 'good' : 'bad'}` }, t.pass ? 'pass' : t.legal ? 'miss' : 'illegal')),
        h('div', { class: 'meta muted' }, h('span', {}, catLabel(t.category)), h('span', { class: 'mono' }, fmt.compact(t.instructions))))) : [h('div', { class: 'empty-state' }, 'No positions match these filters.')]));
    };
    draw();
    return h('div', { class: 'stack' },
      h('div', { class: 'card stack', style: { gap: '10px' } },
        chips('size', [['', 'All sizes'], ...Object.keys(meta.modes).map((n) => [n, sizeLabel(n)])]),
        chips('category', [['', 'All categories'], ...cats.map((c) => [c, catLabel(c)])]),
        chips('status', [['', 'Any result'], ['pass', 'Passed'], ['fail', 'Failed']]),
        h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: 'var(--good)' } }), 'agent move, correct'), h('span', {}, h('i', { style: { background: 'var(--bad)' } }), 'agent move, wrong'), h('span', {}, h('i', { style: { background: 'var(--good)', borderRadius: '50%', opacity: 0.55 } }), 'accepted answers'))),
      grid);
  }

  function matchesTab() {
    return h('div', { class: 'card flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Board'), h('th', {}, 'Opponent'), h('th', {}, 'Agent plays'), h('th', {}, 'Result'), h('th', { class: 'num' }, 'Moves'), h('th', { class: 'num hide-sm' }, 'Avg instr.'), h('th', {}))),
      h('tbody', {}, r.matches.map((m) => {
        const avg = m.agentMoves.length ? m.agentMoves.reduce((a, x) => a + x.instructions, 0) / m.agentMoves.length : 0;
        const cls = { win: 'good', loss: 'bad', forfeit: 'bad', draw: '' }[m.result];
        return h('tr', { style: { cursor: 'pointer' }, onclick: () => openMatch(m) },
          h('td', {}, sizeLabel(m.size)), h('td', {}, meta.opponents[m.opponent]?.label || m.opponent), h('td', {}, m.agentPlays),
          h('td', {}, h('span', { class: `tag ${cls}` }, m.result)), h('td', { class: 'num' }, m.moves.length), h('td', { class: 'num hide-sm' }, fmt.compact(avg)),
          h('td', {}, h('span', { class: 'small' }, 'Replay →')));
      })))));
  }

  put(view, 
    pageHead(r.agent.name, `${fmt.date(r.startedAt)} · seed ${r.seed}${r.seed === meta.defaultSeed ? ' (official)' : ''} · suite v${r.version} · ${r.runtime || 'interpreter'}`, STATIC ? null : h('a', { class: 'btn', href: `#/run?agent=${r.agent.id}` }, 'Re-run'), h('a', { class: 'btn', href: `#/play?agent=${r.agent.id}` }, 'Play it'), h('a', { class: 'btn', href: apiUrl(`/api/results/${r.id}`), download: `${r.id}.json` }, 'Download JSON')),
    r.fatal ? h('div', { class: 'notice error', style: { marginBottom: '16px' } }, `The agent could not be loaded: ${r.fatal}`) : null,
    h('div', { class: 'grid g4', style: { marginBottom: '16px' } },
      h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Grade'), h('div', { class: 'value' }, gradeEl(s.grade, true)), h('div', { class: 'sub' }, s.capped ? `capped at ${meta.capOnIllegal}: illegal moves` : 'uncapped')),
      statCard('Score', `${s.score.toFixed(1)}`, 'out of 100'),
      statCard('Positions solved', `${r.tests.filter((t) => t.pass).length}/${r.tests.length}`, `${r.tests.filter((t) => !t.legal).length} illegal`),
      statCard('engine.bf', fmt.bytes(r.agent.bytes), h('span', { class: 'mono' }, r.agent.sha256.slice(0, 16)))),
    tabsEl, body);
  show('overview');
}

function openDialog(title, content) {
  const dlg = h('dialog', {}, h('div', { class: 'dlg-head' }, h('h2', { style: { margin: 0 } }, title), h('button', { class: 'btn icon sm', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'))), h('div', { class: 'dlg-body' }, content));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
}

function openTest(t) {
  const rc = (i) => (i == null ? '—' : `${Math.floor(i / t.size)} ${i % t.size}`);
  openDialog(`${t.id} · ${catLabel(t.category)}`, h('div', { class: 'grid g2' },
    h('div', { class: 'board-wrap' }, boardEl(t.board, t.size, { pick: t.move, pass: t.pass, correct: t.correct })),
    h('div', { class: 'stack', style: { gap: '12px' } },
      h('div', {}, h('span', { class: `tag ${t.pass ? 'good' : 'bad'}` }, t.pass ? 'PASS' : t.legal ? 'WRONG MOVE' : 'ILLEGAL'), ' ', h('span', { class: 'muted' }, meta.categories[t.category]?.description)),
      h('dl', { class: 'kv' },
        h('dt', {}, 'To move'), h('dd', {}, t.toMove),
        h('dt', {}, 'Agent move'), h('dd', { class: 'mono' }, rc(t.move)),
        h('dt', {}, 'Accepted'), h('dd', { class: 'mono' }, t.correct.length > 12 ? `${t.correct.length} squares` : t.correct.map(rc).join(', ')),
        h('dt', {}, 'Instructions'), h('dd', {}, fmt.int(t.instructions)),
        h('dt', {}, 'Time'), h('dd', {}, `${t.timeMs} ms`),
        t.error ? [h('dt', {}, 'Error'), h('dd', { style: { color: 'var(--bad)' } }, t.error)] : null),
      h('div', {}, h('div', { class: 'muted small' }, 'stdin'), h('pre', { class: 'io' }, `${t.size}\n${t.toMove}\n${Array.from({ length: t.size }, (_, i) => t.board.slice(i * t.size, i * t.size + t.size)).join('\n')}\n`)),
      h('div', {}, h('div', { class: 'muted small' }, 'stdout'), h('pre', { class: 'io' }, JSON.stringify(t.output))),
      h('a', { class: 'btn sm', href: `#/play?mode=lab&size=${t.size}&board=${t.board}` }, 'Open in Position Lab'))));
}

function openMatch(m) {
  let step = m.moves.length;
  const holder = h('div', { class: 'board-wrap' });
  const info = h('div', { class: 'muted' });
  const slider = h('input', { type: 'range', min: 0, max: m.moves.length, value: step, style: { width: '100%' }, 'aria-label': 'Move', oninput: () => { step = +slider.value; draw(); } });
  const draw = () => {
    const cells = Array(m.size * m.size).fill('.');
    m.moves.slice(0, step).forEach((mv) => { if (mv.index != null) cells[mv.index] = mv.p; });
    const last = m.moves[step - 1];
    put(holder, boardEl(cells, m.size, { last: last?.index }));
    info.textContent = step === 0 ? 'Start position' : `Move ${step}: ${last.by === 'agent' ? 'agent' : meta.opponents[m.opponent].label} (${last.p}) → ${last.index == null ? last.error : `${Math.floor(last.index / m.size)} ${last.index % m.size}`}${last.instructions ? ` · ${fmt.int(last.instructions)} instructions` : ''}`;
  };
  draw();
  openDialog(`${sizeLabel(m.size)} vs ${meta.opponents[m.opponent].label} — ${m.result}`, h('div', { class: 'stack', style: { gap: '12px' } }, holder, slider,
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { step = Math.max(0, step - 1); slider.value = step; draw(); } }, '← Prev'), h('button', { class: 'btn sm', onclick: () => { step = Math.min(m.moves.length, step + 1); slider.value = step; draw(); } }, 'Next →'), info)));
}

// ---------------------------------------------------------------- compare
async function compareView(q) {
  const all = await api('/api/results');
  let ids = (q.get('ids') || '').split(',').filter(Boolean);
  if (ids.length < 2) {
    // default: latest run of each agent
    const latest = new Map();
    for (const r of all) if (!latest.has(r.agent.sha256)) latest.set(r.agent.sha256, r.id);
    ids = [...latest.values()].slice(0, 4);
  }
  const runs = (await Promise.all(ids.map((id) => api(`/api/results/${id}`).catch(() => null)))).filter(Boolean);
  if (runs.length < 2) {
    put(view, pageHead('Compare', 'Side-by-side comparison of entries.'), h('div', { class: 'card empty-state' }, h('h3', {}, 'Need at least two results'), h('p', {}, runs.length === 1 ? `Only ${runs[0].agent.name} has been benchmarked so far. Compare lights up when a second entry joins.` : 'Benchmark two or more entries (npm run bench), then come back.'), h('a', { class: 'btn', href: '/benchmark' }, 'See the tier list')));
    return;
  }
  const cats = [...new Set(runs.flatMap((r) => Object.keys(r.summary.categories)))];
  const sizes = Object.keys(meta.modes);
  const colors = ['var(--accent)', 'var(--cyan)', 'var(--o)', 'var(--warn)', 'var(--good)', 'var(--x)'];
  const cell = (pct, i) => h('td', {}, h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '8px' } }, h('div', { class: 'bar', style: { flex: 1, minWidth: '50px' } }, h('i', { style: { width: `${pct}%`, background: colors[i % colors.length] } })), h('span', { class: 'num', style: { minWidth: '44px' } }, fmt.pct(pct))));
  const head = h('thead', {}, h('tr', {}, h('th', {}, 'Metric'), runs.map((r, i) => h('th', {}, h('span', { style: { color: colors[i % colors.length] } }, '● '), h('a', { href: `#/results/${r.id}` }, r.agent.name), h('div', { class: 'faint small', style: { textTransform: 'none', letterSpacing: 0 } }, `${fmt.date(r.startedAt)} · seed ${r.seed}`)))));
  const rows = [
    h('tr', {}, h('td', { style: { fontWeight: 600 } }, 'Grade / score'), runs.map((r) => h('td', {}, h('span', { class: 'row' }, gradeEl(r.summary.grade), h('b', {}, r.summary.score.toFixed(1)))))),
    ...cats.map((c) => h('tr', {}, h('td', {}, catLabel(c)), runs.map((r, i) => cell(r.summary.categories[c]?.pct ?? 0, i)))),
    ...sizes.map((n) => h('tr', {}, h('td', {}, meta.modes[n].label), runs.map((r, i) => cell(r.summary.sizes[n]?.pct ?? 0, i)))),
    h('tr', {}, h('td', {}, 'Avg instructions / move'), runs.map((r) => h('td', { class: 'mono' }, fmt.int(r.summary.instructions.avg)))),
    h('tr', {}, h('td', {}, 'Max instructions / move'), runs.map((r) => h('td', { class: 'mono' }, fmt.int(r.summary.instructions.max)))),
    h('tr', {}, h('td', {}, 'Illegal moves'), runs.map((r) => h('td', {}, r.summary.illegal ? h('span', { class: 'tag bad' }, r.summary.illegal) : '0'))),
    h('tr', {}, h('td', {}, 'Matches W/D/L'), runs.map((r) => h('td', {}, `${r.summary.matchRecord.win} / ${r.summary.matchRecord.draw} / ${r.summary.matchRecord.loss}`))),
  ];
  // positions where agents disagree (same seed only)
  const sameSuite = runs.every((r) => r.seed === runs[0].seed && r.version === runs[0].version);
  const diffs = sameSuite ? runs[0].tests.map((t, k) => ({ t, res: runs.map((r) => r.tests[k]) })).filter(({ res }) => new Set(res.map((x) => x.pass)).size > 1) : [];
  put(view, 
    pageHead('Compare', `${runs.length} runs side by side.`, h('a', { class: 'btn', href: '#/results' }, 'Pick runs')),
    h('div', { class: 'card flush', style: { marginBottom: '16px' } }, h('div', { class: 'table-wrap' }, h('table', { class: 't' }, head, h('tbody', {}, rows)))),
    h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Where they disagree'), h('span', { class: 'muted small' }, sameSuite ? `${diffs.length} positions` : 'runs use different seeds')),
      diffs.length ? h('div', { class: 'test-grid' }, diffs.slice(0, 60).map(({ t, res }) => h('div', { class: 'test-card', style: { cursor: 'default' } },
        h('div', { class: 'meta' }, h('span', { class: 'mono faint' }, t.id), h('span', { class: 'muted' }, catLabel(t.category))),
        h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${Math.min(res.length, 2)}, minmax(0, 1fr))`, gap: '6px' } }, res.map((x, i) => h('div', {}, boardEl(x.board, x.size, { pick: x.move, pass: x.pass, correct: x.correct }), h('div', { class: 'small', style: { color: colors[i % colors.length], textAlign: 'center' } }, x.pass ? '✓' : '✗')))))))
        : h('p', { class: 'muted' }, sameSuite ? 'All compared agents agree on every position.' : 'Use the same seed to compare positions one by one.')));
}

// ---------------------------------------------------------------- tier list
const TIERS = ['S+', 'S', 'A', 'B', 'C', 'D', 'F'];

async function tierView(q) {
  const [agents, board] = await Promise.all([api('/api/agents'), api('/api/leaderboard')]);
  const official = new Map(board.map((r) => [r.agent.id, r]));
  let mode = q.get('by') === 'ind' ? 'ind' : 'official';
  const rowsEl = h('div', { class: 'tier-list' });
  const chips = h('div', { class: 'row', style: { gap: '6px' } });
  const chip = (e) => {
    const r = official.get(e.id);
    return h('a', { class: 'tier-chip', href: r ? `/#/results/${r.id}` : `/#/agents` }, h('b', {}, e.name), r ? h('span', { class: 'num muted' }, r.summary.score.toFixed(1)) : null);
  };
  const draw = () => {
    for (const c of chips.children) c.classList.toggle('on', c.dataset.k === mode);
    const tierOf = (e) => (mode === 'ind' ? (TIERS.includes(e.indTier) ? e.indTier : null) : official.get(e.id)?.summary.grade || null);
    const rows = TIERS.map((t) => [t, agents.filter((e) => tierOf(e) === t)]);
    const rest = agents.filter((e) => !tierOf(e));
    put(rowsEl,
      rows.map(([t, list]) => h('div', { class: 'tier-row' }, gradeEl(t, true), h('div', { class: 'tier-items' }, list.length ? list.map(chip) : h('span', { class: 'faint small' }, '—')))),
      rest.length ? h('div', { class: 'tier-row' }, h('span', { class: 'grade lg', 'data-g': '?' }, '?'), h('div', { class: 'tier-items' }, rest.map(chip), h('span', { class: 'faint small' }, mode === 'ind' ? 'not rated by Ind yet' : 'no official run yet'))) : null);
  };
  for (const [k, label] of [['official', 'Official grade'], ['ind', "Ind's tier"]]) chips.append(h('button', { class: 'chip', 'data-k': k, onclick: () => { mode = k; draw(); } }, label));
  draw();

  const cats = Object.keys(meta.weights).filter((c) => c !== 'match');
  const table = h('div', { class: 'card flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Entry'), h('th', {}, 'Official'), h('th', { class: 'num' }, 'Score'), h('th', {}, "Ind's tier"), cats.map((c) => h('th', { class: 'num hide-sm' }, catLabel(c))), h('th', { class: 'num' }, 'W/D/L'), h('th', { class: 'num hide-sm' }, 'Avg instr.'), h('th', {}))),
    h('tbody', {}, [...agents].sort((x, y) => (official.get(y.id)?.summary.score ?? -1) - (official.get(x.id)?.summary.score ?? -1)).map((e) => {
      const r = official.get(e.id), s = r?.summary;
      return h('tr', {},
        h('td', { class: 'nowrap' }, h('div', { style: { fontWeight: 600 } }, e.name), h('div', { class: 'faint small' }, [e.provider, e.harness].filter(Boolean).join(' · '))),
        h('td', {}, s ? gradeEl(s.grade) : h('span', { class: 'faint' }, '—')),
        h('td', { class: 'num' }, s ? h('b', {}, s.score.toFixed(1)) : '—'),
        h('td', {}, TIERS.includes(e.indTier) ? h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, gradeEl(e.indTier), e.indNote ? h('span', { class: 'muted small' }, e.indNote) : null) : h('span', { class: 'faint small' }, 'not rated yet')),
        cats.map((c) => h('td', { class: 'num hide-sm' }, s?.categories[c] ? fmt.pct(s.categories[c].pct) : '—')),
        h('td', { class: 'num' }, s ? `${s.matchRecord.win}/${s.matchRecord.draw}/${s.matchRecord.loss}` : '—'),
        h('td', { class: 'num hide-sm' }, s ? fmt.compact(s.instructions.avg) : '—'),
        h('td', { class: 'nowrap' }, r ? h('a', { class: 'small', href: `/#/results/${r.id}` }, 'Report') : null, ' ', h('a', { class: 'small', href: `/#/play?agent=${e.id}` }, 'Play'), ' ', h('a', { class: 'small', href: `${REPO}/tree/main/benchmarks/${e.id}`, target: '_blank', rel: 'noopener' }, 'Source')));
    })))));

  put(view,
    pageHead('Benchmark', 'The official (informal, slop) Brainfuck Arena benchmark: Tic-Tac-Toe engines written by AI models in pure Brainfuck.', chips),
    h('div', { class: 'card', style: { marginBottom: '16px' } }, rowsEl),
    table,
    h('div', { class: 'grid g2', style: { marginTop: '16px' } },
      h('div', { class: 'card' }, h('h2', {}, 'Two ratings'),
        h('p', { class: 'muted' }, h('b', {}, 'Official grade'), ` is computed by the deterministic suite on seed ${meta.defaultSeed}: ${Object.values(meta.categories).length} categories of exactly-solved positions plus 24 full matches, weighted into a 0–100 score. Any illegal move caps it at ${meta.capOnIllegal}.`),
        h('p', { class: 'muted', style: { marginBottom: 0 } }, h('b', {}, "Ind's tier"), ' is a hand-given rating from playing against the engine. Vibes, but informed vibes.')),
      h('div', { class: 'card' }, h('h2', {}, 'Add a model'),
        h('p', { class: 'muted' }, 'Give a model the one-shot challenge, then open a pull request adding ', h('code', {}, 'benchmarks/<model>/engine.bf'), ' and ', h('code', {}, 'entry.json'), '. The official grade is always computed by the arena, never self-reported.'),
        h('a', { class: 'btn sm', href: `${REPO}#submit-an-entry`, target: '_blank', rel: 'noopener' }, 'How to submit →'))));
}

// ---------------------------------------------------------------- entries
async function agentsView() {
  const agents = await api('/api/agents');
  put(view, pageHead('Entries', 'Each entry is a Brainfuck program written by an AI model, in benchmarks/<model>/.', h('a', { class: 'btn', href: `${REPO}#submit-an-entry`, target: '_blank', rel: 'noopener' }, 'Submit an entry')),
    h('div', { class: 'grid g2' }, agents.map((a) => h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', { style: { margin: 0 } }, a.name), h('div', { class: 'faint small mono' }, a.file)), TIERS.includes(a.indTier) ? h('span', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'muted small' }, "Ind's tier"), gradeEl(a.indTier)) : null),
      h('p', { class: 'muted' }, a.description),
      h('dl', { class: 'kv', style: { marginBottom: '12px' } },
        a.model ? [h('dt', {}, 'Model'), h('dd', { class: 'mono' }, a.model)] : null,
        a.provider ? [h('dt', {}, 'Provider'), h('dd', {}, a.provider)] : null,
        a.harness ? [h('dt', {}, 'Harness'), h('dd', {}, a.harness)] : null,
        a.date ? [h('dt', {}, 'Written'), h('dd', {}, a.date)] : null,
        h('dt', {}, 'Size'), h('dd', {}, `${fmt.bytes(a.bytes)} · ${fmt.int(a.commands)} commands`),
        h('dt', {}, 'SHA-256'), h('dd', { class: 'mono' }, a.sha256.slice(0, 16))),
      h('div', { class: 'row' },
        STATIC ? null : h('a', { class: 'btn sm primary', href: `#/run?agent=${a.id}` }, 'Benchmark'),
        h('a', { class: 'btn sm', href: `#/play?agent=${a.id}` }, 'Play'),
        h('a', { class: 'btn sm', href: apiUrl(`/api/agents/${a.id}/source`), download: `${a.id}.bf` }, 'Download .bf'),
        h('a', { class: 'btn sm', href: `${REPO}/tree/main/benchmarks/${a.id}`, target: '_blank', rel: 'noopener' }, 'Source'))))));
}

// ---------------------------------------------------------------- about
async function aboutView() {
  const w = meta.weights;
  put(view, pageHead('How it works', 'Rules, I/O contract, benchmark design and grading.'),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', {}, 'Agent contract'),
        h('p', {}, 'An agent is a Brainfuck program. For each move it receives the position on stdin:'),
        h('pre', { class: 'io' }, '3\nX\nX..\n.O.\n...\n'),
        h('p', {}, 'Line 1 is the board size N (3, 5 or 10), line 2 the player to move, then N rows of ', h('code', {}, 'X'), ', ', h('code', {}, 'O'), ', ', h('code', {}, '.'), '. The agent prints its move as zero-indexed ', h('code', {}, 'row col'), ', e.g. ', h('code', {}, '0 1'), '.'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Cells'), h('dd', {}, '8-bit, wrapping'), h('dt', {}, 'Tape'), h('dd', {}, `${fmt.int(meta.limits.tapeSize)} cells; moving off either end is an error`),
          h('dt', {}, 'EOF'), h('dd', {}, 'reads 0'), h('dt', {}, 'Budget'), h('dd', {}, `${fmt.int(meta.limits.maxInstructions)} executed instructions per move`),
          h('dt', {}, 'Output'), h('dd', {}, 'must be "row col" on an empty square; anything else is an illegal move'))),
      h('div', { class: 'card' }, h('h2', {}, 'Modes'),
        Object.entries(meta.modes).map(([n, m]) => h('div', { class: 'row', style: { padding: '6px 0' } }, h('span', { class: 'tag accent' }, `${n}×${n}`), h('span', {}, m.label.split('·')[1].trim()), h('span', { class: 'muted small' }, 'X moves first · no gravity'))),
        h('h3', { style: { marginTop: '14px' } }, 'Benchmark suite'),
        h('p', { class: 'muted' }, 'Generated deterministically from a seed by self-play that never finishes a line, so every position is legal (X first, correct turn order) and unfinished. Every expected answer is computed by exhaustive search — never by the engine.'),
        h('div', {}, Object.entries(meta.categories).map(([k, c]) => h('div', { style: { padding: '6px 0', borderTop: '1px solid var(--border)' } }, h('div', { class: 'row' }, h('b', {}, c.label), h('span', { class: 'spacer' }), h('span', { class: 'tag' }, `weight ${w[k]}`)), h('div', { class: 'muted small' }, c.description))))),
      h('div', { class: 'card' }, h('h2', {}, 'Grading'),
        h('p', {}, 'Category accuracy is averaged with the weights shown, giving a 0–100 score.'),
        h('div', { class: 'row', style: { gap: '8px' } }, meta.grades.map(([g, min]) => h('span', { class: 'row', style: { gap: '4px' } }, gradeEl(g), h('span', { class: 'muted' }, `≥ ${min}`)))),
        h('p', { style: { marginTop: '12px' } }, `Any illegal move, crash, tape overflow or instruction-limit hit caps the grade at ${meta.capOnIllegal}. Matches score 1 for a win, ½ for a draw (a draw counts as full marks against the perfect 3×3 player).`),
        h('h3', {}, 'Sparring opponents'),
        Object.values(meta.opponents).map((o) => h('div', { class: 'small', style: { padding: '3px 0' } }, h('b', {}, o.label), h('span', { class: 'muted' }, ` — ${o.description}`)))),
      h('div', { class: 'card' }, h('h2', {}, 'Claude Opus 5.5\'s engine'),
        h('p', {}, h('code', {}, 'benchmarks/claude-opus-5.5/engine.bf'), ' is plain Brainfuck generated by the model\'s own compiler in ', h('code', {}, 'source/'), '. Every decision is computed by the Brainfuck program at run time:'),
        h('ol', { class: 'muted', style: { paddingLeft: '18px', margin: 0 } },
          h('li', {}, 'Parse the board into a padded grid of 38-cell blocks so every 3/4/5-long line is a fixed stride away.'),
          h('li', {}, 'Scan every window in 4 directions: count stones, find immediate wins / blocks, count double-threat potential, add positional weight.'),
          h('li', {}, '2-ply fork lookahead: which squares defuse every enemy fork; which forcing moves hand the opponent a fork.'),
          h('li', {}, '4-ply search: for each safe forcing move, actually play it and the forced reply, update threat tables incrementally, and look for a winning double threat; then undo.'),
          h('li', {}, 'Pick the best (tier, score) square and print it.')),
        h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'In the browser, Brainfuck is compiled to WebAssembly with exactly the same instruction counting as the reference interpreter.'))));
}

// ---------------------------------------------------------------- shell
function initShell() {
  const nav = document.getElementById('nav');
  put(nav, ...NAV.map(([href, label, ic]) => h('a', { href }, icon(ic), label)));
  const toggle = document.getElementById('theme-toggle');
  const setLabel = () => {
    const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark';
    put(toggle, icon(dark ? 'sun' : 'moon'), dark ? 'Light mode' : 'Dark mode');
  };
  toggle.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    setLabel();
  });
  if (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
  setLabel();
  document.getElementById('menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('repo').href = REPO;
  if (STATIC) return;
  // background run indicator (local app only)
  const pill = document.getElementById('run-pill');
  const poll = async () => {
    try {
      const { run } = await api('/api/runs/current');
      const on = run && run.status === 'running';
      pill.classList.toggle('on', !!on);
      if (on) put(pill, h('div', { class: 'row', style: { gap: '8px', marginBottom: '6px' } }, h('div', { class: 'spinner' }), h('b', {}, 'Benchmark running')), h('div', { class: 'muted' }, `${run.agentName} · ${run.done}/${run.total || '…'}`), bar(run.total ? (100 * run.done) / run.total : 0));
    } catch { /* server unreachable: keep quiet */ }
  };
  poll(); setInterval(poll, 2000);
}

initShell();
window.addEventListener('hashchange', route);
route();

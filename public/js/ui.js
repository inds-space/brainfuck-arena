// Small DOM + formatting helpers shared by all views.
import { STATIC } from './config.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Replace an element's children, skipping null/false and flattening arrays (like h()). */
export function put(el, ...children) { el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (c instanceof Node ? c : document.createTextNode(String(c))))); return el; }

export const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };

const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  run: `<svg viewBox="0 0 24 24" ${P}><path d="M6 4l14 8-14 8z"/></svg>`,
  results: `<svg viewBox="0 0 24 24" ${P}><path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6"/></svg>`,
  compare: `<svg viewBox="0 0 24 24" ${P}><path d="M8 3v18M16 3v18M3 8h5M16 16h5"/></svg>`,
  play: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>`,
  agents: `<svg viewBox="0 0 24 24" ${P}><path d="M8 4H5v16h3M16 4h3v16h-3"/><path d="M10 12h4"/></svg>`,
  tier: `<svg viewBox="0 0 24 24" ${P}><path d="M4 5h4M4 12h4M4 19h4M11 5h9M11 12h6M11 19h3"/></svg>`,
  github: `<svg viewBox="0 0 24 24" ${P}><path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>`,
  about: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" ${P}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" ${P}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  x: `<svg viewBox="0 0 24 24" ${P}><path d="M6 6l12 12M18 6L6 18"/></svg>`,
};
export const icon = (name) => svg(ICONS[name]);

const MARK = {
  X: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  O: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2"><circle cx="12" cy="12" r="7.5"/></svg>',
};

/**
 * Render a board. opts: { pick, pass, correct:Set|Array, last, win:Array, ghost:{index,p}, onClick(i), thinking }
 */
export function boardEl(cells, N, opts = {}) {
  const correct = new Set(opts.correct || []);
  const win = new Set(opts.win || []);
  const el = h('div', { class: `board${opts.onClick ? ' interactive' : ''}`, 'data-n': N, style: { gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${N}, minmax(0, 1fr))` }, role: 'group', 'aria-label': `${N} by ${N} board` });
  for (let i = 0; i < N * N; i++) {
    const v = cells[i];
    const cls = ['sq', v === '.' ? 'empty' : v];
    if (correct.has(i) && v === '.') cls.push('correct');
    if (opts.pick === i) cls.push('pick', opts.pass === true ? 'pass' : opts.pass === false ? 'fail' : '');
    if (opts.last === i) cls.push('last');
    if (win.has(i)) cls.push('win');
    if (opts.thinking === i) cls.push('thinking');
    const label = `row ${Math.floor(i / N)} col ${i % N}: ${v === '.' ? 'empty' : v}`;
    const clickable = opts.onClick && (opts.editable || v === '.');
    const sq = h('div', { class: cls.join(' '), title: `${Math.floor(i / N)} ${i % N}`, 'aria-label': clickable ? label : null, role: clickable ? 'button' : null, tabindex: clickable ? 0 : null });
    if (v === 'X' || v === 'O') sq.append(svg(MARK[v]));
    else if (opts.ghost && opts.ghost.index === i) { sq.classList.add('ghost', opts.ghost.p); sq.append(svg(MARK[opts.ghost.p])); }
    if (opts.onClick) {
      sq.addEventListener('click', () => opts.onClick(i));
      sq.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(i); } });
    }
    el.append(sq);
  }
  return el;
}

/** URL for an API path; the static build serves pre-rendered files instead. */
export const apiUrl = (path) => (!STATIC ? path : path.endsWith('/source') ? `${path.slice(0, -7)}.bf` : `${path}.json`);

export async function api(path, opts = {}) {
  if (STATIC && path === '/api/runs/current') return { run: null };
  const res = await fetch(apiUrl(path), { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
  return data;
}

export function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

export const fmt = {
  int: (n) => (n ?? 0).toLocaleString('en-US'),
  compact: (n) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0),
  pct: (n) => `${(n ?? 0).toFixed(1)}%`,
  ms: (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : n < 1 ? '<1 ms' : `${Math.round(n)} ms`),
  date: (s) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  bytes: (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`),
};

export const gradeEl = (g, lg) => h('span', { class: `grade${lg ? ' lg' : ''}`, 'data-g': g, title: `Grade ${g}` }, g);
export const bar = (pct, cls = '') => h('div', { class: `bar ${cls}` }, h('i', { style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));
export const meter = (k, pct, v) => h('div', { class: 'meter' }, h('div', { class: 'k', title: k }, k), bar(pct), h('div', { class: 'v' }, v ?? fmt.pct(pct)));
export const loading = (text = 'Loading…') => h('div', { class: 'row muted', style: { padding: '24px 0' } }, h('div', { class: 'spinner' }), text);
export const errorBox = (e) => h('div', { class: 'notice error' }, h('strong', {}, 'Something went wrong. '), e.message || String(e));

/** Run a Brainfuck agent in a Web Worker (browser-side interpreter). */
export class Engine {
  constructor() { this.worker = null; this.seq = 0; this.pending = new Map(); this.loaded = new Set(); }
  ensure() {
    if (this.worker) return;
    this.worker = new Worker('/js/bf-worker.js', { type: 'module' });
    this.worker.onmessage = ({ data }) => { const p = this.pending.get(data.id); if (p) { this.pending.delete(data.id); p(data); } };
    this.worker.onerror = (e) => { for (const p of this.pending.values()) p({ ok: false, error: e.message || 'Worker crashed' }); this.pending.clear(); this.worker = null; this.loaded.clear(); };
  }
  async move(agentId, input) {
    this.ensure();
    let source;
    if (!this.loaded.has(agentId)) { source = await api(`/api/agents/${agentId}/source`); this.loaded.add(agentId); }
    const id = ++this.seq;
    return new Promise((resolve) => { this.pending.set(id, resolve); this.worker.postMessage({ id, agentId, source, input }); });
  }
}

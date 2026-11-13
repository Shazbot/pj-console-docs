import { parseLine, buildIndex, complete, matchCommand } from './complete.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCE_LABELS = {
  units: 'Units', ancillaries: 'Ancillaries', techs: 'Technologies', traits: 'Traits', skills: 'Skills',
  incidents: 'Incidents', dilemmas: 'Dilemmas', missions: 'Missions', rituals: 'Rituals', factions: 'Factions',
  agents: 'Agents', agent_subtypes: 'Agent subtypes', buildings: 'Buildings', ingredients: 'Ingredients',
  effect_bundles: 'Effect bundles', pooled_resources: 'Pooled resources',
};
const TARGET_LABELS = { character: 'Character', army: 'Army', settlement: 'Settlement', faction: 'Faction', diplomacy: 'Diplomacy' };
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollTo = (el, block = 'start') => el.scrollIntoView({ block, behavior: reduceMotion() ? 'auto' : 'smooth' });

// ---------- keys (lazy, memoised) ----------
const keyPromises = new Map();
const keyData = new Map();
const keyListeners = [];
let keyVersion = ''; // dump commit, so key files are refetched only when the dump changes
function loadKeys(src) {
  if (!keyPromises.has(src)) {
    keyPromises.set(src, fetch(`keys/${src}.json${keyVersion}`).then((r) => {
      if (!r.ok) throw new Error(`keys/${src}.json: ${r.status}`);
      return r.json();
    }).then((d) => { keyData.set(src, d); return d; }));
    keyPromises.get(src).catch(() => keyPromises.delete(src));
  }
  return keyPromises.get(src);
}
function getKeys(src) {
  if (keyData.has(src)) return keyData.get(src);
  loadKeys(src).then(() => keyListeners.forEach((f) => f(src)), () => {});
  return null;
}

// ---------- toast / copy ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}
async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'copy-fallback';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
  toast(`Copied ${label ?? text}`);
}

// ---------- theme ----------
function initTheme() {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('pjc-theme');
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  } catch { /* ignore */ }
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
    const cur = root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('pjc-theme', next); } catch { /* ignore */ }
  }));
}

// ---------- console ----------
function initConsole(commands, index) {
  const input = $('console-input'), list = $('console-suggest'), hint = $('console-hint'), copyBtn = $('console-copy');
  if (!input || !list) return;
  let items = [], active = 0, open = false, current = null;

  const mark = (text, range) => (range && range[1] > range[0]
    ? `${esc(text.slice(0, range[0]))}<mark>${esc(text.slice(range[0], range[1]))}</mark>${esc(text.slice(range[1]))}` : esc(text));

  function setOpen(v) {
    open = v;
    list.hidden = !v;
    input.setAttribute('aria-expanded', String(v));
    if (!v) input.removeAttribute('aria-activedescendant');
  }
  function renderList() {
    if (current && current.loading) {
      list.innerHTML = `<li class="sug sug-loading">Loading ${esc(SOURCE_LABELS[current.loading] || current.loading)}…</li>`;
      items = [];
      setOpen(true);
      return;
    }
    if (!items.length) { list.innerHTML = ''; setOpen(false); return; }
    list.innerHTML = items.map((it, i) => {
      const keyHtml = it.matchField === 'name' ? esc(it.label) : mark(it.label, it.match);
      const nameHtml = it.matchField === 'name' ? mark(it.detail, it.match) : esc(it.detail);
      return `<li role="option" class="sug" id="sug-${i}" aria-selected="${i === active}" data-i="${i}"><code class="sug-key">${keyHtml}</code><span class="sug-name">${nameHtml}</span><span class="sug-kind">${esc(it.kind === 'cmd' ? 'cmd' : it.kind)}</span></li>`;
    }).join('');
    setOpen(true);
    markActive();
  }
  function markActive() {
    list.querySelectorAll('.sug').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    const el = $(`sug-${active}`);
    if (el) { input.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
  }
  function renderHint(prefix) {
    const m = matchCommand(prefix, index);
    if (!m) { hint.innerHTML = ''; return; }
    const toks = m.syntax.match(/<[^>]*>|\[[^\]]*\]|\S+/g) || [];
    let slot = -1;
    const html = toks.map((t) => {
      if (/^[<\[]/.test(t)) { slot++; if (slot === m.argIndex) return `<b>${esc(t)}</b>`; }
      return esc(t);
    }).join(' ');
    hint.innerHTML = `<code class="hint-syntax">${html}</code> <span class="hint-summary">${esc(m.command.summary)}</span>`;
  }
  function update(keepOpen) {
    const line = input.value;
    const cursor = input.selectionStart ?? line.length;
    const seg = parseLine(line, cursor);
    const prefix = seg.segmentText.slice(0, Math.max(0, cursor - seg.segmentStart));
    renderHint(prefix);
    if (!line.trim()) { current = null; items = []; renderList(); return; }
    current = complete(prefix, index, getKeys);
    current.segStart = seg.segmentStart;
    if (!keepOpen) active = 0;
    items = current.items;
    if (active >= items.length) active = 0;
    if (suppressed) { setOpen(false); return; }
    renderList();
  }
  let suppressed = false;
  function accept(i) {
    const it = items[i];
    if (!it || !current) return;
    const line = input.value;
    const from = current.segStart + current.replaceFrom;
    const to = current.segStart + current.replaceTo;
    input.value = line.slice(0, from) + it.insert + line.slice(to);
    const pos = from + it.insert.length;
    input.setSelectionRange(pos, pos);
    suppressed = false;
    update();
    input.focus();
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'console-suggest');
  input.setAttribute('aria-expanded', 'false');
  input.addEventListener('input', () => { suppressed = false; update(); });
  input.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { suppressed = false; update(); } });
  input.addEventListener('click', () => { suppressed = false; update(); });
  input.addEventListener('blur', () => setOpen(false));
  input.addEventListener('focus', () => { if (input.value.trim()) { suppressed = false; update(true); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (open) { suppressed = true; setOpen(false); e.preventDefault(); } return; }
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % items.length; markActive(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; markActive(); e.preventDefault(); }
    else if (e.key === 'Tab' || e.key === 'Enter') { if (!e.shiftKey) { e.preventDefault(); accept(active); } }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.sug[data-i]');
    if (!li) return;
    e.preventDefault();
    accept(Number(li.dataset.i));
  });
  copyBtn?.addEventListener('click', () => { if (input.value) copy(input.value); });
  keyListeners.push(() => { if (current && current.loading) update(true); });

  return {
    setValue(v) {
      input.value = v;
      input.focus();
      input.setSelectionRange(v.length, v.length);
      suppressed = false;
      update();
      scrollTo(input, 'center');
    },
  };
}

// ---------- reference ----------
function initReference(doc, consoleApi, keyApi) {
  const listEl = $('cmd-list'), search = $('cmd-search'), cats = $('cmd-cats'), empty = $('cmd-empty');
  if (!listEl) return;
  const byCat = new Map(doc.categories.map((c) => [c.id, []]));
  doc.commands.forEach((c) => byCat.get(c.category)?.push(c));

  const article = (c) => {
    const badges = [];
    if (TARGET_LABELS[c.target]) badges.push(`<span class="badge badge-target" data-target="${esc(c.target)}">${TARGET_LABELS[c.target]}</span>`);
    if (c.singlePlayerOnly) badges.push('<span class="badge badge-sp">SP only</span>');
    if (c.unavailable) badges.push('<span class="badge badge-dev">Dev build</span>');
    const args = (c.args || []).map((a) => `<li><code>&lt;${esc(a.name)}&gt;</code>${a.optional ? ' optional' : ''}${a.keys ? ` <button type="button" class="keychip" data-keys="${esc(a.keys)}">${esc(a.keys)}</button>` : ''}</li>`).join('');
    return `<article class="cmd" id="cmd-${esc(c.id)}"><details><summary><code class="cmd-syntax">${esc(c.syntax[0])}</code><span class="cmd-summary">${esc(c.summary)}</span><span class="badges">${badges.join('')}</span></summary><div class="cmd-body">${c.syntax.length > 1 ? `<div class="cmd-syntaxes">${c.syntax.map((s) => `<code>${esc(s)}</code>`).join('')}</div>` : ''}${c.aliases?.length ? `<p class="cmd-aliases">Also: ${c.aliases.map((a) => `<code>${esc(a)}</code>`).join(' ')}</p>` : ''}${args ? `<ul class="cmd-args">${args}</ul>` : ''}${c.details ? `<p class="cmd-details">${esc(c.details)}</p>` : ''}${c.examples?.length ? `<div class="cmd-examples">${c.examples.map((x) => `<button type="button" class="example" data-cmd="${esc(x)}"><code>${esc(x)}</code></button>`).join('')}</div>` : ''}<a class="cmd-link" href="#cmd-${esc(c.id)}">#</a></div></details></article>`;
  };
  listEl.innerHTML = doc.categories.filter((c) => byCat.get(c.id).length).map((c) =>
    `<section class="cmd-group" data-cat="${esc(c.id)}"><h3 class="cmd-group-title">${esc(c.label)}</h3><p class="cmd-group-blurb">${esc(c.blurb)}</p>${byCat.get(c.id).map(article).join('')}</section>`).join('');

  const hay = new Map();
  doc.commands.forEach((c) => hay.set(c.id, [...c.syntax, ...(c.aliases || []), c.summary, c.details || '', c.id.replace(/-/g, ' ')].join('\n').toLowerCase()));
  let cat = 'all';
  if (cats) {
    cats.innerHTML = [['all', 'All', doc.commands.length], ...doc.categories.map((c) => [c.id, c.label, byCat.get(c.id).length])]
      .map(([id, label, n]) => `<button type="button" class="chip" data-cat="${esc(id)}" aria-pressed="${id === 'all'}">${esc(label)} <span class="chip-n">${n}</span></button>`).join('');
    cats.addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      cat = b.dataset.cat;
      cats.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      filter();
    });
  }
  function filter() {
    const q = (search?.value || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    listEl.querySelectorAll('.cmd-group').forEach((g) => {
      let any = 0;
      g.querySelectorAll('.cmd').forEach((a) => {
        const h = hay.get(a.id.slice(4));
        const ok = (cat === 'all' || g.dataset.cat === cat) && words.every((w) => h.includes(w));
        a.hidden = !ok;
        if (ok) any++;
      });
      g.hidden = !any;
      shown += any;
    });
    if (empty) empty.hidden = shown > 0;
  }
  search?.addEventListener('input', filter);

  listEl.addEventListener('click', (e) => {
    const ex = e.target.closest('.example');
    if (ex) { e.preventDefault(); consoleApi?.setValue(ex.dataset.cmd); return; }
    const kc = e.target.closest('.keychip');
    if (kc) { e.preventDefault(); keyApi?.setSource(kc.dataset.keys); const k = $('keys'); if (k) scrollTo(k); return; }
    if (e.target.closest('.cmd-link')) e.stopPropagation();
  });

  function openHash() {
    if (!/^#cmd-/.test(location.hash)) return;
    let el = null;
    try { el = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { /* ignore */ }
    if (!el) return;
    if (el.hidden) { if (search) search.value = ''; cat = 'all'; cats?.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cat === 'all'))); filter(); }
    const d = el.querySelector('details');
    if (d) d.open = true;
    scrollTo(el);
  }
  window.addEventListener('hashchange', openHash);
  openHash();
}

// ---------- key browser ----------
function initKeyBrowser(meta) {
  const sel = $('key-source'), filterEl = $('key-filter'), countEl = $('key-count'), listEl = $('key-list'), more = $('key-more');
  if (!sel || !listEl) return;
  const sources = [...Object.keys(SOURCE_LABELS), ...Object.keys(meta.counts)].filter((s, i, a) => s in meta.counts && a.indexOf(s) === i);
  sel.innerHTML = sources.map((s) => `<option value="${esc(s)}">${esc(SOURCE_LABELS[s] || s)} (${meta.counts[s].toLocaleString('en-US')})</option>`).join('');
  let limit = 200, token = 0;
  async function render() {
    const my = ++token, src = sel.value;
    let data;
    try { data = await loadKeys(src); } catch { countEl.textContent = 'Failed to load'; return; }
    if (my !== token) return;
    const q = filterEl.value.trim().toLowerCase();
    const matches = q ? data.filter((k) => k[0].toLowerCase().includes(q) || (k[1] && k[1].toLowerCase().includes(q))) : data;
    countEl.textContent = `${matches.length.toLocaleString('en-US')} of ${data.length.toLocaleString('en-US')}`;
    listEl.innerHTML = matches.slice(0, limit).map((k) => `<li><button type="button" class="key-row" data-key="${esc(k[0])}"><code class="key">${esc(k[0])}</code><span class="key-name">${esc(k[1] || '')}</span></button></li>`).join('');
    more.hidden = matches.length <= limit;
  }
  const reset = () => { limit = 200; render(); };
  sel.addEventListener('change', reset);
  filterEl.addEventListener('input', reset);
  more.addEventListener('click', () => { limit += 200; render(); });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('.key-row');
    if (b) copy(b.dataset.key);
  });
  render();
  return { setSource(src) { if (sources.includes(src)) { sel.value = src; filterEl.value = ''; reset(); } } };
}

// ---------- boot ----------
async function boot() {
  initTheme();
  const [doc, meta] = await Promise.all([
    // revalidate every load (cheap 304) so a redeploy shows up without waiting out Pages' 10 min cache
    fetch('data/commands.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('keys/meta.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  keyVersion = meta.dumpCommit ? `?v=${meta.dumpCommit.slice(0, 7)}` : '';
  const index = buildIndex(doc.commands);
  const keyApi = initKeyBrowser(meta);
  const consoleApi = initConsole(doc.commands, index);
  initReference(doc, consoleApi, keyApi);
  const dm = $('dump-meta');
  if (dm && meta.dumpCommit) {
    const sha = meta.dumpCommit;
    dm.textContent = 'Keys from WH3-Dump @ ';
    const a = document.createElement('a');
    a.href = `https://github.com/Shazbot/WH3-Dump/commit/${sha}`;
    a.textContent = sha.slice(0, 7);
    a.rel = 'noopener';
    dm.appendChild(a);
    dm.appendChild(document.createTextNode(meta.dumpDate ? ` (${meta.dumpDate})` : ''));
  }
}
boot().catch((e) => console.error('pj_console docs failed to start', e));

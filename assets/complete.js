// Pure completion logic for the pj_console command box. No DOM access.

const MAX_ITEMS = 50;
const TOKEN_RE = /<[^>]*>|\[[^\]]*\]|\S+/g;

/** Split a console line into the ';' separated segment containing the cursor.
 *  Mirrors the mod: a line starting with "lua " is never split. */
export function parseLine(line, cursor = line.length) {
  cursor = Math.max(0, Math.min(cursor, line.length));
  if (/^\s*lua\s/.test(line)) return { segmentStart: 0, segmentEnd: line.length, segmentText: line };
  let start = 0;
  for (;;) {
    const semi = line.indexOf(';', start);
    const end = semi < 0 ? line.length : semi;
    if (cursor <= end || semi < 0) return { segmentStart: start, segmentEnd: end, segmentText: line.slice(start, end) };
    start = semi + 1;
  }
}

/** Precompute literal-word prefixes and argument slots for every syntax. */
export function buildIndex(commands) {
  const entries = [];
  const byId = new Map();
  for (const command of commands) {
    byId.set(command.id, command);
    const args = command.args || [];
    for (const syntax of command.syntax) {
      const tokens = syntax.match(TOKEN_RE) || [];
      const words = [];
      let i = 0;
      while (i < tokens.length && !/^[<\[]/.test(tokens[i])) words.push(tokens[i++].toLowerCase());
      if (!words.length) continue;
      const slots = [];
      for (; i < tokens.length; i++) {
        const t = tokens[i];
        if (!/^[<\[]/.test(t)) continue;
        const optional = t[0] === '[';
        const name = t.slice(1, -1).replace(/\.\.\.$/, '').trim();
        const arg = args.find((a) => a.name === name) || args.find((a) => a.name === name.split('|')[0]);
        slots.push({ name, optional, keys: arg && arg.keys ? arg.keys : null });
      }
      entries.push({ command, syntax, words, phrase: words.join(' '), slots });
    }
  }
  return { entries, byId };
}

function tokenize(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return tokens;
}

const lc = (s) => s.toLowerCase();

function commandItems(text, index) {
  const lead = text.length - text.trimStart().length;
  const q = lc(text.slice(lead)).replace(/\s+/g, ' ');
  const scored = [];
  const seen = new Set();
  for (const e of index.entries) {
    if (seen.has(e.phrase)) continue;
    let rank = -1;
    let at = e.phrase.indexOf(q);
    if (q === '' ) { rank = 0; at = 0; }
    else if (at === 0) rank = 0;
    else if (at > 0 && q.length >= 2) rank = 1;
    else {
      // alias words of the command (other syntaxes) so "add unit" finds au
      const alt = e.command.aliases && e.command.aliases.find((a) => lc(a).startsWith(q));
      if (alt) { rank = 2; at = 0; }
    }
    if (rank < 0) continue;
    seen.add(e.phrase);
    scored.push({ e, rank, at });
  }
  scored.sort((a, b) => a.rank - b.rank || a.e.phrase.length - b.e.phrase.length || (a.e.phrase < b.e.phrase ? -1 : 1));
  const items = scored.slice(0, MAX_ITEMS).map(({ e, rank, at }) => ({
    insert: e.phrase + (e.slots.length ? ' ' : ''),
    label: e.syntax,
    detail: e.command.summary,
    kind: 'cmd',
    command: e.command.id,
    ...(q && rank < 2 ? { match: [at, at + q.length] } : {}),
  }));
  return { kind: items.length ? 'command' : 'none', replaceFrom: lead, replaceTo: text.length, items };
}

/** Best literal match among completed words (the last word must be followed by whitespace). */
function argEntry(tokens, trailingSpace, index) {
  const completed = trailingSpace ? tokens.length : tokens.length - 1;
  let best = null;
  for (const e of index.entries) {
    const n = e.words.length;
    if (n > completed) continue;
    let ok = true;
    for (let i = 0; i < n; i++) if (lc(tokens[i].text) !== e.words[i]) { ok = false; break; }
    if (!ok) continue;
    const argIndex = completed - n;
    const fits = argIndex < e.slots.length;
    if (!best || n > best.e.words.length || (n === best.e.words.length && fits && !best.fits)) best = { e, argIndex, fits };
  }
  return best;
}

/** segmentText is the segment up to the cursor. Returns replace offsets relative to it. */
export function complete(segmentText, index, getKeys) {
  const tokens = tokenize(segmentText);
  const trailingSpace = segmentText.length === 0 || /\s$/.test(segmentText);
  const hit = tokens.length ? argEntry(tokens, trailingSpace, index) : null;
  if (!hit) return commandItems(segmentText, index);
  const { e, argIndex, fits } = hit;
  if (!fits) return { kind: 'none', command: e.command, replaceFrom: segmentText.length, replaceTo: segmentText.length, items: [] };
  const slot = e.slots[argIndex];
  const typing = trailingSpace ? null : tokens[tokens.length - 1];
  const replaceFrom = typing ? typing.start : segmentText.length;
  const replaceTo = segmentText.length;
  const base = { kind: 'arg', command: e.command, syntax: e.syntax, argIndex, arg: slot, replaceFrom, replaceTo, items: [] };
  if (!slot.keys) return base;
  const keys = getKeys(slot.keys);
  if (!keys) return { ...base, loading: slot.keys };
  const q = typing ? lc(typing.text) : '';
  const space = argIndex + 1 < e.slots.length ? ' ' : '';
  const items = [];
  const mk = (k, rank, match, field) => ({
    insert: k[0] + space, label: k[0], detail: k[1] || '', kind: slot.keys, rank,
    ...(match ? { match, matchField: field } : {}),
  });
  if (!q) {
    for (let i = 0; i < keys.length && items.length < MAX_ITEMS; i++) items.push(mk(keys[i], 0));
    return { ...base, items };
  }
  const prefix = [], sub = [], nameHit = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const kl = lc(k[0]);
    const at = kl.indexOf(q);
    if (at === 0) prefix.push(mk(k, 0, [0, q.length], 'key'));
    else if (at > 0) sub.push(mk(k, 1, [at, at + q.length], 'key'));
    else if (k[1]) {
      const n = lc(k[1]).indexOf(q);
      if (n >= 0) nameHit.push(mk(k, 2, [n, n + q.length], 'name'));
    }
  }
  const sorted = [...prefix, ...sub, ...nameHit];
  return { ...base, items: sorted.slice(0, MAX_ITEMS) };
}

/** Best command for the hint line. Returns {command, syntax, argIndex} or null. */
export function matchCommand(segmentText, index) {
  const tokens = tokenize(segmentText);
  if (!tokens.length) return null;
  const trailingSpace = /\s$/.test(segmentText);
  let best = null;
  for (const e of index.entries) {
    const n = e.words.length;
    if (n > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < n; i++) if (lc(tokens[i].text) !== e.words[i]) { ok = false; break; }
    if (!ok) continue;
    const argTokens = tokens.length - n;
    const argIndex = trailingSpace ? argTokens : Math.max(argTokens - 1, 0);
    const diff = Math.abs(e.slots.length - argTokens);
    if (!best || n > best.n || (n === best.n && diff < best.diff)) best = { e, n, diff, argIndex: argTokens === 0 && !trailingSpace ? -1 : argIndex };
  }
  if (best) return { command: best.e.command, syntax: best.e.syntax, argIndex: best.argIndex, entry: best.e };
  const c = commandItems(segmentText, index);
  if (c.items.length) {
    const e = index.entries.find((x) => x.phrase + (x.slots.length ? ' ' : '') === c.items[0].insert && x.command.id === c.items[0].command);
    if (e) return { command: e.command, syntax: e.syntax, argIndex: -1, entry: e };
  }
  return null;
}

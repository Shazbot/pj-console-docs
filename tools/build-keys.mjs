// Builds keys/<source>.json and keys/meta.json from a local WH3-Dump checkout (read-only).
// Usage: node tools/build-keys.mjs [--dump <path>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const di = args.indexOf('--dump');
let dump = (di >= 0 ? args[di + 1] : process.env.WH3DUMP) || 'K:/projects/wh3dump';

function normPath(p) {
  const win = process.platform === 'win32';
  let m = p.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (m && win) return `${m[1].toUpperCase()}:/${m[2]}`;
  m = p.match(/^([a-z]):[\\/](.*)$/i);
  if (m && !win) return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
  return p;
}
dump = normPath(dump);

const git = (...a) => execFileSync('git', ['-C', dump, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function readTsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const header = lines[0].split('\t');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.startsWith('#')) continue;
    rows.push(l.split('\t'));
  }
  return { header, rows };
}

function readTable(table) {
  const dir = path.join(dump, 'db', table);
  if (!fs.existsSync(dir)) { console.warn(`warn: missing table ${table}`); return []; }
  const out = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.tsv')).sort()) {
    const { header, rows } = readTsv(path.join(dir, f));
    for (const r of rows) {
      const o = {};
      header.forEach((h, i) => { o[h] = r[i] ?? ''; });
      out.push(o);
    }
  }
  return out;
}

function clean(s) {
  return s
    .replace(/\[\[\/?[^\]]*\]\]/g, '')
    .replace(/\{\{tr:[^}]*\}\}/g, '')
    .replace(/\|\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const locCache = new Map();
function loc(name) {
  if (locCache.has(name)) return locCache.get(name);
  const m = new Map();
  const f = path.join(dump, 'text', 'db', `${name}__.loc.tsv`);
  if (!fs.existsSync(f)) console.warn(`warn: missing loc ${name}`);
  else {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/).slice(1)) {
      if (!l || l.startsWith('#')) continue;
      const t = l.split('\t');
      if (t[0] && t[1] !== undefined && !m.has(t[0])) m.set(t[0], clean(t[1]));
    }
  }
  locCache.set(name, m);
  return m;
}

// Simple sources: table, key column, loc file, loc key prefix (null = no names).
const simple = {
  ancillaries: ['ancillaries_tables', 'key', 'ancillaries', 'ancillaries_onscreen_name_'],
  techs: ['technologies_tables', 'key', 'technologies', 'technologies_onscreen_name_'],
  skills: ['character_skills_tables', 'key', 'character_skills', 'character_skills_localised_name_'],
  incidents: ['incidents_tables', 'key', 'incidents', 'incidents_localised_title_'],
  dilemmas: ['dilemmas_tables', 'key', 'dilemmas', 'dilemmas_localised_title_'],
  missions: ['missions_tables', 'key', 'missions', 'missions_localised_title_'],
  rituals: ['rituals_tables', 'key', 'rituals', 'rituals_display_name_'],
  factions: ['factions_tables', 'key', 'factions', 'factions_screen_name_'],
  agents: ['agents_tables', 'key', null, null],
  agent_subtypes: ['agent_subtypes_tables', 'key', 'agent_subtypes', 'agent_subtypes_onscreen_name_override_'],
  // legend spawns from unique_agents_tables, keyed by agent subtype
  unique_agents: ['unique_agents_tables', 'agent_subtype', 'agent_subtypes', 'agent_subtypes_onscreen_name_override_'],
  ingredients: ['cooking_ingredients_tables', 'key', 'cooking_ingredients', 'cooking_ingredients_display_text_'],
  effect_bundles: ['effect_bundles_tables', 'key', 'effect_bundles', 'effect_bundles_localised_title_'],
  pooled_resources: ['pooled_resources_tables', 'key', 'pooled_resources', 'pooled_resources_display_name_'],
  slot_sets: ['slot_sets_tables', 'key', null, null],
  recruitment_sources: ['recruitment_sources_tables', 'key', null, null],
};

const sources = {};

for (const [src, [table, col, locName, prefix]] of Object.entries(simple)) {
  const L = locName ? loc(locName) : null;
  sources[src] = readTable(table).map((r) => [r[col], L ? L.get(prefix + r[col]) : undefined]);
}

// Minor cults have no DB table; the game defines them in MINOR_CULT_LIST (same source the mod reads).
{
  const f = path.join(dump, 'script', 'campaign', 'wh3_campaign_minor_cults.lua');
  if (!fs.existsSync(f)) { console.warn('warn: missing wh3_campaign_minor_cults.lua'); sources.minor_cults = []; }
  else {
    const lua = fs.readFileSync(f, 'utf8');
    const start = lua.indexOf('MINOR_CULT_LIST');
    const end = lua.indexOf('\n}', start);
    const block = start >= 0 ? lua.slice(start, end < 0 ? undefined : end) : '';
    sources.minor_cults = [...block.matchAll(/\{\s*key\s*=\s*"([^"]+)"/g)].map((m) => [m[1], undefined]);
    if (!sources.minor_cults.length) console.warn('warn: no minor cults parsed');
  }
}

// units
{
  const L = loc('land_units');
  sources.units = readTable('main_units_tables').map((r) => [r.unit, L.get(`land_units_onscreen_name_${r.land_unit}`)]);
}

// traits: name of the lowest level row
{
  const L = loc('character_trait_levels');
  const lowest = new Map();
  for (const r of readTable('character_trait_levels_tables')) {
    const lvl = Number(r.level);
    const cur = lowest.get(r.trait);
    if (!cur || lvl < cur.lvl) lowest.set(r.trait, { lvl, key: r.key });
  }
  sources.traits = readTable('character_traits_tables').map((r) => {
    const lv = lowest.get(r.key);
    return [r.key, lv ? L.get(`character_trait_levels_onscreen_name_${lv.key}`) : undefined];
  });
}

// buildings: loc key = prefix + building + culture + subculture + faction (concatenated)
{
  const L = loc('building_culture_variants');
  const variants = new Map();
  for (const v of readTable('building_culture_variants_tables')) {
    if (!variants.has(v.building)) variants.set(v.building, []);
    variants.get(v.building).push(v);
  }
  const nameFor = (b) => {
    const vs = variants.get(b);
    if (!vs) return undefined;
    const ordered = [...vs].sort((x, y) => {
      const ex = !x.culture && !x.subculture && !x.faction ? 0 : 1;
      const ey = !y.culture && !y.subculture && !y.faction ? 0 : 1;
      return ex - ey;
    });
    for (const v of ordered) {
      const n = L.get(`building_culture_variants_name_${v.building}${v.culture}${v.subculture}${v.faction}`);
      if (n) return n;
    }
    return undefined;
  };
  sources.buildings = readTable('building_levels_tables').map((r) => [r.level_name, nameFor(r.level_name) ?? nameFor(r.building_instance_key)]);
}

// write
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const outDir = path.join(root, 'keys');
fs.mkdirSync(outDir, { recursive: true });
const counts = {}, named = {}, bytes = {};
for (const src of Object.keys(sources).sort()) {
  const seen = new Map();
  for (const [k, n] of sources[src]) {
    if (!k) continue;
    if (!seen.has(k) || (!seen.get(k) && n)) seen.set(k, n || '');
  }
  const arr = [...seen.entries()].sort((a, b) => cmp(a[0], b[0])).map(([k, n]) => (n ? [k, n] : [k]));
  const json = JSON.stringify(arr);
  fs.writeFileSync(path.join(outDir, `${src}.json`), json);
  counts[src] = arr.length;
  named[src] = arr.filter((e) => e.length > 1).length;
  bytes[src] = Buffer.byteLength(json);
}

let dumpCommit = 'unknown', dumpDate = '';
try {
  dumpCommit = git('rev-parse', 'HEAD');
  dumpDate = git('log', '-1', '--format=%cs');
  try {
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    if (ahead > 0) console.warn(`warn: dump HEAD is ${ahead} commit(s) not in origin/main; push it or the footer commit link will 404`);
  } catch { console.warn('warn: could not compare dump HEAD with origin/main'); }
  try {
    if (git('status', '--porcelain', '--', 'db', 'text/db')) console.warn('warn: dump has uncommitted changes under db/ or text/db/; meta.dumpCommit will not describe the data');
  } catch { /* ignore */ }
} catch { console.warn('warn: could not read dump git info'); }

fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ dumpCommit, dumpDate, builtAt: new Date().toISOString(), counts, named }, null, 1) + '\n');

console.log(`dump: ${dump} @ ${dumpCommit.slice(0, 7)} (${dumpDate})`);
console.log('source'.padEnd(18) + 'count'.padStart(7) + 'named'.padStart(7) + 'bytes'.padStart(9));
for (const s of Object.keys(counts)) console.log(s.padEnd(18) + String(counts[s]).padStart(7) + String(named[s]).padStart(7) + String(bytes[s]).padStart(9));

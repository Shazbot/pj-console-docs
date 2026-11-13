// Verifies data/commands.json against the patterns in pj_console.lua.
// Usage: node tools/check-commands.mjs [--lua <path>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const li = args.indexOf('--lua');
let luaPath = li >= 0 ? args[li + 1] : null;
let tmpDir = null;

if (!luaPath) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjc-'));
  luaPath = path.join(tmpDir, 'pj_console.lua');
  const cli = process.env.WHMM_CLI || 'K:/projects/whmm/dist/cli/main.js';
  try {
    execFileSync(process.execPath, [cli, 'pack', 'read', 'pj_console.pack', 'script/campaign/mod/pj_console.lua', '--output', luaPath], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (e) {
    console.error('failed to read the Lua from pj_console.pack; pass --lua <path>');
    process.exit(2);
  }
}

const lua = fs.readFileSync(luaPath, 'utf8').split(/\r?\n/);
if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
const start = lua.findIndex((l) => /^local data = \{/.test(l));
if (start < 0) { console.error('`local data = {` not found'); process.exit(2); }
const luaPatterns = new Set();
for (let i = start + 1; i < lua.length && !/^\}/.test(lua[i]); i++) {
  const m = lua[i].match(/^\s*\["(.*)"\]\s*=\s*[\w.]+,?\s*(--.*)?$/);
  if (m) luaPatterns.add(m[1]);
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'data', 'commands.json'), 'utf8'));
const errors = [];
const catIds = new Set(doc.categories.map((c) => c.id));
const sourceIds = new Set(fs.readdirSync(path.join(root, 'keys')).filter((f) => f.endsWith('.json') && f !== 'meta.json').map((f) => f.replace('.json', '')));
const targets = new Set(['character', 'army', 'settlement', 'faction', 'diplomacy', 'none']);
const ids = new Set();
const owner = new Map();
for (const c of doc.commands) {
  if (ids.has(c.id)) errors.push(`duplicate id ${c.id}`);
  ids.add(c.id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) errors.push(`bad id ${c.id}`);
  if (!catIds.has(c.category)) errors.push(`${c.id}: unknown category ${c.category}`);
  if (!targets.has(c.target)) errors.push(`${c.id}: unknown target ${c.target}`);
  if (!c.summary) errors.push(`${c.id}: missing summary`);
  if (!c.syntax?.length) errors.push(`${c.id}: missing syntax`);
  for (const a of c.args || []) if (a.keys && !sourceIds.has(a.keys)) errors.push(`${c.id}: unknown key source ${a.keys}`);
  for (const p of c.patterns || []) {
    if (owner.has(p)) errors.push(`pattern ${JSON.stringify(p)} in both ${owner.get(p)} and ${c.id}`);
    owner.set(p, c.id);
  }
}
const missing = [...luaPatterns].filter((p) => !owner.has(p));
const stale = [...owner.keys()].filter((p) => !luaPatterns.has(p));
for (const p of missing) errors.push(`missing from commands.json: ${p}`);
for (const p of stale) errors.push(`stale (not in lua): ${p}`);

console.log(`lua patterns: ${luaPatterns.size}, commands: ${doc.commands.length}, missing: ${missing.length}, stale: ${stale.length}`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');

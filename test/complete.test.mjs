import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLine, buildIndex, complete, matchCommand } from '../assets/complete.js';

const doc = JSON.parse(fs.readFileSync(new URL('../data/commands.json', import.meta.url), 'utf8'));
const index = buildIndex(doc.commands);
const fake = {
  units: [['wh_main_emp_inf_halberdiers', 'Halberdiers'], ['wh_main_emp_inf_swordsmen', 'Swordsmen']],
  effect_bundles: [['wh_main_bundle', 'Big Bundle'], ['xx_other', 'The wh_ thing']],
  rituals: [['wh_ritual_a', 'Ritual A']],
};
const getKeys = (s) => fake[s] || null;

test('au arg completion uses units', () => {
  const r = complete('au wh_main_emp_inf_', index, getKeys);
  assert.equal(r.kind, 'arg');
  assert.equal(r.arg.keys, 'units');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].insert, 'wh_main_emp_inf_halberdiers ');
  assert.equal(r.replaceFrom, 3);
});

test('chained segment selects second command', () => {
  const line = 'gg; eb wh_';
  const seg = parseLine(line, line.length);
  assert.equal(seg.segmentText, ' eb wh_');
  const r = complete(seg.segmentText, index, getKeys);
  assert.equal(r.arg.keys, 'effect_bundles');
  assert.equal(r.items[0].label, 'wh_main_bundle');
  assert.equal(r.items[1].label, 'xx_other');
  assert.equal(r.items[1].matchField, 'name');
});

test('first segment when cursor is in it', () => {
  assert.equal(parseLine('gg; eb wh_', 1).segmentText, 'gg');
});

test('lua lines are not split', () => {
  const s = parseLine('lua x;y', 7);
  assert.equal(s.segmentText, 'lua x;y');
});

test('aliases resolve to the same command', () => {
  assert.equal(matchCommand('gg', index).command.id, 'give-gold');
  assert.equal(matchCommand('give gold', index).command.id, 'give-gold');
  assert.equal(matchCommand('give gold 5', index).argIndex, 0);
});

test('giv offers give gold/region/slaves', () => {
  const r = complete('giv', index, getKeys);
  assert.equal(r.kind, 'command');
  const ins = r.items.map((i) => i.insert.trim());
  for (const w of ['give gold', 'give region', 'give slaves']) assert.ok(ins.includes(w), w);
});

test('unlock ritual completes rituals', () => {
  const r = complete('unlock ritual ', index, getKeys);
  assert.equal(r.arg.keys, 'rituals');
  assert.equal(r.items[0].label, 'wh_ritual_a');
});

test('longest literal wins', () => {
  assert.equal(matchCommand('mov off', index).command.id, 'mov-off');
  assert.equal(matchCommand('mov', index).command.id, 'mov');
  assert.equal(matchCommand('dev unlock ritual x', index).command.id, 'dev-unlock-ritual');
});

test('not-yet-loaded keys report loading', () => {
  const r = complete('tech ', index, () => null);
  assert.equal(r.loading, 'techs');
  assert.equal(r.items.length, 0);
});

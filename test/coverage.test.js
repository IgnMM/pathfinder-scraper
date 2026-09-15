import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAppEntityNames, diffCoverage } from '../src/coverage.js';

const SAMPLE_APP_SOURCE = `
const MODIFIERS = [
// ---------------- FEATS ----------------
{id:'power-attack',name:'Power Attack',category:'feat',source:'Core Rulebook',
 desc:'contains a name: field that must not be confused for a real entry'},
{id:'weapon-focus',name:'Weapon Focus',category:'feat',source:'Core Rulebook'},
// ---------------- TRAITS ----------------
{id:'reactionary',name:'Reactionary',category:'trait',source:'Core Rulebook'},
];`;

test('extractAppEntityNames pulls only name/category pairs for the requested entity type', () => {
  const feats = extractAppEntityNames(SAMPLE_APP_SOURCE, 'feat');
  const traits = extractAppEntityNames(SAMPLE_APP_SOURCE, 'trait');
  assert.deepEqual([...feats].sort(), ['Power Attack', 'Weapon Focus']);
  assert.deepEqual([...traits].sort(), ['Reactionary']);
});

test('extractAppEntityNames is not fooled by an unrelated name: field inside a desc string', () => {
  const feats = extractAppEntityNames(SAMPLE_APP_SOURCE, 'feat');
  assert.ok(!feats.has('field'), 'must not match text inside desc: strings that happen to contain "name:"');
});

test('diffCoverage reports missing (AoN has, app lacks) and extra (app has, AoN listing does not) names, case/whitespace-insensitively', () => {
  const canonical = ['Power Attack', 'Weapon Focus', 'Toughness'];
  const appNames = new Set(['power attack', '  Weapon Focus  ', 'Made-Up Feat']);
  const diff = diffCoverage(canonical, appNames);
  assert.equal(diff.canonicalTotal, 3);
  assert.deepEqual(diff.missing, ['Toughness']);
  assert.deepEqual(diff.extra, ['Made-Up Feat']);
  assert.equal(diff.matched, 2);
});

test('diffCoverage with full coverage reports zero missing', () => {
  const canonical = ['Alertness', 'Combat Reflexes'];
  const appNames = new Set(['Alertness', 'Combat Reflexes']);
  const diff = diffCoverage(canonical, appNames);
  assert.deepEqual(diff.missing, []);
  assert.equal(diff.matched, 2);
});

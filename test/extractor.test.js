import assert from 'node:assert/strict';
import test from 'node:test';
import { extractDocument } from '../src/extractor.js';

const page = {
  pageType: 'archetype',
  classId: 'fighter',
  className: 'Fighter',
  archetypeName: 'Test Archer',
  requestedUrl: 'https://aonprd.com/ArchetypeDisplay.aspx?FixedName=Fighter%20Test%20Archer',
  canonicalUrl: 'https://aonprd.com/ArchetypeDisplay.aspx?FixedName=Fighter%20Test%20Archer',
  cachedFile: 'test.html',
  sha256: 'raw-hash',
  downloadedAt: '2026-09-15T00:00:00.000Z'
};

test('inline formatting does not truncate a documentary section', () => {
  const html = `<html><body><span id="ctl_DataListTypes_LabelName_0">
    Introductory source paragraph.<br><br>
    <b>Arcane Training (Ex)</b>: At 2nd level, choose spells from the <i>bloodrager spell list</i> (including linked <a href="Spells.aspx">spells</a>). This replaces bravery.
    <br><br><b>Second Feature</b>: At 4th level, use this as a move action.
  </span></body></html>`;
  const result = extractDocument(html, page, 'https://aonprd.com/');
  assert.equal(result.sections.length, 2);
  assert.match(result.sections[0].mechanicalText, /bloodrager spell list \(including linked spells\)/);
  assert.deepEqual(result.sections[0].literalMarkers.replacementMentions, ['This replaces bravery.']);
  assert.deepEqual(result.sections[1].literalMarkers.actionMentions, ['as a move action']);
});

test('the same extractor supports non-class entities such as feats', () => {
  const html = `<span id="x_DataListTypes_LabelName_1"><b>Power Attack</b><br><b>Benefit</b>: Trade accuracy for damage.</span>`;
  const result = extractDocument(html, {
    ...page,
    pageType: 'feat',
    entityType: 'feat',
    entityName: 'Power Attack',
    classId: undefined,
    className: undefined,
    archetypeName: undefined
  }, 'https://aonprd.com/');
  assert.equal(result.id, 'feat:power-attack');
  assert.equal(result.entityType, 'feat');
  assert.equal(result.parentClassId, null);
  assert.equal(result.sections[0].heading, 'Benefit');
});

test('untyped headings become independent sections', () => {
  const html = `<span id="x_DataListTypes_LabelName_2">
    <b>Weapon and Armor Proficiency</b>: The archetype changes its proficiencies.
    <b>Special Power (Su)</b>: At 5th level, it gains a supernatural ability.
  </span>`;
  const result = extractDocument(html, page, 'https://aonprd.com/');
  assert.deepEqual(result.sections.map(section => section.heading), ['Weapon and Armor Proficiency', 'Special Power']);
  assert.deepEqual(result.sections.map(section => section.rulesType), [null, 'Su']);
});

test('introductory text is source text and never generated', () => {
  const html = `<span id="x_DataListTypes_LabelName_1"><b>Test Archer</b><br><b>Source</b> <a href="book">Test Book pg. 12</a><br>An exact introduction from the page.<br><br><b>Feature (Ex)</b>: Rules.</span>`;
  const result = extractDocument(html, page, 'https://aonprd.com/');
  assert.match(result.introductoryText, /exact introduction from the page/);
  assert.doesNotMatch(result.introductoryText, /published in/);
  assert.doesNotMatch(result.introductoryText, /Test Book/);
  assert.equal(result.sourceCitationText, 'Test Book pg. 12');
});

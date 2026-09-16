import assert from 'node:assert/strict';
import test from 'node:test';
import { Downloader } from '../src/downloader.js';

test('a collection profile discovers and deduplicates feat pages', () => {
  const downloader = new Downloader({}, '/unused');
  const html = `
    <a href="FeatDisplay.aspx?ItemName=Power%20Attack">Power Attack</a>
    <a href="FeatDisplay.aspx?ItemName=Power%20Attack">Power Attack duplicate</a>
    <a href="SpellDisplay.aspx?ItemName=Haste">Haste</a>`;
  const entities = downloader.discoverCollectionEntities(html, 'https://aonprd.com/Feats.aspx', {
    detailPath: 'FeatDisplay.aspx',
    detailParameter: 'ItemName'
  });
  assert.equal(entities.length, 1);
  assert.equal(entities[0].canonicalName, 'Power Attack');
  assert.equal(entities[0].url, 'https://aonprd.com/FeatDisplay.aspx?ItemName=Power%20Attack');
});

test('discovered entity name always uses the canonical (URL) name, never the anchor\'s own visible text', () => {
  // Regression test for a real bug: AoN's Traits.aspx?Type=X category pages
  // render every row's clickable link as the generic text "Link", not the
  // trait's actual name (the name appears elsewhere in the row, not inside
  // the anchor itself). A real full scrape produced entityName "Link" for
  // every one of ~1978 traits before this was fixed, which then collided
  // into a single duplicate entityId "trait:link" for all of them.
  const downloader = new Downloader({}, '/unused');
  const html = `<tr><td>Absalom Bouncer</td><td><a href="TraitDisplay.aspx?ItemName=Absalom%20Bouncer">Link</a></td></tr>
    <tr><td>Reactionary</td><td><a href="TraitDisplay.aspx?ItemName=Reactionary">Link</a></td></tr>`;
  const entities = downloader.discoverCollectionEntities(html, 'https://aonprd.com/Traits.aspx?Type=Campaign', {
    detailPath: 'TraitDisplay.aspx',
    detailParameter: 'ItemName'
  });
  assert.equal(entities.length, 2);
  assert.deepEqual(entities.map(e => e.name).sort(), ['Absalom Bouncer', 'Reactionary']);
  assert.ok(entities.every(e => e.name !== 'Link'));
});

test('existing full-coverage IDs can be skipped without affecting index pages', () => {
  const downloader = new Downloader({}, '/unused');
  downloader.skipEntityIds = new Set(['feat:power-attack']);
  downloader.skipUrls = new Set();
  assert.equal(downloader.shouldSkipExisting('https://aonprd.com/FeatDisplay.aspx?ItemName=Power%20Attack', { entityId: 'feat:power-attack' }), true);
  assert.equal(downloader.shouldSkipExisting('https://aonprd.com/Feats.aspx', { pageType: 'collection-index' }), false);
});

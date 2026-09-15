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

test('existing full-coverage IDs can be skipped without affecting index pages', () => {
  const downloader = new Downloader({}, '/unused');
  downloader.skipEntityIds = new Set(['feat:power-attack']);
  downloader.skipUrls = new Set();
  assert.equal(downloader.shouldSkipExisting('https://aonprd.com/FeatDisplay.aspx?ItemName=Power%20Attack', { entityId: 'feat:power-attack' }), true);
  assert.equal(downloader.shouldSkipExisting('https://aonprd.com/Feats.aspx', { pageType: 'collection-index' }), false);
});

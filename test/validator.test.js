import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractDocument } from '../src/extractor.js';
import { sha256 } from '../src/util.js';
import { validateAll } from '../src/validator.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aon-scraper-test-'));
  const html = `<span id="x_DataListTypes_LabelName_1"><b>Test Feat</b><br><b>Benefit</b>: This complete sentence must survive extraction.</span>`;
  const page = {
    pageType: 'feat', entityType: 'feat', entityName: 'Test Feat',
    requestedUrl: 'https://aonprd.com/FeatDisplay.aspx?ItemName=Test%20Feat',
    canonicalUrl: 'https://aonprd.com/FeatDisplay.aspx?ItemName=Test%20Feat',
    cachedFile: 'feat.html', sha256: sha256(html), downloadedAt: '2026-09-15T00:00:00.000Z'
  };
  await fs.mkdir(path.join(root, 'raw-cache'), { recursive: true });
  await fs.mkdir(path.join(root, 'manifests'), { recursive: true });
  await fs.mkdir(path.join(root, 'documentary-json'), { recursive: true });
  await fs.writeFile(path.join(root, 'raw-cache', page.cachedFile), html);
  await fs.writeFile(path.join(root, 'manifests', 'pages.json'), JSON.stringify({ pages: { [page.requestedUrl]: page } }));
  const record = extractDocument(html, page, 'https://aonprd.com/');
  await fs.writeFile(path.join(root, 'documentary-json', 'entities.json'), JSON.stringify([record]));
  return { root, record };
}

test('validation compares the complete section, not a prefix', async t => {
  const { root, record } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const passing = await validateAll(root);
  assert.equal(passing.status, 'PASS');

  record.sections[0].mechanicalText = record.sections[0].mechanicalText.slice(0, 25);
  record.sections[0].sourceTextSha256 = sha256(record.sections[0].mechanicalText);
  await fs.writeFile(path.join(root, 'documentary-json', 'entities.json'), JSON.stringify([record]));
  const failing = await validateAll(root);
  assert.equal(failing.status, 'FAIL');
  assert.ok(failing.errors.some(error => error.includes('complete DOM-derived section mismatch')));
});

test('validation rejects an archetype discovered in the index but never downloaded', async t => {
  const { root } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifestFile = path.join(root, 'manifests', 'pages.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  manifest.pages.index = {
    pageType: 'archetype-index',
    discoveredEntityIds: ['fighter:missing-archetype']
  };
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const report = await validateAll(root);
  assert.equal(report.status, 'FAIL');
  assert.ok(report.errors.some(error => error.includes('discovered in index but absent')));
});

test('validation allows gaps in DOM source order caused by omitted empty headings', async t => {
  const { root, record } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  record.sections[0].sourceOrder = 3;
  await fs.writeFile(path.join(root, 'documentary-json', 'entities.json'), JSON.stringify([record]));
  const report = await validateAll(root);
  assert.equal(report.status, 'PASS');
});

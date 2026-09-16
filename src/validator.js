import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { extractDocument, normalizeText } from './extractor.js';
import { ensureDir, readJson, sha256, writeJsonAtomic } from './util.js';

export async function validateAll(root) {
  const manifest = await readJson(path.join(root, 'manifests', 'pages.json'), { pages: {} });
  const records = await readJson(path.join(root, 'documentary-json', 'entities.json'), []);
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const sourcePages = Object.values(manifest.pages).filter(page => !page.skippedExisting && !['archetype-index', 'collection-index'].includes(page.pageType));
  const expectedEntityIds = Object.values(manifest.pages)
    .filter(page => ['archetype-index', 'collection-index'].includes(page.pageType))
    .flatMap(page => page.discoveredEntityIds || []);

  for (const record of records) {
    if (ids.has(record.id)) errors.push(`${record.id}: duplicate entity ID`);
    ids.add(record.id);
    const page = sourcePages.find(item => item.cachedFile === record.provenance.cachedHtmlFile);
    if (!page) {
      errors.push(`${record.id}: cached page absent from manifest`);
      continue;
    }
    const html = await fs.readFile(path.join(root, 'raw-cache', page.cachedFile), 'utf8');
    if (sha256(html) !== record.provenance.rawHtmlSha256) errors.push(`${record.id}: raw HTML hash mismatch`);
    const normalizedPage = normalizeText(cheerio.load(html).html());
    const independentlyExtracted = extractDocument(html, page, page.canonicalUrl || page.requestedUrl);
    if (record.sections.length !== independentlyExtracted.sections.length) {
      errors.push(`${record.id}: section count differs from cached source (${record.sections.length}/${independentlyExtracted.sections.length})`);
    }
    if (!record.sections.length) warnings.push(`${record.id}: no documentary sections detected`);
    let previousSourceOrder = 0;
    for (const [sectionIndex, section] of record.sections.entries()) {
      // AoN sometimes places empty heading nodes between real documentary
      // sections. The extractor preserves their DOM positions, so valid
      // sourceOrder values can contain gaps (for example 1, 3, 5, 7, 9).
      // What matters is that retained sections remain strictly ordered.
      if (!Number.isInteger(section.sourceOrder) || section.sourceOrder <= previousSourceOrder) {
        errors.push(`${record.id}: invalid section order at ${section.heading}`);
      }
      previousSourceOrder = section.sourceOrder;
      if (!section.mechanicalText) errors.push(`${record.id}: empty section ${section.heading}`);
      if (!normalizedPage.includes(section.mechanicalText)) errors.push(`${record.id}: complete section not found in normalized cached HTML: ${section.heading}`);
      const sourceSection = independentlyExtracted.sections[sectionIndex];
      if (!sourceSection || sourceSection.heading !== section.heading || sourceSection.mechanicalText !== section.mechanicalText) {
        errors.push(`${record.id}: complete DOM-derived section mismatch: ${section.heading}`);
      }
      if (sha256(section.mechanicalText) !== section.sourceTextSha256) errors.push(`${record.id}: section hash mismatch: ${section.heading}`);
      if (/Site Owner|Email Spam Checker/i.test(section.mechanicalText)) errors.push(`${record.id}: footer contamination: ${section.heading}`);
      for (const group of Object.values(section.literalMarkers)) {
        for (const literal of group) {
          if (!section.mechanicalText.includes(literal)) errors.push(`${record.id}: non-literal marker in ${section.heading}: ${literal}`);
        }
      }
    }
  }

  if (records.length !== sourcePages.length) errors.push(`Entity/page mismatch: ${records.length} records for ${sourcePages.length} source pages`);
  const recordIds = new Set(records.map(record => record.id));
  for (const expectedId of expectedEntityIds) {
    const manifestPage = Object.values(manifest.pages).find(page => page.entityId === expectedId);
    if (!manifestPage) errors.push(`${expectedId}: discovered in index but absent from download manifest`);
    else if (!manifestPage.skippedExisting && !recordIds.has(expectedId)) errors.push(`${expectedId}: downloaded entity is absent from documentary output`);
  }
  if ((await readJson(path.join(root, 'checkpoints', 'download.json'), { failures: [] })).failures.length) {
    errors.push('Download checkpoint contains unresolved failures');
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: errors.length ? 'FAIL' : 'PASS',
    counts: { sourcePages: sourcePages.length, entities: records.length, errors: errors.length, warnings: warnings.length },
    errors,
    warnings
  };
  const reportDirectory = path.join(root, 'reports');
  await ensureDir(reportDirectory);
  await writeJsonAtomic(path.join(reportDirectory, 'validation.json'), report);
  return report;
}

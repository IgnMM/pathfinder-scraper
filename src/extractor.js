import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ensureDir, readJson, resolveUrl, sha256, slug, writeJsonAtomic } from './util.js';

const EXCLUDED_HEADINGS = new Set(['source', 'contents', 'navigation', 'copyright']);

export function normalizeText(value) {
  const $ = cheerio.load(`<div id="normalise-root">${value || ''}</div>`);
  $('#normalise-root').find('br').replaceWith('\n');
  return $('#normalise-root').text()
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sourceCitation($, root) {
  let citation = null;
  root.find('b,strong').each((_, element) => {
    if (citation || normalizeText($(element).text()).toLowerCase() !== 'source') return;
    const linked = $(element).nextAll('a').first();
    if (linked.length) citation = normalizeText(linked.text());
  });
  return citation;
}

function cleanIntroductoryText(html, title) {
  const $ = cheerio.load(`<div id="intro-root">${html || ''}</div>`);
  const root = $('#intro-root');
  root.find('b,strong,h1,h2,h3,h4,h5,h6').each((_, element) => {
    const text = normalizeText($(element).text()).replace(/:\s*$/, '');
    if (text.toLowerCase() === 'source') {
      $(element).nextAll('a').first().remove();
      $(element).remove();
    } else if (text.toLowerCase() === title.toLowerCase()) {
      $(element).remove();
    }
  });
  return normalizeText(root.html()) || null;
}

function contentRoot($) {
  const labelled = $('[id*="DataListTypes_LabelName_"]').first();
  if (labelled.length) return labelled;
  const main = $('main, #main, #content, .content').first();
  return main.length ? main : $('body');
}

function headingInfo($, element) {
  const text = normalizeText($(element).text()).replace(/:\s*$/, '');
  if (!text || text.length > 140 || EXCLUDED_HEADINGS.has(text.toLowerCase())) return null;
  const typeMatch = text.match(/\s*\((Ex|Su|Sp)\)\s*$/i);
  const nextText = normalizeText(element.nextSibling?.data || $(element).next().text()).slice(0, 2);
  const structural = /^h[1-6]$/i.test(element.tagName || '');
  const looksLabelled = typeMatch || structural || nextText.startsWith(':');
  if (!looksLabelled) return null;
  return {
    heading: typeMatch ? text.slice(0, typeMatch.index).trim() : text,
    rulesType: typeMatch ? typeMatch[1][0].toUpperCase() + typeMatch[1].slice(1).toLowerCase() : null
  };
}

function extractLinks($, root, baseUrl) {
  const links = [];
  root.find('a[href]').addBack('a[href]').each((_, element) => {
    const label = normalizeText($(element).text());
    const href = $(element).attr('href');
    if (!label || !href || /^javascript:/i.test(href)) return;
    links.push({ label, url: resolveUrl(href, baseUrl) });
  });
  return links;
}

function extractTables($, root) {
  const tables = [];
  root.find('table').addBack('table').each((index, table) => {
    const rows = [];
    $(table).find('tr').each((_, row) => {
      const cells = $(row).children('th,td').map((__, cell) => normalizeText($(cell).html())).get();
      if (cells.length) rows.push(cells);
    });
    if (rows.length) tables.push({ sourceOrder: index + 1, rows });
  });
  return tables;
}

function literalMatches(text) {
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) || [];
  const matching = pattern => sentences.map(value => value.trim()).filter(value => pattern.test(value));
  return {
    replacementMentions: matching(/\breplaces?\b/i),
    alterationMentions: matching(/\b(alters?|modifies?)\b/i),
    levelMentions: [...new Set(text.match(/\b(?:at|starting at)\s+\d+(?:st|nd|rd|th)\s+level\b|\bevery\s+\d+\s+levels?\b/gi) || [])],
    actionMentions: [...new Set(text.match(/\bas an?\s+(?:immediate|swift|move|standard|full-round|free)\s+action\b/gi) || [])]
  };
}

export function extractDocument(html, pageRecord, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const root = contentRoot($).clone();
  root.find('script,style,noscript,nav,footer').remove();
  const title = pageRecord.entityName || pageRecord.archetypeName || pageRecord.className;
  const citationText = sourceCitation($, root);
  const sectionScope = pageRecord.className
    ? `${slug(pageRecord.className)}:${slug(pageRecord.archetypeName || pageRecord.className)}`
    : `${pageRecord.entityType || pageRecord.pageType}:${slug(pageRecord.entityName)}`;

  const candidates = [];
  root.find('b,strong,h1,h2,h3,h4,h5,h6').each((_, element) => {
    const info = headingInfo($, element);
    if (info && info.heading.toLowerCase() !== title.toLowerCase()) candidates.push({ element, ...info });
  });

  candidates.forEach((candidate, index) => {
    $(candidate.element).before(`<!--AON_SECTION_${index}-->`);
  });
  const markedHtml = root.html() || '';
  const parts = markedHtml.split(/<!--AON_SECTION_(\d+)-->/);
  const preambleHtml = parts[0] || '';
  const sections = [];

  for (let index = 1; index < parts.length; index += 2) {
    const sourceOrder = Number(parts[index]) + 1;
    const fragmentHtml = parts[index + 1] || '';
    const fragment$ = cheerio.load(`<div id="section-root">${fragmentHtml}</div>`, { decodeEntities: true });
    const fragmentRoot = fragment$('#section-root');
    const info = candidates[sourceOrder - 1];
    const mechanicalText = normalizeText(fragmentRoot.html());
    if (!mechanicalText) continue;
    sections.push({
      id: `${sectionScope}:${slug(info.heading)}`,
      heading: info.heading,
      rulesType: info.rulesType,
      sourceOrder,
      mechanicalText,
      links: extractLinks(fragment$, fragmentRoot, pageRecord.canonicalUrl || pageRecord.requestedUrl),
      tables: extractTables(fragment$, fragmentRoot),
      literalMarkers: literalMatches(mechanicalText),
      sourceTextSha256: sha256(mechanicalText)
    });
  }

  const classScoped = pageRecord.pageType === 'class' || pageRecord.pageType === 'archetype';
  const parentId = pageRecord.pageType === 'archetype' ? slug(pageRecord.className) : null;
  const entityId = pageRecord.pageType === 'class'
    ? slug(pageRecord.className)
    : parentId
      ? `${parentId}:${slug(title)}`
      : `${pageRecord.entityType || pageRecord.pageType}:${slug(title)}`;
  return {
    schemaVersion: 1,
    id: entityId,
    entityType: pageRecord.entityType || pageRecord.pageType,
    name: title,
    parentClassId: classScoped ? parentId : null,
    aonUrl: pageRecord.canonicalUrl || pageRecord.requestedUrl,
    sourceCitationText: citationText,
    introductoryText: cleanIntroductoryText(preambleHtml, title),
    sections,
    pageLinks: extractLinks($, root, pageRecord.canonicalUrl || pageRecord.requestedUrl),
    pageTables: extractTables($, root),
    provenance: {
      cachedHtmlFile: pageRecord.cachedFile,
      rawHtmlSha256: pageRecord.sha256,
      downloadedAt: pageRecord.downloadedAt
    },
    semanticInterpretationStatus: 'not-performed'
  };
}

export async function extractAll(config, root) {
  const manifest = await readJson(path.join(root, 'manifests', 'pages.json'), { pages: {} });
  const output = path.join(root, 'documentary-json');
  await ensureDir(output);
  const records = [];
  for (const pageRecord of Object.values(manifest.pages)) {
    if (['archetype-index', 'collection-index'].includes(pageRecord.pageType)) continue;
    if (pageRecord.skippedExisting) continue;
    const html = await fs.readFile(path.join(root, 'raw-cache', pageRecord.cachedFile), 'utf8');
    records.push(extractDocument(html, pageRecord, config.baseUrl));
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonAtomic(path.join(output, 'entities.json'), records);
  return records;
}

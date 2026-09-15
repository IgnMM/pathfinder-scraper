import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { cacheName, ensureDir, readJson, resolveUrl, sha256, sleep, slug, writeJsonAtomic } from './util.js';

export class Downloader {
  constructor(config, rootDirectory) {
    this.config = config;
    this.root = rootDirectory;
    this.cacheDirectory = path.join(this.root, 'raw-cache');
    this.manifestFile = path.join(this.root, 'manifests', 'pages.json');
    this.checkpointFile = path.join(this.root, 'checkpoints', 'download.json');
    this.lastRequestAt = 0;
  }

  async initialise() {
    await ensureDir(this.cacheDirectory);
    this.manifest = await readJson(this.manifestFile, { schemaVersion: 1, pages: {} });
    this.checkpoint = await readJson(this.checkpointFile, { schemaVersion: 1, completedUrls: [], failures: [] });
    this.completed = new Set(this.checkpoint.completedUrls);
    const coveragePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', this.config.existingCoverageFile);
    this.existingCoverage = await readJson(coveragePath, { entityIds: [], urls: [] });
    this.skipEntityIds = new Set(this.existingCoverage.entityIds || []);
    this.skipUrls = new Set(this.existingCoverage.urls || []);
  }

  shouldSkipExisting(url, metadata) {
    if (!metadata.entityId) return false;
    return this.skipUrls.has(url) || this.skipEntityIds.has(metadata.entityId);
  }

  async fetchWithRetry(url) {
    let lastError;
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt += 1) {
      const wait = Math.max(0, this.config.requestDelayMs - (Date.now() - this.lastRequestAt));
      if (wait) await sleep(wait);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      try {
        this.lastRequestAt = Date.now();
        const response = await fetch(url, {
          headers: { 'User-Agent': this.config.userAgent, Accept: 'text/html,application/xhtml+xml' },
          redirect: 'follow',
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { html: await response.text(), finalUrl: response.url };
      } catch (error) {
        lastError = error;
        if (attempt < this.config.maxRetries) await sleep(1000 * attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async cache(url, metadata = {}) {
    if (this.shouldSkipExisting(url, metadata)) {
      const record = { requestedUrl: url, skippedExisting: true, ...metadata };
      this.manifest.pages[url] = record;
      await this.persist();
      return record;
    }
    const existing = this.manifest.pages[url];
    if (existing && this.completed.has(url)) {
      try {
        await fs.access(path.join(this.cacheDirectory, existing.cachedFile));
        return existing;
      } catch {}
    }

    try {
      const { html, finalUrl } = await this.fetchWithRetry(url);
      const cachedFile = cacheName(url);
      await fs.writeFile(path.join(this.cacheDirectory, cachedFile), html, 'utf8');
      const record = {
        requestedUrl: url,
        canonicalUrl: finalUrl,
        cachedFile,
        sha256: sha256(html),
        downloadedAt: new Date().toISOString(),
        ...metadata
      };
      this.manifest.pages[url] = record;
      this.completed.add(url);
      this.checkpoint.completedUrls = [...this.completed];
      this.checkpoint.failures = this.checkpoint.failures.filter(item => item.url !== url);
      await this.persist();
      return record;
    } catch (error) {
      this.checkpoint.failures = this.checkpoint.failures.filter(item => item.url !== url);
      this.checkpoint.failures.push({ url, message: error.message, at: new Date().toISOString(), ...metadata });
      await this.persist();
      throw error;
    }
  }

  async persist() {
    await writeJsonAtomic(this.manifestFile, this.manifest);
    await writeJsonAtomic(this.checkpointFile, this.checkpoint);
  }

  async readCached(record) {
    return fs.readFile(path.join(this.cacheDirectory, record.cachedFile), 'utf8');
  }

  discoverArchetypes(html, indexUrl, className) {
    const $ = cheerio.load(html);
    const found = new Map();
    $('a[href*="ArchetypeDisplay.aspx"]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href || !/FixedName=/i.test(href)) return;
      const url = resolveUrl(href, indexUrl);
      const fixedName = new URL(url).searchParams.get('FixedName') || '';
      if (!fixedName.toLowerCase().startsWith(className.toLowerCase())) return;
      const name = $(element).text().trim() || fixedName.slice(className.length).trim();
      found.set(url, { name, fixedName });
    });
    return [...found.entries()].map(([url, item]) => ({ url, ...item }));
  }

  discoverCollectionEntities(html, indexUrl, profile) {
    const $ = cheerio.load(html);
    const found = new Map();
    $(`a[href*="${profile.detailPath}"]`).each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      const url = resolveUrl(href, indexUrl);
      const parsed = new URL(url);
      if (!parsed.pathname.toLowerCase().endsWith(`/${profile.detailPath.toLowerCase()}`)) return;
      const canonicalName = parsed.searchParams.get(profile.detailParameter);
      if (!canonicalName) return;
      const name = $(element).text().trim() || canonicalName;
      found.set(url, { name, canonicalName });
    });
    return [...found.entries()].map(([url, item]) => ({ url, ...item }));
  }

  async scrapeCollection(profileName, profile) {
    const discovered = new Map();
    for (const relativeIndexUrl of profile.indexUrls) {
      const indexUrl = resolveUrl(relativeIndexUrl, this.config.baseUrl);
      console.log(`[${profileName}] Downloading index ${indexUrl}`);
      const indexPage = await this.cache(indexUrl, { pageType: 'collection-index', profileName, entityType: profile.entityType });
      const entities = this.discoverCollectionEntities(await this.readCached(indexPage), indexUrl, profile);
      entities.forEach(entity => discovered.set(entity.url, entity));
    }
    const entities = [...discovered.values()];
    console.log(`[${profileName}] ${entities.length} entities discovered`);
    let position = 0;
    for (const entity of entities) {
      position += 1;
      console.log(`[${profileName}] ${position}/${entities.length}: ${entity.name}`);
      await this.cache(entity.url, {
        pageType: profile.entityType,
        entityType: profile.entityType,
        entityName: entity.name,
        entityId: `${profile.entityType}:${slug(entity.name)}`,
        canonicalName: entity.canonicalName,
        profileName
      });
    }
    return entities;
  }

  async scrapeClass(className) {
    const encoded = encodeURIComponent(className);
    const classId = slug(className);
    const classUrl = resolveUrl(`ClassDisplay.aspx?ItemName=${encoded}`, this.config.baseUrl);
    const indexUrl = resolveUrl(`Archetypes.aspx?Class=${encoded}`, this.config.baseUrl);
    console.log(`[${className}] Downloading class and archetype index`);
    const classPage = await this.cache(classUrl, { pageType: 'class', classId, className });
    const indexPage = await this.cache(indexUrl, { pageType: 'archetype-index', classId, className });
    const archetypes = this.discoverArchetypes(await this.readCached(indexPage), indexUrl, className);
    console.log(`[${className}] ${archetypes.length} archetypes discovered`);
    let position = 0;
    for (const archetype of archetypes) {
      position += 1;
      console.log(`[${className}] ${position}/${archetypes.length}: ${archetype.name}`);
      await this.cache(archetype.url, {
        pageType: 'archetype', classId, className, archetypeName: archetype.name,
        entityId: `${classId}:${slug(archetype.name)}`, fixedName: archetype.fixedName
      });
    }
    return { classPage, indexPage, archetypes };
  }
}

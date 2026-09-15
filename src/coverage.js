import fs from 'node:fs/promises';
import path from 'node:path';
import { Downloader } from './downloader.js';
import { writeJsonAtomic } from './util.js';

// Extracts {name, category} pairs out of a pathfinder-tools-style source file
// (e.g. calc/index.html), where every embedded feat/trait entry follows the
// pattern `name:'X',category:'feat'` (or 'trait') with the two fields
// immediately adjacent, in that order. Verified against the real file before
// relying on it: every single `category:'feat'`/`category:'trait'`
// occurrence in calc/index.html was captured this way with zero exceptions
// (366/366 feats, 218/218 traits) -- if that app file's own layout changes
// this pattern later, this extractor will start under-counting silently, so
// the coverage report's own appTotal should be sanity-checked against a
// fresh grep count when this is next run.
const NAME_CATEGORY_SOURCE = String.raw`name:\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*category:\s*(['"])(feat|trait)\3`;

export function extractAppEntityNames(sourceText, entityType) {
  const pattern = new RegExp(NAME_CATEGORY_SOURCE, 'g');
  const names = new Set();
  let match;
  while ((match = pattern.exec(sourceText))) {
    if (match[4] === entityType) names.add(match[2].replace(/\\(.)/g, '$1'));
  }
  return names;
}

// Cheap: one HTTP request per index URL (Feats.aspx is a single page; Traits
// only lists per category, so its profile carries one indexUrl per category).
// Does NOT cache every individual detail page -- use Downloader.scrapeCollection
// for that, separately, if the actual rules text is ever needed.
export async function discoverCanonicalNames(config, root, profileName) {
  const profile = config.collections?.[profileName];
  if (!profile) throw new Error(`Unknown collection profile: ${profileName}`);
  const downloader = new Downloader(config, root);
  await downloader.initialise();
  const entities = await downloader.discoverCollection(profileName, profile);
  return entities.map(entity => entity.canonicalName || entity.name);
}

function normaliseName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Pure diff: given the canonical AoN name list and the app's own extracted
// name set, reports what AoN has that the app doesn't (missing) and what the
// app has that AoN's current listing doesn't recognise (extra -- usually a
// renamed/errata'd entry, a 3rd-party/homebrew entry, or a typo, not
// necessarily wrong, but worth a human look).
export function diffCoverage(canonicalNames, appNames) {
  const canonicalByKey = new Map(canonicalNames.map(name => [normaliseName(name), name]));
  const appNameList = [...appNames];
  const appKeys = new Set(appNameList.map(normaliseName));

  const missing = [...canonicalByKey.entries()]
    .filter(([key]) => !appKeys.has(key))
    .map(([, original]) => original)
    .sort();
  const extra = appNameList
    .filter(name => !canonicalByKey.has(normaliseName(name)))
    .sort();

  return {
    canonicalTotal: canonicalByKey.size,
    appTotal: appKeys.size,
    matched: canonicalByKey.size - missing.length,
    missing,
    extra
  };
}

export async function runCoverageCheck(config, root, profileName, appFilePath) {
  const canonicalNames = await discoverCanonicalNames(config, root, profileName);
  const coverageDirectory = path.join(root, 'coverage');
  await writeJsonAtomic(
    path.join(coverageDirectory, `${profileName}-canonical.json`),
    { schemaVersion: 1, profileName, count: canonicalNames.length, names: [...canonicalNames].sort() }
  );

  let diff = null;
  if (appFilePath) {
    const sourceText = await fs.readFile(appFilePath, 'utf8');
    const entityType = config.collections[profileName].entityType;
    const appNames = extractAppEntityNames(sourceText, entityType);
    diff = diffCoverage(canonicalNames, appNames);
    await writeJsonAtomic(
      path.join(coverageDirectory, `${profileName}-diff.json`),
      { schemaVersion: 1, profileName, appFilePath, generatedAt: new Date().toISOString(), ...diff }
    );
  }
  return { canonicalNames, diff };
}

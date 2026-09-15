import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Downloader } from './downloader.js';
import { extractAll } from './extractor.js';
import { validateAll } from './validator.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const toolDirectory = path.resolve(scriptDirectory, '..');
const config = JSON.parse(await fs.readFile(path.join(toolDirectory, 'config.json'), 'utf8'));
const root = path.resolve(toolDirectory, config.workDirectory);
const [command = 'help', ...args] = process.argv.slice(2);

function argument(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

async function scrape(classes) {
  const downloader = new Downloader(config, root);
  await downloader.initialise();
  const failures = [];
  for (const className of classes) {
    try {
      await downloader.scrapeClass(className);
    } catch (error) {
      console.error(`[${className}] FAILED: ${error.message}`);
      failures.push({ className, message: error.message });
    }
  }
  if (failures.length) throw new Error(`${failures.length} class scrape(s) incomplete; rerun to resume`);
}

async function scrapeCollection(profileName) {
  const profile = config.collections?.[profileName];
  if (!profile) throw new Error(`Unknown collection profile: ${profileName}`);
  const downloader = new Downloader(config, root);
  await downloader.initialise();
  await downloader.scrapeCollection(profileName, profile);
}

if (command === 'scrape') {
  await scrape([argument('class', 'Fighter')]);
} else if (command === 'scrape-collection') {
  await scrapeCollection(argument('profile'));
} else if (command === 'extract') {
  const records = await extractAll(config, root);
  console.log(`Extracted ${records.length} documentary entity records.`);
} else if (command === 'validate') {
  const report = await validateAll(root);
  console.log(`${report.status}: ${report.counts.errors} errors, ${report.counts.warnings} warnings.`);
  if (report.status !== 'PASS') process.exitCode = 1;
} else if (command === 'pilot') {
  await scrape([argument('class', 'Fighter')]);
  await extractAll(config, root);
  const report = await validateAll(root);
  console.log(`${report.status}: ${report.counts.entities} entities, ${report.counts.errors} errors, ${report.counts.warnings} warnings.`);
  if (report.status !== 'PASS') process.exitCode = 1;
} else if (command === 'run') {
  await scrape(config.classes);
  await extractAll(config, root);
  const report = await validateAll(root);
  console.log(`${report.status}: ${report.counts.entities} entities, ${report.counts.errors} errors, ${report.counts.warnings} warnings.`);
  if (report.status !== 'PASS') process.exitCode = 1;
} else {
  console.log('Commands: pilot, run, scrape --class Fighter, scrape-collection --profile feats, extract, validate');
}

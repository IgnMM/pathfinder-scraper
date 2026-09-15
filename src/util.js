import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function slug(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function resolveUrl(href, baseUrl) {
  return new URL(href.replaceAll('&amp;', '&'), baseUrl).href;
}

export function cacheName(url) {
  const parsed = new URL(url);
  const readable = slug(`${parsed.pathname}-${parsed.searchParams.get('ItemName') || parsed.searchParams.get('Class') || parsed.searchParams.get('FixedName') || ''}`);
  return `${readable || 'page'}-${sha256(url).slice(0, 12)}.html`;
}

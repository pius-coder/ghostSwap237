import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const srcRoot = join(import.meta.dir, '../src');

const EXCLUDED_SUFFIXES = [
  join('pages', 'AdminDashboard.tsx'),
];

const EXCLUDED_DIRS = [
  join('components', 'ui'),
];

const BRAND_OR_TECHNICAL = [
  /^Henshin/,
  /^Reactor/,
  /^Lucy/,
  /^fal\.ai/,
  /^Fapshi/,
  /^Chariow/,
  /^Windows 11/,
  /^PRO$/,
  /^Fast$/,
  /^X2$/,
  /^LIVE$/,
  /^USD$/,
  /^XAF$/,
  /^WhatsApp$/,
  /^Admin$/,
  /^—$/,
  /^\d/,
];

async function listTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.some((part) => full.includes(part))) continue;
      files.push(...await listTsxFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

function isExcluded(path: string): boolean {
  return EXCLUDED_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

function isAllowedLiteral(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (BRAND_OR_TECHNICAL.some((pattern) => pattern.test(trimmed))) return true;
  if (!/[A-Za-z]{3,}/.test(trimmed)) return true;
  // Ignore pure code-looking identifiers
  if (/^[A-Za-z0-9_./:-]+$/.test(trimmed) && !/\s/.test(trimmed)) return true;
  return false;
}

describe('translated JSX string audit', () => {
  test('flags obvious hardcoded user-visible English outside whitelist', async () => {
    const files = (await listTsxFiles(srcRoot)).filter((file) => !isExcluded(file));
    const offenders: string[] = [];

    for (const file of files) {
      const source = await Bun.file(file).text();
      // Only plain JSX text nodes: >Visible text<
      for (const match of source.matchAll(/>([^<{\n][^<{\n]*)<\/[A-Za-z]/g)) {
        const text = match[1].trim();
        if (!text || isAllowedLiteral(text)) continue;
        // Require a space so identifiers like "OK" / short tokens are ignored; catch phrases
        if (!/\s/.test(text) && text.length < 16) continue;
        offenders.push(`${relative(srcRoot, file)} :: ${text}`);
      }
    }

    expect(offenders.slice(0, 30)).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import { en } from '../src/i18n/resources/en';
import { fr } from '../src/i18n/resources/fr';
import {
  formatCredits,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatDurationFromCredits,
  formatNumber,
} from '../src/i18n/format';
import {
  DEFAULT_LOCALE,
  detectSystemLocalePreselection,
  isAppLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  writeStoredLocale,
} from '../src/i18n/locale';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined) return [`${prefix}__nullish`];
  if (typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function flattenValues(value: unknown, prefix = ''): Array<{ key: string; value: unknown }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [{ key: prefix, value }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenValues(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n resource parity', () => {
  test('FR and EN expose the same keys', () => {
    const enKeys = flattenKeys(en).sort();
    const frKeys = flattenKeys(fr).sort();
    expect(frKeys).toEqual(enKeys);
  });

  test('no empty or undefined values', () => {
    for (const locale of [en, fr]) {
      for (const entry of flattenValues(locale)) {
        expect(entry.value).not.toBeUndefined();
        expect(entry.value).not.toBeNull();
        if (typeof entry.value === 'string') {
          expect(entry.value.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('interpolation placeholders are compatible between locales', () => {
    const placeholder = /\{\{(\w+)\}\}/g;
    const enEntries = flattenValues(en);
    const frMap = new Map(flattenValues(fr).map((entry) => [entry.key, entry.value]));
    for (const entry of enEntries) {
      if (typeof entry.value !== 'string') continue;
      const enVars = [...entry.value.matchAll(placeholder)].map((match) => match[1]).sort();
      const frValue = frMap.get(entry.key);
      expect(typeof frValue).toBe('string');
      const frVars = [...String(frValue).matchAll(placeholder)].map((match) => match[1]).sort();
      expect(frVars).toEqual(enVars);
    }
  });
});

describe('locale persistence helpers', () => {
  test('system French preselections FR, others EN', () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'fr-FR' },
    });
    expect(detectSystemLocalePreselection()).toBe('fr');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'en-US' },
    });
    expect(detectSystemLocalePreselection()).toBe('en');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'de-DE' },
    });
    expect(detectSystemLocalePreselection()).toBe('en');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original });
  });

  test('only fr/en are valid and invalid stored values are ignored', () => {
    expect(isAppLocale('fr')).toBe(true);
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('es')).toBe(false);
    expect(isAppLocale('fr-FR')).toBe(false);

    const store = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });

    expect(readStoredLocale()).toBeNull();
    writeStoredLocale('fr');
    expect(store.get(LOCALE_STORAGE_KEY)).toBe('fr');
    expect(readStoredLocale()).toBe('fr');
    store.set(LOCALE_STORAGE_KEY, 'de');
    expect(readStoredLocale()).toBeNull();
    writeStoredLocale('en');
    expect(readStoredLocale()).toBe('en');
    expect(DEFAULT_LOCALE).toBe('en');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
  });
});

describe('formatters', () => {
  test('formats XAF without decimals and USD with two decimals', () => {
    expect(formatCurrency(15000, 'XAF', 'fr')).toContain('XAF');
    expect(formatCurrency(15000, 'XAF', 'fr')).not.toMatch(/,/);
    expect(formatCurrency(30, 'USD', 'en')).toMatch(/\$30\.00|30\.00/);
    expect(formatCurrency(30, 'USD', 'fr')).toMatch(/30[,.]00/);
  });

  test('formats Fast and PRO durations from credits', () => {
    expect(formatDurationFromCredits(18000, 2, 'en')).toBe(formatDuration(9000, 'en'));
    expect(formatDurationFromCredits(18000, 80, 'fr')).toBe(formatDuration(225, 'fr'));
    expect(formatCredits(18000, 'fr')).toMatch(/18/);
    expect(formatNumber(1234.5, 'en', { maximumFractionDigits: 1 })).toContain('1');
  });

  test('formats date-time with explicit locale', () => {
    const stamp = '2026-09-01T12:30:00.000Z';
    const fr = formatDateTime(stamp, 'fr');
    const en = formatDateTime(stamp, 'en');
    expect(fr.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    expect(fr).not.toEqual(en);
  });
});

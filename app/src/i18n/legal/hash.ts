import { createHash } from 'node:crypto';
import {
  LEGAL_CONTENT_HASHES,
  LEGAL_VERSION,
  canonicalizeLegalDocument,
  type LegalDocumentType,
} from './documents';
import type { AppLocale } from '../locale';

export function hashLegalDocument(locale: AppLocale, documentType: LegalDocumentType): string {
  return createHash('sha256').update(canonicalizeLegalDocument(locale, documentType), 'utf8').digest('hex');
}

export function allLegalHashes() {
  return (['en', 'fr'] as const).flatMap((locale) =>
    (['terms', 'privacy'] as const).map((documentType) => ({
      locale,
      documentType,
      version: LEGAL_VERSION,
      sha256: hashLegalDocument(locale, documentType),
      expected: LEGAL_CONTENT_HASHES[locale][documentType],
    })),
  );
}

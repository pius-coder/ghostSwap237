import type { AppLocale } from '@/i18n/locale';
import { LEGAL_DOCUMENTS, LEGAL_VERSION } from '@/i18n/legal/documents';
import { getAppLocale } from '@/i18n';

export const TERMS_VERSION = LEGAL_VERSION;
export const PRIVACY_VERSION = LEGAL_VERSION;

export function LegalDocuments({ locale }: { locale?: AppLocale }) {
  const active = locale ?? getAppLocale();
  const terms = LEGAL_DOCUMENTS[active].terms;
  const privacy = LEGAL_DOCUMENTS[active].privacy;

  return (
    <div className="space-y-6 text-sm leading-6 text-muted-foreground">
      {terms.sections.map((section) => (
        <section key={section.id}>
          <h3 className="font-semibold text-foreground">{section.title}</h3>
          <p>{section.body}</p>
        </section>
      ))}
      {privacy.sections.map((section) => (
        <section key={section.id}>
          <h3 className="font-semibold text-foreground">{section.title}</h3>
          <p>{section.body}</p>
        </section>
      ))}
    </div>
  );
}

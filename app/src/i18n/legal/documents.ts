import type { AppLocale } from '../locale';

export const LEGAL_VERSION = '2026-08-31';

export type LegalDocumentType = 'terms' | 'privacy';

export interface LegalSection {
  id: string;
  title: string;
  body: string;
}

/** Canonical bilingual legal copy — same legal meaning, locale-specific wording. */
export const LEGAL_DOCUMENTS: Record<
  AppLocale,
  Record<LegalDocumentType, { version: string; sections: LegalSection[] }>
> = {
  en: {
    terms: {
      version: LEGAL_VERSION,
      sections: [
        {
          id: 'terms-intro',
          title: `Terms of use — version ${LEGAL_VERSION}`,
          body: 'Henshin is a creative real-time image transformation tool. You must use it lawfully, respect image rights, privacy, consent, intellectual property, platform rules and all rules applicable in your country.',
        },
        {
          id: 'terms-responsibility',
          title: 'Your responsibility',
          body: 'You are solely responsible for the source images, prompts, generated output, broadcasts and accounts used with Henshin. Do not impersonate, deceive, harass, exploit, defame or create unlawful sexual, violent or discriminatory content. Do not use a person’s face or likeness without the permissions required by law.',
        },
        {
          id: 'terms-ai',
          title: 'AI limitations and disclaimer',
          body: 'AI output may be inaccurate, offensive, unstable or unsuitable. Virtual-camera and third-party services may fail or become unavailable. To the fullest extent permitted by applicable law, Henshin is provided “as is” without a guarantee of uninterrupted operation or fitness for a particular purpose. Henshin does not endorse or assume responsibility for a user’s unlawful or unauthorised use. Nothing here excludes rights or liabilities that cannot legally be excluded.',
        },
        {
          id: 'terms-credits',
          title: 'Credits and payments',
          body: 'Fast mode uses 2 credits per usable second. The standard PRO rate is 80 credits per usable second and is enforced by the server. Fapshi and Chariow are payment processors only. A Chariow purchase does not create or replace a Henshin PRO licence. Verified purchases are credited automatically; refunds, disputes or chargebacks may reverse corresponding credits.',
        },
        {
          id: 'terms-account',
          title: 'Account and licence',
          body: 'Keep your account secure. PRO access requires an active account-bound Henshin licence and sufficient credits. Licences may be revoked for fraud, abuse, chargeback, security risk or breach of these terms.',
        },
      ],
    },
    privacy: {
      version: LEGAL_VERSION,
      sections: [
        {
          id: 'privacy-intro',
          title: `Privacy notice — version ${LEGAL_VERSION}`,
          body: 'We process account identifiers, email, wallet and transaction records, licence status, session duration and provider usage, device/app diagnostics, security logs, legal acceptance evidence and support communications. We use these data to authenticate users, deliver credits, operate Fast and PRO modes, prevent fraud, keep accounting and provide support.',
        },
        {
          id: 'privacy-processors',
          title: 'Processors and transfers',
          body: 'Depending on the feature, data may be processed by Supabase, fal.ai (Lucy PRO), Reactor, Fapshi, Chariow, hosting providers and configured notification providers. International processing may occur. Payment card or Mobile Money credentials are entered with the payment processor and should not be sent to Henshin support.',
        },
        {
          id: 'privacy-retention',
          title: 'Retention and choices',
          body: 'Financial, fraud-prevention, audit and acceptance evidence is retained as required for legal and accounting purposes. Operational records are retained only as needed for the service and security. You may request access, correction or deletion where applicable; some records must be retained. Contact support through the in-app support action or WhatsApp +237 620 124 019.',
        },
        {
          id: 'privacy-ack',
          title: 'Important acknowledgement',
          body: 'Checking the box confirms acceptance of the Terms and acknowledgement that you received this Privacy Notice. It is not consent to optional marketing or unrelated data use.',
        },
      ],
    },
  },
  fr: {
    terms: {
      version: LEGAL_VERSION,
      sections: [
        {
          id: 'terms-intro',
          title: `Conditions d’utilisation — version ${LEGAL_VERSION}`,
          body: 'Henshin est un outil créatif de transformation d’image en temps réel. Vous devez l’utiliser de manière légale, respecter les droits à l’image, la vie privée, le consentement, la propriété intellectuelle, les règles des plateformes et toutes les règles applicables dans votre pays.',
        },
        {
          id: 'terms-responsibility',
          title: 'Votre responsabilité',
          body: 'Vous êtes seul responsable des images sources, des prompts, des résultats générés, des diffusions et des comptes utilisés avec Henshin. N’usurpez pas d’identité, ne trompez pas, ne harcelez pas, n’exploitez pas, ne diffamez pas et ne créez pas de contenu sexuel, violent ou discriminatoire illégal. N’utilisez pas le visage ou l’apparence d’une personne sans les autorisations exigées par la loi.',
        },
        {
          id: 'terms-ai',
          title: 'Limites de l’IA et avertissement',
          body: 'Les sorties d’IA peuvent être inexactes, offensantes, instables ou inadaptées. La caméra virtuelle et les services tiers peuvent échouer ou devenir indisponibles. Dans toute la mesure permise par le droit applicable, Henshin est fourni « en l’état », sans garantie de fonctionnement ininterrompu ni d’adéquation à un usage particulier. Henshin n’approuve pas et n’assume pas la responsabilité d’une utilisation illégale ou non autorisée. Rien ici n’exclut des droits ou responsabilités qui ne peuvent légalement être exclus.',
        },
        {
          id: 'terms-credits',
          title: 'Crédits et paiements',
          body: 'Le mode Fast consomme 2 crédits par seconde utilisable. Le tarif PRO standard est de 80 crédits par seconde utilisable et est appliqué par le serveur. Fapshi et Chariow sont uniquement des prestataires de paiement. Un achat Chariow ne crée ni ne remplace une licence PRO Henshin. Les achats vérifiés sont crédités automatiquement ; les remboursements, litiges ou rétrofacturations peuvent annuler les crédits correspondants.',
        },
        {
          id: 'terms-account',
          title: 'Compte et licence',
          body: 'Protégez votre compte. L’accès PRO exige une licence Henshin active liée au compte et des crédits suffisants. Les licences peuvent être révoquées en cas de fraude, d’abus, de rétrofacturation, de risque de sécurité ou de violation de ces conditions.',
        },
      ],
    },
    privacy: {
      version: LEGAL_VERSION,
      sections: [
        {
          id: 'privacy-intro',
          title: `Avis de confidentialité — version ${LEGAL_VERSION}`,
          body: 'Nous traitons les identifiants de compte, l’e-mail, les enregistrements de portefeuille et de transactions, le statut de licence, la durée des sessions et l’usage fournisseurs, les diagnostics appareil/application, les journaux de sécurité, les preuves d’acceptation légale et les communications de support. Nous utilisons ces données pour authentifier les utilisateurs, délivrer les crédits, faire fonctionner les modes Fast et PRO, prévenir la fraude, tenir la comptabilité et fournir le support.',
        },
        {
          id: 'privacy-processors',
          title: 'Prestataires et transferts',
          body: 'Selon la fonctionnalité, les données peuvent être traitées par Supabase, fal.ai (Lucy PRO), Reactor, Fapshi, Chariow, les hébergeurs et les prestataires de notification configurés. Un traitement international peut avoir lieu. Les identifiants de carte ou de Mobile Money sont saisis chez le prestataire de paiement et ne doivent pas être envoyés au support Henshin.',
        },
        {
          id: 'privacy-retention',
          title: 'Conservation et choix',
          body: 'Les preuves financières, antifraude, d’audit et d’acceptation sont conservées autant que requis à des fins légales et comptables. Les enregistrements opérationnels ne sont conservés que pour le service et la sécurité. Vous pouvez demander l’accès, la correction ou la suppression lorsque cela s’applique ; certains enregistrements doivent être conservés. Contactez le support via l’action in-app ou WhatsApp +237 620 124 019.',
        },
        {
          id: 'privacy-ack',
          title: 'Reconnaissance importante',
          body: 'Cocher la case confirme l’acceptation des Conditions et la reconnaissance que vous avez reçu cet avis de confidentialité. Cela ne constitue pas un consentement au marketing optionnel ni à des usages de données non liés.',
        },
      ],
    },
  },
};

/** Precomputed SHA-256 of canonicalizeLegalDocument() — verified by tests. */
export const LEGAL_CONTENT_HASHES = {
  en: {
    terms: '9d015f72e47a8b3a7a99c3b2b8db33a658b74fe9a4004cf67df34113700cf7b1',
    privacy: '15f754338e06678b67d133033033a1c50ec92fc7ca3e902e893127857421a737',
  },
  fr: {
    terms: 'a5972695d1c7e3f3bf37923c66f1793839e523180dfbe345d72b7f3300006e29',
    privacy: '93b7ddb7d24e257e8cb5301f7b048d2110052261d0f2c6d161fed4cf7df4b751',
  },
} as const;

export function canonicalizeLegalDocument(
  locale: AppLocale,
  documentType: LegalDocumentType,
): string {
  const doc = LEGAL_DOCUMENTS[locale][documentType];
  return JSON.stringify({
    document_type: documentType,
    version: doc.version,
    locale,
    sections: doc.sections.map((section) => ({
      id: section.id,
      title: section.title,
      body: section.body,
    })),
  });
}

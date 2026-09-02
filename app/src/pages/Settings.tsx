import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Loader2, RefreshCw, Rocket } from 'lucide-react';
import {
  AppButton,
  AppSurface,
  InlineAlert,
  SectionHeader,
  StatusBadge,
  AppDialog,
  AppDialogContent,
  AppDialogHeader,
  AppDialogTitle,
} from '@/components/app';
import { useAuth } from '@/context/AuthContext';
import { CURRENT_VERSION } from '@/lib/app-version';
import {
  checkForDesktopUpdates,
  getDesktopUpdateState,
  installDesktopUpdate,
  subscribeToDesktopUpdateState,
  type DesktopUpdateState,
  type DesktopUpdateStatus,
} from '@/lib/desktop-updater';
import { formatDateTime } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';
import type { AppLocale } from '@/i18n/locale';
import { LEGAL_VERSION } from '@/i18n/legal/documents';
import { LegalDocuments } from '@/components/LegalDocuments';
import { useProAccess } from '@/hooks/useProAccess';
import { toast } from 'sonner';

const INITIAL_UPDATE_STATE: DesktopUpdateState = {
  status: 'idle',
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  progress: 0,
  message: '',
  checkedAt: null,
  downloadUrl: null,
  downloadedFilePath: null,
  downloadedFileName: null,
  artifactType: null,
  notes: null,
  error: null,
  isElectron: false,
  isPackaged: false,
  canAutoInstall: false,
};

function getUpdateButtonLabel(status: DesktopUpdateStatus, t: (key: string) => string): string {
  switch (status) {
    case 'checking':
      return t('settings.checking');
    case 'downloading':
      return t('settings.downloading');
    case 'installing':
      return t('settings.installing');
    case 'downloaded':
      return t('settings.restartToInstall');
    default:
      return t('settings.checkForUpdates');
  }
}

function Settings({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocalePreference();
  const { user, logout } = useAuth();
  const { access: proAccess } = useProAccess(user?.id);
  const [localeBusy, setLocaleBusy] = useState(false);
  const [legalDoc, setLegalDoc] = useState<'terms' | 'privacy' | null>(null);
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    ...INITIAL_UPDATE_STATE,
    message: t('settings.checkingAvailability'),
  });
  const previousUpdateStatusRef = useRef<DesktopUpdateStatus | null>(null);
  const isElectron =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { require?: unknown }).require !== 'undefined';

  useEffect(() => {
    let isMounted = true;

    void getDesktopUpdateState().then((state) => {
      if (isMounted) setUpdateState(state);
    });

    const unsubscribe = subscribeToDesktopUpdateState((state) => {
      if (isMounted) setUpdateState(state);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const previousStatus = previousUpdateStatusRef.current;
    if (previousStatus === updateState.status) return;

    if (previousStatus === 'checking' && updateState.status === 'up-to-date') {
      toast.success(updateState.message);
    } else if (updateState.status === 'downloaded') {
      toast.success(updateState.message);
    } else if (updateState.status === 'installing') {
      toast.message(t('settings.installingToast'));
    } else if (updateState.status === 'error' && updateState.error) {
      toast.error(updateState.error);
    }

    previousUpdateStatusRef.current = updateState.status;
  }, [t, updateState.error, updateState.message, updateState.status]);

  const handleLocaleChange = async (next: AppLocale) => {
    if (next === locale || localeBusy) return;
    setLocaleBusy(true);
    try {
      await setLocale(next, { persistServer: true });
      toast.success(t('locale.saved'));
    } catch {
      toast.error(t('locale.saveFailed'));
    } finally {
      setLocaleBusy(false);
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      if (updateState.status === 'downloaded') {
        await installDesktopUpdate();
        return;
      }
      await checkForDesktopUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.updateFailed');
      toast.error(message);
    }
  };

  const isUpdaterBusy =
    updateState.status === 'checking' ||
    updateState.status === 'downloading' ||
    updateState.status === 'installing';

  const checkedAtLabel = updateState.checkedAt
    ? formatDateTime(updateState.checkedAt, locale)
    : t('settings.notCheckedYet');
  const releaseNotes = updateState.notes
    ?.split(/\r?\n/)
    .filter((line) => !/\bsha-?256\b/i.test(line))
    .join('\n')
    .trim();

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      {!embedded ? (
        <SectionHeader title={t('settings.title')} description={t('settings.subtitle')} />
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
      <AppSurface elevated>
        <SectionHeader title={t('settings.general')} description={t('settings.generalDescription')} />
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('settings.appVersion')}</dt>
            <dd className="font-medium text-foreground">{CURRENT_VERSION}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('settings.environment')}</dt>
            <dd className="font-medium text-foreground">
              {isElectron ? t('settings.environmentDesktop') : t('settings.environmentWeb')}
            </dd>
          </div>
        </dl>
      </AppSurface>

      <AppSurface elevated>
        <SectionHeader title={t('settings.language')} description={t('settings.languageDescription')} />
        <div className="flex flex-wrap gap-2">
          <AppButton
            variant={locale === 'fr' ? 'primary' : 'secondary'}
            disabled={localeBusy}
            onClick={() => void handleLocaleChange('fr')}
          >
            {t('locale.french')}
          </AppButton>
          <AppButton
            variant={locale === 'en' ? 'primary' : 'secondary'}
            disabled={localeBusy}
            onClick={() => void handleLocaleChange('en')}
          >
            {t('locale.english')}
          </AppButton>
        </div>
      </AppSurface>

      <AppSurface elevated>
        <SectionHeader
          title={t('settings.virtualCamera')}
          description={t('settings.virtualCameraDescription')}
        />
        <div className="space-y-3 text-[13px]">
          <InlineAlert tone="info">{t('settings.virtualCameraWindowsRequired')}</InlineAlert>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{t('settings.virtualCameraStatus')}</span>
            <StatusBadge tone={isElectron ? 'success' : 'idle'}>
              {isElectron
                ? t('settings.virtualCameraAvailable')
                : t('settings.virtualCameraUnavailable')}
            </StatusBadge>
          </div>
          <p className="text-muted-foreground">{t('settings.virtualCameraHelp')}</p>
        </div>
      </AppSurface>

      <AppSurface elevated className="lg:col-span-2">
        <SectionHeader title={t('settings.updates')} description={t('settings.updatesDescription')} />
        <div className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {updateState.status === 'downloaded' ? (
                  <CheckCircle2 className="size-4 text-success" />
                ) : updateState.status === 'installing' ? (
                  <Rocket className="size-4 text-primary" />
                ) : (
                  <RefreshCw
                    className={`size-4 ${isUpdaterBusy ? 'animate-spin text-primary' : 'text-muted-foreground'}`}
                  />
                )}
                <p className="text-[13px] font-medium text-foreground">{t('settings.updateStatus')}</p>
              </div>
              <p className="text-[13px] text-foreground/90">{updateState.message}</p>
              <p className="text-xs text-muted-foreground">
                {t('settings.lastChecked', { when: checkedAtLabel })}
              </p>
            </div>
            <AppButton
              onClick={() => void handleCheckForUpdates()}
              disabled={!updateState.isElectron || isUpdaterBusy}
              className="sm:min-w-[190px]"
            >
              {isUpdaterBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : updateState.status === 'downloaded' ? (
                <Rocket className="size-4" />
              ) : (
                <Download className="size-4" />
              )}
              {getUpdateButtonLabel(updateState.status, t)}
            </AppButton>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/[0.08] p-3">
              <p className="text-xs text-muted-foreground">{t('settings.currentVersion')}</p>
              <p className="mt-1 text-[15px] font-semibold">{updateState.currentVersion}</p>
            </div>
            <div className="rounded-lg border border-white/[0.08] p-3">
              <p className="text-xs text-muted-foreground">{t('settings.latestVersion')}</p>
              <p className="mt-1 text-[15px] font-semibold">
                {updateState.latestVersion || t('common.unknown')}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.08] p-3">
              <p className="text-xs text-muted-foreground">{t('settings.installMode')}</p>
              <p className="mt-1 text-[15px] font-semibold">
                {updateState.canAutoInstall
                  ? t('settings.automatic')
                  : updateState.isElectron
                    ? t('settings.downloadOnly')
                    : t('settings.browser')}
              </p>
            </div>
          </div>

          {(updateState.status === 'downloading' ||
            updateState.status === 'installing' ||
            updateState.status === 'downloaded') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('settings.updateProgress')}</span>
                <span>{Math.max(0, Math.min(100, updateState.progress))}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-ui"
                  style={{ width: `${Math.max(4, Math.min(100, updateState.progress || 0))}%` }}
                />
              </div>
            </div>
          )}

          {updateState.downloadedFileName ? (
            <p className="text-xs text-muted-foreground">
              {t('settings.downloadedPackage', { name: updateState.downloadedFileName })}
            </p>
          ) : null}

          {releaseNotes ? (
            <div className="rounded-lg border border-white/[0.08] p-3">
              <p className="mb-2 text-xs text-muted-foreground">{t('settings.releaseNotes')}</p>
              <p className="whitespace-pre-wrap text-[13px] text-foreground/90">{releaseNotes}</p>
            </div>
          ) : null}

          {!updateState.isElectron ? (
            <p className="text-xs text-muted-foreground">{t('settings.electronRequired')}</p>
          ) : null}
          {updateState.isElectron && !updateState.isPackaged ? (
            <p className="text-xs text-muted-foreground">{t('settings.devModeNote')}</p>
          ) : null}
        </div>
      </AppSurface>

      <AppSurface elevated>
        <SectionHeader title={t('settings.account')} description={t('settings.accountDescription')} />
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('settings.fullName')}</dt>
            <dd className="font-medium text-foreground">{user?.name || t('common.user')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('settings.emailAddress')}</dt>
            <dd className="font-medium text-foreground">{user?.email || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('settings.proLicense')}</dt>
            <dd>
              <StatusBadge tone={proAccess.active ? 'success' : 'idle'}>
                {proAccess.active ? t('settings.proActive') : t('settings.proInactive')}
              </StatusBadge>
            </dd>
          </div>
          {user?.isAdmin ? (
            <div>
              <dt className="text-muted-foreground">{t('settings.adminStatus')}</dt>
              <dd className="font-medium text-foreground">{t('common.adminBadge')}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-4">
          <AppButton variant="danger" onClick={logout}>
            {t('common.signOut')}
          </AppButton>
        </div>
      </AppSurface>

      <AppSurface elevated>
        <SectionHeader title={t('settings.legal')} description={t('settings.legalDescription')} />
        <p className="mb-3 text-[13px] text-muted-foreground">
          {t('settings.legalAcceptedVersions')}: {LEGAL_VERSION}
        </p>
        <div className="flex flex-wrap gap-2">
          <AppButton variant="secondary" onClick={() => setLegalDoc('terms')}>
            {t('settings.legalOpenTerms')}
          </AppButton>
          <AppButton variant="secondary" onClick={() => setLegalDoc('privacy')}>
            {t('settings.legalOpenPrivacy')}
          </AppButton>
        </div>
      </AppSurface>
      </div>

      <AppDialog open={Boolean(legalDoc)} onOpenChange={(open) => !open && setLegalDoc(null)}>
        <AppDialogContent className="max-h-[85vh] sm:max-w-2xl">
          <AppDialogHeader>
            <AppDialogTitle>
              {legalDoc === 'privacy'
                ? t('settings.legalOpenPrivacy')
                : t('settings.legalOpenTerms')}
            </AppDialogTitle>
          </AppDialogHeader>
          <div className="custom-scrollbar max-h-[60vh] overflow-y-auto pr-1">
            <LegalDocuments locale={locale} />
          </div>
        </AppDialogContent>
      </AppDialog>
    </div>
  );
}

export default Settings;

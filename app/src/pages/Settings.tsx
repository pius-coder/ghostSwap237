import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Loader2, RefreshCw, Rocket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { TextureButton } from '@/components/ui/texture-button';
import { TextureCard } from '@/components/ui/texture-card';
import { Label } from '@/components/ui/label';
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

function Settings() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocalePreference();
  const { user, logout } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [isSaving, setIsSaving] = useState(false);
  const [localeBusy, setLocaleBusy] = useState(false);
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    ...INITIAL_UPDATE_STATE,
    message: t('settings.checkingAvailability'),
  });
  const previousUpdateStatusRef = useRef<DesktopUpdateStatus | null>(null);

  useEffect(() => {
    let isMounted = true;

    void getDesktopUpdateState().then((state) => {
      if (isMounted) {
        setUpdateState(state);
      }
    });

    const unsubscribe = subscribeToDesktopUpdateState((state) => {
      if (isMounted) {
        setUpdateState(state);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const previousStatus = previousUpdateStatusRef.current;

    if (previousStatus === updateState.status) {
      return;
    }

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

  const handleSaveProfile = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast.success(t('settings.profileSaved'));
    setIsSaving(false);
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
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">{t('settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">{t('locale.sectionTitle')}</CardTitle>
            <CardDescription className="text-xs">{t('locale.sectionDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-wrap gap-3">
              <TextureButton
                variant={locale === 'fr' ? 'accent' : 'secondary'}
                disabled={localeBusy}
                onClick={() => void handleLocaleChange('fr')}
              >
                {t('locale.french')}
              </TextureButton>
              <TextureButton
                variant={locale === 'en' ? 'accent' : 'secondary'}
                disabled={localeBusy}
                onClick={() => void handleLocaleChange('en')}
              >
                {t('locale.english')}
              </TextureButton>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">{t('settings.updates')}</CardTitle>
            <CardDescription className="text-xs">{t('settings.updatesDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {updateState.status === 'downloaded' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : updateState.status === 'installing' ? (
                    <Rocket className="w-4 h-4 text-blue-400" />
                  ) : (
                    <RefreshCw className={`w-4 h-4 ${isUpdaterBusy ? 'text-blue-400 animate-spin' : 'text-muted-foreground'}`} />
                  )}
                  <p className="text-sm font-medium text-white">{t('settings.updateStatus')}</p>
                </div>
                <p className="text-sm text-foreground/90">{updateState.message}</p>
                <p className="text-xs text-muted-foreground">{t('settings.lastChecked', { when: checkedAtLabel })}</p>
              </div>
              <TextureButton
                variant="accent"
                onClick={handleCheckForUpdates}
                disabled={!updateState.isElectron || isUpdaterBusy}
                className="sm:min-w-[190px]"
              >
                {isUpdaterBusy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : updateState.status === 'downloaded' ? (
                  <Rocket className="w-4 h-4 mr-2" />
                ) : (
                  <Download className="w-4 h-4 mr-2" />
                )}
                {getUpdateButtonLabel(updateState.status, t)}
              </TextureButton>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('settings.currentVersion')}</p>
                <p className="text-lg font-semibold text-white">{updateState.currentVersion}</p>
              </TextureCard>
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('settings.latestVersion')}</p>
                <p className="text-lg font-semibold text-white">{updateState.latestVersion || t('common.unknown')}</p>
              </TextureCard>
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('settings.installMode')}</p>
                <p className="text-lg font-semibold text-white">
                  {updateState.canAutoInstall
                    ? t('settings.automatic')
                    : updateState.isElectron
                      ? t('settings.downloadOnly')
                      : t('settings.browser')}
                </p>
              </TextureCard>
            </div>

            {(updateState.status === 'downloading' || updateState.status === 'installing' || updateState.status === 'downloaded') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t('settings.updateProgress')}</span>
                  <span>{Math.max(0, Math.min(100, updateState.progress))}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-border/70 bg-background/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, updateState.progress || 0))}%` }}
                  />
                </div>
              </div>
            )}

            {updateState.downloadedFileName && (
              <p className="text-xs text-muted-foreground">
                {t('settings.downloadedPackage', { name: updateState.downloadedFileName })}
              </p>
            )}

            {releaseNotes && (
              <TextureCard contentClassName="p-4">
                <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('settings.releaseNotes')}</p>
                <p className="whitespace-pre-wrap text-sm text-foreground/90">{releaseNotes}</p>
              </TextureCard>
            )}

            {!updateState.isElectron && (
              <p className="text-xs text-muted-foreground">{t('settings.electronRequired')}</p>
            )}

            {updateState.isElectron && !updateState.isPackaged && (
              <p className="text-xs text-muted-foreground">{t('settings.devModeNote')}</p>
            )}

          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">{t('settings.profile')}</CardTitle>
            <CardDescription className="text-xs">{t('settings.profileDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-muted-foreground">{t('settings.fullName')}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 bg-background/70"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-muted-foreground">{t('settings.emailAddress')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-background/70"
                />
              </div>
            </div>
            <CosmicButton
              as="button"
              onClick={handleSaveProfile}
              disabled={isSaving}
            >
              {isSaving ? t('common.saving') : t('settings.saveChanges')}
            </CosmicButton>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">{t('settings.notifications')}</CardTitle>
            <CardDescription className="text-xs">{t('settings.notificationsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">{t('settings.emailNotifications')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.emailNotificationsHint')}</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-border/70" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">{t('settings.lowCreditAlerts')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.lowCreditAlertsHint')}</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-border/70" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">{t('settings.marketingEmails')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.marketingEmailsHint')}</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-white tracking-tight">{t('settings.danger')}</CardTitle>
            <CardDescription className="text-xs">{t('settings.dangerDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium text-white">{t('settings.signOutLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.signOutHint')}</p>
              </div>
              <TextureButton
                onClick={logout}
                variant="destructive"
              >
                {t('common.signOut')}
              </TextureButton>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Settings;

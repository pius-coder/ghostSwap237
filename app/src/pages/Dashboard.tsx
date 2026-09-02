// Studio workspace ? fxswap37 layout integrated into Henshin:
// Stage + persona inspector with a fixed source-camera preview + SessionBar.
// Engines: Reactor X2 (Fast) and fal.ai Lucy 2.5 (PRO).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X2Provider } from '@reactor-models/x2';
import { Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { fetchReactorToken } from '@/lib/reactorToken';
import { REACTOR_API_URL } from '@/lib/reactorConfig';
import { formatReactorFailure } from '@/lib/reactorErrors';
import { loadLiveProvider, saveLiveProvider, type LiveProvider } from '@/lib/liveProvider';
import type { Persona } from '@/lib/personas';
import { startLiveSession } from '@/lib/session/applyPersona';
import { JsSessionProvider } from '@/lib/session/sessionBridge';
import { useSessionCommands } from '@/lib/session/sessionContext';
import { FalLucySessionProvider } from '@/lib/session/FalLucySessionProvider';
import { useVirtualCameraCapture } from '@/services/useVirtualCameraCapture';
import { useSourcePublisher } from '@/components/studio/useSourcePublisher';
import { Stage } from '@/components/studio/Stage';
import { SessionBar, type SessionOperation } from '@/components/studio/SessionBar';
import { PersonaPanel } from '@/components/studio/PersonaPanel';
import { CameraPickerDialog } from '@/components/studio/CameraPickerDialog';
import { useStudioCamera } from '@/components/studio/useStudioCamera';
import { ProAccessDialog } from '@/components/ProAccessDialog';
import { useProAccess } from '@/hooks/useProAccess';
import { AppButton, IconButton, InlineAlert } from '@/components/app';
import { formatDuration } from '@/i18n/format';
import { useLocalePreference } from '@/i18n/useLocalePreference';

const CREDITS_PER_SECOND = 2;
const POLLING_INTERVAL_MS = 1000;
const PREVIEW_WINDOW_NAME = 'henshin-preview';
const PREVIEW_WINDOW_FEATURES =
  'popup=yes,width=1280,height=720,minWidth=640,minHeight=360,resizable=yes,scrollbars=no';

async function waitForGeneration(getGenerating: () => boolean, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (getGenerating()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error('REACTOR_TIMEOUT');
}

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `API Error: ${response.statusText}`);
  }
  return response.json();
}

export default function Dashboard() {
  const { user } = useAuth();
  const [liveProvider, setLiveProvider] = useState<LiveProvider>(() => loadLiveProvider());
  const [proDialogOpen, setProDialogOpen] = useState(false);
  const { access: proAccess, loading: proAccessLoading, redeem: redeemProLicense } = useProAccess(user?.id);

  const authorizedLiveProvider = liveProvider === 'pro' && !proAccess.active
    ? 'fast'
    : liveProvider;

  useEffect(() => {
    if (authorizedLiveProvider === 'fast' && liveProvider === 'pro' && !proAccessLoading) {
      saveLiveProvider('fast');
    }
  }, [authorizedLiveProvider, liveProvider, proAccessLoading]);

  const onLiveProviderChange = useCallback((next: LiveProvider) => {
    if (next === 'pro' && !proAccess.active) {
      setProDialogOpen(true);
      return;
    }
    saveLiveProvider(next);
    setLiveProvider(next);
  }, [proAccess.active]);

  const workspace = authorizedLiveProvider === 'pro' ? (
    <FalLucySessionProvider>
      <Workspace
        liveProvider={authorizedLiveProvider}
        proCreditsPerSecond={proAccess.creditsPerSecond}
        proAllowed={proAccess.active}
        onLiveProviderChange={onLiveProviderChange}
      />
    </FalLucySessionProvider>
  ) : (
    <X2Provider apiUrl={REACTOR_API_URL} getJwt={fetchReactorToken} connectOptions={{ autoConnect: false }}>
      <JsSessionProvider>
        <Workspace
          liveProvider={authorizedLiveProvider}
          proCreditsPerSecond={proAccess.creditsPerSecond}
          proAllowed={proAccess.active}
          onLiveProviderChange={onLiveProviderChange}
        />
      </JsSessionProvider>
    </X2Provider>
  );

  return (
    <>
      {workspace}
      <ProAccessDialog
        open={proDialogOpen}
        access={proAccess}
        onOpenChange={setProDialogOpen}
        onRedeem={async (code) => {
          await redeemProLicense(code);
          saveLiveProvider('pro');
          setLiveProvider('pro');
        }}
      />
    </>
  );
}

function Workspace({
  liveProvider,
  proCreditsPerSecond,
  proAllowed,
  onLiveProviderChange,
}: {
  liveProvider: LiveProvider;
  proCreditsPerSecond: number | null;
  proAllowed: boolean;
  onLiveProviderChange: (next: LiveProvider) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocalePreference();
  const { user } = useAuth();
  const { credits, setCredits, setSessionStatus, refreshCredits } = useApp();
  const session = useSessionCommands();

  const [resetNonce, setResetNonce] = useState(0);
  const [operation, setOperation] = useState<SessionOperation>('idle');
  const busyRef = useRef(false);

  const [currentUsage, setCurrentUsage] = useState({ seconds: 0, credits: 0 });
  const [sessionRate, setSessionRate] = useState(liveProvider === 'fast' ? 2 : proCreditsPerSecond || 80);

  const [activePersona, setActivePersona] = useState<Persona | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [isObsMode, setIsObsMode] = useState(false);
  const obsWindowRef = useRef<Window | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef(session.status);
  const metadataRef = useRef(session.metadata);
  const providerSessionIdRef = useRef(session.providerSessionId);
  const billingSessionRef = useRef<string | null>(null);
  const camera = useStudioCamera(liveProvider);
  const {
    cameraOn,
    deviceId: cameraDeviceId,
    label: cameraLabel,
    pickerOpen: cameraPickerOpen,
    setPickerOpen: setCameraPickerOpen,
    sourceStream,
    sourceTrack,
    setSourceTrack,
    webcamVideoRef,
  } = camera;

  useEffect(() => {
    statusRef.current = session.status;
  }, [session.status]);

  useEffect(() => {
    metadataRef.current = session.metadata;
    providerSessionIdRef.current = session.providerSessionId;
  }, [session.metadata, session.providerSessionId]);

  const outputHostRef = useRef<HTMLDivElement | null>(null);

  const isElectron =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { require?: unknown }).require !== 'undefined';

  // Virtual camera ? Henshin's own service, fed by the VISIBLE output video.
  const captureLive = session.kind === 'pro' ? session.status === 'ready' : session.metadata.generating;
  useVirtualCameraCapture(outputHostRef, captureLive, Boolean(isElectron), liveProvider);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // -- Billing (Supabase) ----------------------------------------------------
  const pollSessionStatus = useCallback(async () => {
    const billingSessionId = billingSessionRef.current;
    if (!billingSessionId || !user?.id) return;
    try {
      const response = await apiRequest<{
        credits?: number;
        creditsPerSecond?: number;
        secondsUsed: number;
        creditsUsed?: number;
        remainingCredits?: number;
        shouldStop: boolean;
        forceEnd?: boolean;
        reason?: string;
      }>(`/session-status?userId=${encodeURIComponent(user.id)}&sessionId=${encodeURIComponent(billingSessionId)}`);
      setCurrentUsage({
        seconds: Number(response.secondsUsed || 0),
        credits: Number(response.creditsUsed || 0),
      });
      const latestCredits = Number.isFinite(response.remainingCredits)
        ? response.remainingCredits
        : Number.isFinite(response.credits)
          ? response.credits
          : null;

      if (latestCredits !== null && latestCredits !== undefined) {
        setCredits(latestCredits);
      }

      if (response.shouldStop || response.forceEnd) {
        // Ignore polling after we already disconnected locally (prevents false error toast on manual stop)
        if (statusRef.current === 'disconnected') return;
        const reason = response.reason || (response.forceEnd ? 'access_revoked' : 'credits_or_limit_reached');
        // Normal terminations (user_stop, camera_stopped, etc.) should not show the credits error
        if (['user_stop', 'camera_stopped', 'ended', 'start_failed', 'reconciled_on_start', 'window_closed'].includes(reason)) {
          await handleStop(false, reason);
          return;
        }
        await handleStop(false, reason);
        toast.error(response.forceEnd ? t('studio.sessionEndedPro') : t('studio.sessionEndedCredits'));
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, setCredits]);

  const stopCamera = async () => {
    if (busyRef.current) return;
    if (statusRef.current !== 'disconnected') {
      await handleStop(false, 'camera_stopped');
    }
    camera.release();
  };

  // -- Session controls ------------------------------------------------------
  const handleStart = async () => {
    if (busyRef.current) return;
    if (!user?.id) {
      toast.error(t('studio.signInBeforeSession'));
      return;
    }
    if (!sourceStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      toast.error(t('studio.chooseCameraFirst'));
      return;
    }
    if (!activePersona?.imageUrl) {
      toast.error(t('studio.choosePersonaFirst'));
      return;
    }

    busyRef.current = true;
    setOperation('starting');
    setActionError(null);

    let openedSessionId: string | null = null;
    try {
      const clientSessionId = crypto.randomUUID();
      const sessionResponse = await apiRequest<{
        allowed: boolean;
        sessionId: string | null;
        error?: string;
        credits?: number;
        creditsPerSecond?: number;
      }>('/start-session', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          provider: liveProvider === 'fast' ? 'reactor' : 'fal',
          clientSessionId,
        }),
      });

      if (!sessionResponse.allowed || !sessionResponse.sessionId) {
        throw new Error(sessionResponse.error || t('studio.unableToStart'));
      }
      openedSessionId = sessionResponse.sessionId;
      billingSessionRef.current = openedSessionId;
      if (typeof sessionResponse.creditsPerSecond === 'number') setSessionRate(sessionResponse.creditsPerSecond);
      setCurrentUsage({ seconds: 0, credits: 0 });

      if (typeof sessionResponse.credits === 'number') {
        setCredits(sessionResponse.credits);
      }

      await startLiveSession(session, () => statusRef.current, activePersona, sourceStream, openedSessionId);

      if (liveProvider === 'fast') {
        await waitForGeneration(() => metadataRef.current.generating);
      }

      await apiRequest('/activate-session', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          sessionId: openedSessionId,
          providerSessionId: providerSessionIdRef.current || undefined,
        }),
      });

      stopPolling();
      pollIntervalRef.current = setInterval(() => void pollSessionStatus(), POLLING_INTERVAL_MS);
      void pollSessionStatus();

      setSessionStatus('LIVE');
    } catch (error) {
      console.error('Start session error:', error);

      if (openedSessionId) {
        try {
          await apiRequest('/end-session', {
            method: 'POST',
            body: JSON.stringify({
              userId: user.id,
              sessionId: openedSessionId,
              reason: 'start_failed',
            }),
          });
        } catch (cleanupError) {
          console.error('Session cleanup error:', cleanupError);
        }
      }
      stopPolling();
      billingSessionRef.current = null;

      const rawMessage = error instanceof Error ? error.message : String(error);
      const localizedRaw = rawMessage === 'REACTOR_TIMEOUT' ? t('studio.reactorTimeout') : rawMessage;
      const message = liveProvider === 'fast' ? formatReactorFailure(localizedRaw) || localizedRaw : localizedRaw;
      setActionError(message);
      toast.error(message);

      try {
        await session.disconnect();
      } catch {
        /* best effort */
      }
      setSessionStatus('IDLE');
    } finally {
      busyRef.current = false;
      setOperation('idle');
    }
  };

  async function handleStop(showToast = true, reason = 'user_stop') {
    if (busyRef.current) return;
    busyRef.current = true;
    setOperation('stopping');
    setActionError(null);
    stopPolling();

    try {
      await session.disconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
    }

    const billingSessionId = billingSessionRef.current;
    if (billingSessionId && user?.id) {
      try {
        const response = await apiRequest<{
          remainingCredits?: number;
          secondsUsed?: number;
          creditsUsed?: number;
        }>('/end-session', {
          method: 'POST',
          body: JSON.stringify({ userId: user.id, sessionId: billingSessionId, reason }),
        });
        if (Number.isFinite(response.remainingCredits)) setCredits(response.remainingCredits!);
        setCurrentUsage({
          seconds: Number(response.secondsUsed || 0),
          credits: Number(response.creditsUsed || 0),
        });
        await refreshCredits();
      } catch (error) {
        console.error('Stop session error:', error);
      } finally {
        billingSessionRef.current = null;
      }
    }

    setSessionStatus('IDLE');
    setResetNonce((n) => n + 1);

    busyRef.current = false;
    setOperation('idle');
    if (showToast) toast.info(t('studio.sessionStopped'));
  }

  useEffect(() => {
    if (session.status === 'disconnected') {
      setSessionStatus('IDLE');
    }
  }, [session.status, setSessionStatus]);

  // -- OBS preview window ----------------------------------------------------
  const closeObsPreviewWindow = useCallback((updateState = true) => {
    const previewWindow = obsWindowRef.current;
    if (previewWindow && !previewWindow.closed) previewWindow.close();
    obsWindowRef.current = null;
    if (updateState) setIsObsMode(false);
  }, []);

  const handleObsPreviewToggle = useCallback(() => {
    const existing = obsWindowRef.current;
    if (existing && !existing.closed) {
      closeObsPreviewWindow();
      return;
    }

    const previewUrl = new URL(window.location.href);
    previewUrl.hash = '/preview';
    const win = window.open(previewUrl.toString(), PREVIEW_WINDOW_NAME, PREVIEW_WINDOW_FEATURES);
    if (!win) {
      toast.error(t('studio.obsPreviewFailed'));
      return;
    }
    obsWindowRef.current = win;
    win.focus();
    setIsObsMode(true);
  }, [closeObsPreviewWindow, t]);

  // -- Cleanup ---------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (user?.id) {
        const billingSessionId = billingSessionRef.current;
        if (billingSessionId) void apiFetch('/end-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, sessionId: billingSessionId, reason: 'window_closed' }),
          keepalive: true,
        }).catch(() => {});
      }
      stopPolling();
      void session.disconnect().catch(() => {});
      closeObsPreviewWindow(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (obsWindowRef.current && obsWindowRef.current.closed) {
        obsWindowRef.current = null;
        setIsObsMode(false);
      }
    }, 500);
    return () => window.clearInterval(intervalId);
  }, []);

  const selectedRate = liveProvider === 'fast' ? CREDITS_PER_SECOND : proCreditsPerSecond || sessionRate;
  const remainingSeconds = Math.max(0, Math.floor(credits / selectedRate));
  const creditsOk = remainingSeconds > 0;
  const remainingLabel = creditsOk
    ? t('studio.remainingLeft', { duration: formatDuration(remainingSeconds, locale) })
    : t('studio.noCredits');

  return (
    <div className="client-studio-shell flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="client-studio-workspace flex min-h-0 flex-1">
        <div className="client-studio-primary flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="studio-canvas relative min-h-0 flex-1 overflow-hidden">
            <Stage
              generating={session.metadata.generating}
              activeLabel={activePersona?.name ?? null}
              cameraOn={cameraOn}
              sourceStream={sourceStream}
              remoteStream={session.remoteStream ?? null}
              remotePlayNonce={session.remotePlayNonce}
              liveProvider={liveProvider}
              webcamVideoRef={webcamVideoRef}
              outputHostRef={outputHostRef}
              onTrack={setSourceTrack}
              onChooseCamera={() => setCameraPickerOpen(true)}
            />
          </div>

          <div className="client-session-dock shrink-0">
            <SessionBar
              cameraOn={cameraOn}
              cameraLabel={cameraLabel}
              activePersona={activePersona}
              liveProvider={liveProvider}
              creditsPerSecond={selectedRate}
              remainingCreditsLabel={remainingLabel}
              currentUsage={currentUsage}
              onLiveProviderChange={onLiveProviderChange}
              onOpenCameraPicker={() => setCameraPickerOpen(true)}
              onStart={() => void handleStart()}
              onStop={() => void handleStop()}
              onToggleObsPreview={handleObsPreviewToggle}
              obsActive={isObsMode}
              operation={operation}
              onError={setActionError}
              creditsOk={creditsOk}
              proAllowed={proAllowed}
            />
          </div>
        </div>

        <aside
          className="client-persona-inspector hidden h-full w-full max-w-[320px] shrink-0 flex-col overflow-hidden transition-ui sm:flex lg:flex"
          style={{ width: 312 }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            {(actionError || publishError) && (
              <InlineAlert tone="error" className="mb-3">
                <span className="flex-1">
                  {formatReactorFailure(actionError) || actionError || publishError}
                </span>
                <AppButton
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.dismiss')}
                  className="size-7 shrink-0"
                  onClick={() => {
                    setActionError(null);
                    setPublishError(null);
                  }}
                >
                  ?
                </AppButton>
              </InlineAlert>
            )}
            <PersonaPanel
              key={`persona${resetNonce}`}
              resetNonce={resetNonce}
              sourceStream={sourceStream}
              onActivePersonaChange={setActivePersona}
            />
          </div>
          <div className="client-source-preview shrink-0">
            <div className="client-source-preview-frame relative aspect-video overflow-hidden">
              {cameraOn ? (
                <video
                  ref={webcamVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full -scale-x-100 object-cover"
                />
              ) : (
                <button
                  type="button"
                  className="flex h-full w-full flex-col items-center justify-center gap-2"
                  onClick={() => setCameraPickerOpen(true)}
                >
                  <Camera className="size-5" strokeWidth={1.5} />
                  <span className="text-xs font-medium">{t('studio.chooseCamera')}</span>
                </button>
              )}
              <div className="client-source-preview-bar absolute inset-x-0 top-0 flex h-8 items-center justify-between px-2">
                <span>{t('studio.camera')}</span>
                {cameraOn ? (
                  <IconButton
                    label={t('studio.stopCamera')}
                    tooltipSide="left"
                    onClick={() => void stopCamera()}
                    className="size-7 min-h-7 min-w-7 text-white/80 hover:text-white"
                  >
                    <X className="size-3.5" />
                  </IconButton>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <CameraPickerDialog
        open={cameraPickerOpen}
        initialDeviceId={cameraDeviceId}
        onClose={() => setCameraPickerOpen(false)}
        onConfirm={(device) => void camera.activate(device)}
      />

      {liveProvider === 'fast' && <JsPublisherBridge track={sourceTrack} onError={setPublishError} />}
    </div>
  );
}

// Publishes the camera track onto the Reactor `source` slot and surfaces errors.
function JsPublisherBridge({
  track,
  onError,
}: {
  track: MediaStreamTrack | null;
  onError: (err: string | null) => void;
}) {
  const err = useSourcePublisher(track);

  useEffect(() => {
    onError(err);
  }, [err, onError]);

  return null;
}

// SessionBar — transport controls under the Stage.
// Fast = Reactor X2, PRO = fal.ai Lucy 2.5.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Power,
  X,
} from 'lucide-react';
import {
  ArrowCounterClockwise,
  Camera as PhosphorCamera,
  ChatCircleDots,
  Coins,
  Ghost,
  MonitorPlay,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { IconButton } from '@/components/app';
import { usePricingDialog } from '@/hooks/usePricingDialog';
import { useSessionCommands } from '@/lib/session/sessionContext';
import type { Persona } from '@/lib/personas';
import type { LiveProvider } from '@/lib/liveProvider';
import { apiFetch } from '@/lib/api-client';

const GHOST_MODE_KEY = 'henshin.ghostMode.v1';
export type SessionOperation = 'idle' | 'starting' | 'stopping';
type SupportMessage = {
  id: string;
  thread_id: string;
  sender_role: 'client' | 'admin' | 'system';
  body: string;
  created_at: string;
};

function formatSessionDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  const clock = [minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${clock}` : clock;
}

function loadGhostMode() {
  try {
    return localStorage.getItem(GHOST_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function SessionBar({
  cameraOn,
  cameraLabel,
  activePersona,
  liveProvider,
  creditsPerSecond,
  remainingCreditsLabel,
  currentUsage,
  onLiveProviderChange,
  onOpenCameraPicker,
  onStart,
  onStop,
  onToggleObsPreview,
  obsActive,
  operation,
  onError,
  creditsOk = true,
  proAllowed = true,
}: {
  cameraOn: boolean;
  cameraLabel?: string;
  activePersona: Persona | null;
  liveProvider: LiveProvider;
  creditsPerSecond: number;
  remainingCreditsLabel?: string | null;
  currentUsage?: { seconds: number; credits: number } | null;
  onLiveProviderChange: (next: LiveProvider) => void;
  onOpenCameraPicker?: () => void;
  onStart: () => void;
  onStop: () => void;
  onToggleObsPreview: () => void;
  obsActive: boolean;
  operation: SessionOperation;
  onError: (message: string | null) => void;
  creditsOk?: boolean;
  proAllowed?: boolean;
}) {
  const { t } = useTranslation();
  const session = useSessionCommands();
  const { openPricing } = usePricingDialog();
  const { status } = session;
  const busy = operation !== 'idle';

  const idle = status === 'disconnected';
  const starting = status === 'connecting' || status === 'waiting';
  const live = status === 'ready' && session.metadata.generating;
  const [ghost, setGhost] = useState(loadGhostMode);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportExpanded, setSupportExpanded] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [supportThreadId, setSupportThreadId] = useState<string | null>(null);
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportError, setSupportError] = useState<string | null>(null);
  const supportRef = useRef<HTMLDivElement>(null);

  const loadSupport = useCallback(async () => {
    setSupportLoading(true);
    try {
      const suffix = supportThreadId ? `?threadId=${encodeURIComponent(supportThreadId)}` : '';
      const response = await apiFetch(`/support${suffix}`, { retries: 1 });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('studio.supportLoadError'));
      setSupportThreadId(payload.thread?.id || null);
      setSupportMessages(Array.isArray(payload.messages) ? payload.messages : []);
      setSupportError(null);
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : t('studio.supportLoadError'));
    } finally {
      setSupportLoading(false);
    }
  }, [supportThreadId, t]);

  useEffect(() => {
    if (!supportOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!supportRef.current?.contains(event.target as Node)) {
        setSupportOpen(false);
        setSupportExpanded(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSupportOpen(false);
        setSupportExpanded(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [supportOpen]);

  useEffect(() => {
    if (!supportOpen) return;
    void loadSupport();
    const interval = window.setInterval(() => void loadSupport(), 8000);
    return () => window.clearInterval(interval);
  }, [supportOpen, loadSupport]);

  const sendSupportMessage = async () => {
    const message = supportMessage.trim();
    if (!message || supportSending) return;
    setSupportSending(true);
    setSupportError(null);
    try {
      const response = await apiFetch('/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-message', threadId: supportThreadId, message }),
        timeoutMs: 15_000,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('studio.supportSendError'));
      setSupportThreadId(payload.thread?.id || supportThreadId);
      setSupportMessage('');
      await loadSupport();
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : t('studio.supportSendError'));
    } finally {
      setSupportSending(false);
    }
  };

  const closeSupportWidget = () => {
    setSupportOpen(false);
    setSupportExpanded(false);
  };

  const supportTopics = [
    t('studio.supportTopicCamera'),
    t('studio.supportTopicPro'),
    t('studio.supportTopicCredits'),
    t('studio.supportTopicOther'),
  ];

  const toggleGhost = () => {
    const next = !ghost;
    try {
      const bridge = window as unknown as {
        require?: (id: string) => { ipcRenderer: { send: (channel: string, data: unknown) => void } };
      };
      bridge.require?.('electron')?.ipcRenderer.send('toggle-capture-protection', {
        isProtected: next,
      });
    } catch {
      /* not in Electron */
    }
    try {
      localStorage.setItem(GHOST_MODE_KEY, String(next));
    } catch {
      /* persistence unavailable */
    }
    setGhost(next);
  };

  const startDisabledReason = !cameraOn
    ? t('studio.chooseCameraFirst')
    : !activePersona?.imageUrl
      ? t('studio.choosePersonaFirst')
      : !creditsOk
        ? t('studio.insufficientCredits')
        : liveProvider === 'pro' && !proAllowed
          ? t('studio.proRequired')
          : operation === 'starting'
            ? t('studio.starting')
            : null;

  const canStart = cameraOn && Boolean(activePersona?.imageUrl) && idle && !busy && creditsOk && (liveProvider !== 'pro' || proAllowed);

  const statusLabel = live
    ? t('studio.live')
    : starting
      ? t('studio.starting')
      : status === 'ready'
        ? t('studio.connected')
        : t('studio.idle');

  const banner = session.lastError?.message;
  const noCredits = !creditsOk;

  const powerLabel = live || !idle ? t('studio.stopSession') : t('studio.startSession');
  const powerDisabled = busy || (idle && !canStart);
  const rateSummary = `${t('studio.rateLine', { rate: creditsPerSecond })} · ${remainingCreditsLabel || statusLabel}`;
  const elapsedLabel = formatSessionDuration(currentUsage?.seconds ?? 0);

  return (
    <div className="studio-transport relative z-30 flex shrink-0 items-stretch gap-2">
      <div className="session-command-bay flex min-w-0 items-center gap-2">
        <div className="session-control-rail flex min-w-0 items-center gap-2">
        <IconButton
          label={powerLabel}
          tooltipSide="top"
          disabled={powerDisabled}
          onClick={idle ? onStart : onStop}
          title={startDisabledReason || powerLabel}
          className={`session-control-button ${live ? 'is-live' : ''}`}
        >
          {operation !== 'idle' || starting ? <LoaderCircle className="animate-spin" /> : <Power />}
        </IconButton>

        <div
          className={`session-mode-switch ${liveProvider === 'pro' ? 'is-pro' : 'is-fast'}`}
          role="group"
          aria-label={t('studio.fast')}
        >
          <span className="session-mode-switch-thumb" aria-hidden />
          <button
            type="button"
            role="radio"
            aria-checked={liveProvider === 'fast'}
            disabled={!idle}
            title={t('studio.fast')}
            onClick={() => onLiveProviderChange('fast')}
          >
            X2
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={liveProvider === 'pro'}
            disabled={!idle || !proAllowed}
            title={t('studio.proLucyFull')}
            onClick={() => onLiveProviderChange('pro')}
          >
            PRO
          </button>
        </div>

        <div className="session-rail-spacer" />

        <div className="session-live-metrics" title={rateSummary} aria-label={`${rateSummary} · ${elapsedLabel}`}>
          <span>{t('studio.rateLine', { rate: creditsPerSecond })}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{elapsedLabel}</span>
        </div>

        <div className="session-quick-actions" role="group" aria-label={t('common.more')}>
          <IconButton
            label={cameraOn ? cameraLabel || t('studio.camera') : t('studio.chooseCamera')}
            tooltipSide="top"
            disabled={!idle || busy}
            onClick={onOpenCameraPicker}
            className="session-control-button session-quick-button"
          >
            <PhosphorCamera weight="duotone" />
          </IconButton>
          <IconButton
            label={t('studio.resetGeneration')}
            tooltipSide="top"
            disabled={session.kind !== 'fast' || status !== 'ready' || busy}
            onClick={() => {
              onError(null);
              void session.reset().catch((error) => {
                onError(error instanceof Error ? error.message : String(error));
              });
            }}
            className="session-control-button session-quick-button"
          >
            <ArrowCounterClockwise weight="duotone" />
          </IconButton>
          <IconButton
            label={ghost ? t('studio.disableGhost') : t('studio.enableGhost')}
            tooltipSide="top"
            aria-pressed={ghost}
            onClick={toggleGhost}
            className={`session-control-button session-quick-button ${ghost ? 'is-active' : ''}`}
          >
            <Ghost weight="duotone" />
          </IconButton>
          <IconButton
            label={obsActive ? t('studio.closeObs') : t('studio.openObs')}
            tooltipSide="top"
            aria-pressed={obsActive}
            onClick={onToggleObsPreview}
            className={`session-control-button session-quick-button ${obsActive ? 'is-active' : ''}`}
          >
            <MonitorPlay weight="duotone" />
          </IconButton>
          {noCredits ? (
            <IconButton
              label={t('studio.addCredits')}
              tooltipSide="top"
              onClick={openPricing}
              className="session-control-button session-quick-button"
            >
              <Coins weight="duotone" />
            </IconButton>
          ) : null}
        </div>

          <span className="sr-only" aria-live="polite">
            {rateSummary}
            {currentUsage && status !== 'disconnected'
              ? ` · ${t('studio.usageLine', {
                  credits: currentUsage.credits,
                  seconds: currentUsage.seconds,
                })}`
              : ''}
          </span>
        </div>

      </div>

      <div ref={supportRef} className="session-support-anchor">
        <IconButton
          label={t('studio.contactWhatsApp')}
          tooltipSide="top"
          aria-expanded={supportOpen}
          aria-controls="session-support-widget"
          onClick={() => setSupportOpen((open) => !open)}
          className={`session-panel-button ${supportOpen ? 'is-active' : ''}`}
        >
          <ChatCircleDots size={27} weight="duotone" />
        </IconButton>

        {supportOpen ? (
          <section
            id="session-support-widget"
            role="dialog"
            aria-label={t('studio.supportTitle')}
            className={`session-support-widget ${supportExpanded ? 'is-expanded' : ''}`}
          >
            <header className="session-support-header">
              <button
                type="button"
                className="session-support-header-action"
                aria-label={t('common.back')}
                onClick={closeSupportWidget}
              >
                <ArrowLeft />
              </button>
              <div className="session-support-identity">
                <span className="session-support-mark" aria-hidden>
                  <WhatsappLogo size={20} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2>{t('studio.supportTitle')}</h2>
                  <p>{t('studio.supportBody')}</p>
                </div>
              </div>
              <button
                type="button"
                className="session-support-header-action"
                aria-label={supportExpanded ? t('studio.supportRestore') : t('studio.supportExpand')}
                onClick={() => setSupportExpanded((expanded) => !expanded)}
              >
                {supportExpanded ? <Minimize2 /> : <Maximize2 />}
              </button>
              <button
                type="button"
                className="session-support-header-action"
                aria-label={t('common.close')}
                onClick={closeSupportWidget}
              >
                <X />
              </button>
            </header>

            <div className="session-support-conversation custom-scrollbar">
              <p className="session-support-availability">{t('studio.supportAvailability')}</p>
              {supportMessages.length === 0 ? (
                <>
                  <div className="session-support-assistant-message">
                    {t('studio.supportWelcome')}
                  </div>
                  <div className="session-support-topics">
                    {supportTopics.map((topic) => (
                      <button key={topic} type="button" onClick={() => setSupportMessage(topic)}>
                        {topic}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="session-support-message-list" aria-live="polite">
                  {supportMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`session-support-message is-${message.sender_role}`}
                    >
                      <p>{message.body}</p>
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </time>
                    </article>
                  ))}
                </div>
              )}
              {supportLoading && supportMessages.length === 0 ? (
                <p className="session-support-feedback">{t('common.loading')}</p>
              ) : null}
            </div>

            <footer className="session-support-composer">
              {supportError ? <p className="session-support-error" role="alert">{supportError}</p> : null}
              <label className="sr-only" htmlFor="session-support-message">
                {t('studio.supportMessageLabel')}
              </label>
              <textarea
                id="session-support-message"
                value={supportMessage}
                onChange={(event) => setSupportMessage(event.target.value)}
                placeholder={t('studio.supportPlaceholder')}
                rows={3}
              />
              <button
                type="button"
                className="session-support-send"
                onClick={() => void sendSupportMessage()}
                disabled={supportSending || !supportMessage.trim()}
              >
                <WhatsappLogo size={18} weight="fill" />
                {supportSending ? t('studio.supportSending') : t('studio.sendSupportWhatsApp')}
              </button>
            </footer>
          </section>
        ) : null}
      </div>

      {banner ? (
        <p className="session-error-banner absolute bottom-[calc(100%+8px)] left-0 max-w-full rounded-lg px-3 py-2 text-xs text-destructive">
          {banner}
        </p>
      ) : null}
    </div>
  );
}

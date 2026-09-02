// Stage — the model's edited output filling the workspace. The stable source
// camera preview now lives at the bottom of the Persona inspector.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X2MainVideoView } from '@reactor-models/x2';
import { Camera } from 'lucide-react';
import { AppButton } from '@/components/app';
import { useSessionCommands } from '@/lib/session/sessionContext';
import type { LiveProvider } from '@/lib/liveProvider';

function Placeholder({
  provider,
  cameraOn,
  onChooseCamera,
}: {
  provider: LiveProvider;
  cameraOn: boolean;
  onChooseCamera: () => void;
}) {
  const { t } = useTranslation();
  const { status } = useSessionCommands();
  const copy =
    provider === 'pro'
      ? status === 'disconnected'
        ? { title: t('studio.ready'), subtitle: t('studio.pickPersona') }
        : { title: t('studio.connectingPro'), subtitle: t('studio.openingLucy') }
      : status === 'disconnected'
        ? { title: t('studio.ready'), subtitle: t('studio.pickCamera') }
        : status === 'connecting'
          ? { title: t('studio.starting'), subtitle: t('studio.openingSession') }
          : status === 'waiting'
            ? { title: t('studio.starting'), subtitle: t('studio.modelBoots') }
            : { title: t('studio.live'), subtitle: t('studio.generationStarting') };
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 px-6 text-center transition-opacity duration-200">
      <div className="mb-4 grid size-11 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <Camera className="size-5" strokeWidth={1.5} />
      </div>
      <p className="text-xl font-medium tracking-[-0.02em] text-white/80">{copy.title}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-white/45">{copy.subtitle}</p>
      {!cameraOn ? (
        <AppButton variant="secondary" size="sm" className="mt-5" onClick={onChooseCamera}>
          <Camera className="size-3.5" />
          {t('studio.chooseCamera')}
        </AppButton>
      ) : null}
    </div>
  );
}
export function Stage({
  generating,
  activeLabel,
  cameraOn,
  sourceStream,
  remoteStream,
  remotePlayNonce,
  liveProvider,
  webcamVideoRef,
  outputHostRef,
  onTrack,
  onChooseCamera,
}: {
  generating: boolean;
  activeLabel?: string | null;
  cameraOn: boolean;
  /** Raw camera stream acquired by the Workspace. */
  sourceStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remotePlayNonce?: number;
  liveProvider: LiveProvider;
  /** Stable hidden <video> that carries the raw camera feed (PiP + providers). */
  webcamVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** Host of the visible edited output — vcam capture resolves its <video>. */
  outputHostRef: React.RefObject<HTMLDivElement | null>;
  onTrack?: (track: MediaStreamTrack | null) => void;
  onChooseCamera: () => void;
}) {
  const { t } = useTranslation();
  const proLive = liveProvider === 'pro' && Boolean(remoteStream);

  // Bind the raw camera stream to the PiP video and report its track up.
  useEffect(() => {
    const video = webcamVideoRef.current;
    if (!video) return;
    if (video.srcObject !== sourceStream) {
      video.srcObject = sourceStream;
      void video.play().catch(() => {});
    }
    if (sourceStream) {
      const track = sourceStream.getVideoTracks()[0] ?? null;
      onTrack?.(track);
    } else {
      onTrack?.(null);
    }
  }, [sourceStream, webcamVideoRef, onTrack]);

  // Bind the Lucy remote stream to the visible PRO video element.
  useEffect(() => {
    if (liveProvider !== 'pro') return;
    const host = outputHostRef.current;
    const video = host?.querySelector('video');
    if (!video || !remoteStream) return;

    video.srcObject = remoteStream;
    video.muted = true;
    video.playbackRate = 1;
    (video as HTMLVideoElement & { latencyHint?: string }).latencyHint = 'interactive';

    const play = () => {
      void video.play().catch(() => {});
    };
    const onUnmute = () => play();
    const tracks = remoteStream.getVideoTracks();
    for (const track of tracks) {
      track.addEventListener('unmute', onUnmute);
    }
    video.addEventListener('loadedmetadata', play);
    play();
    return () => {
      video.removeEventListener('loadedmetadata', play);
      for (const track of tracks) {
        track.removeEventListener('unmute', onUnmute);
      }
      if (video.srcObject === remoteStream) video.srcObject = null;
    };
  }, [remoteStream, remotePlayNonce, liveProvider, outputHostRef]);

  return (
    <section className="studio-stage relative min-h-0 w-full flex-1 overflow-hidden rounded-xl">
      <div ref={outputHostRef} className="absolute inset-0">
        {liveProvider === 'pro' ? (
          <video
            id="output"
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <X2MainVideoView videoObjectFit="contain" className="absolute inset-0 h-full w-full" />
        )}
        {!generating && !proLive && (
          <Placeholder provider={liveProvider} cameraOn={cameraOn} onChooseCamera={onChooseCamera} />
        )}
        <span className="pointer-events-none absolute left-2 top-2 max-w-[40%] truncate rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-tight text-white/60">
          {generating ? (activeLabel ?? t('studio.edited')) : t('studio.edited')}
        </span>
      </div>

    </section>
  );
}

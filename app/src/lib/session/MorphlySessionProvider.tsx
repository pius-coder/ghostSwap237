// Morphly Lucy 2.5 engine (deprecated) wrapped in the shared SessionCommands
// interface. The connect flow is the one that shipped with Henshin: dynamic
// SDK import, /morphly-token endpoint, renderable-stream probe and first-frame
// deadline — moved verbatim out of the old Dashboard monolith.
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getApiUrl } from '@/lib/api-client';
import {
  EMPTY_SESSION_METADATA,
  SessionCommandsContext,
  type SessionCommands,
  type SessionConnectOptions,
  type SessionStatus,
} from './sessionContext';

const MORPHLY_SDK_URL = 'https://morphly.fun/sdk/morphly.js';
const MORPHLY_REALTIME_MODEL = 'lucy-2.5';
const MORPHLY_OUTPUT_RESOLUTION = '1080p';
const MORPHLY_MAX_SESSION_SECONDS = 300;
const REMOTE_VIDEO_READY_TIMEOUT_MS = 12_000;
const REMOTE_VIDEO_VISIBLE_TIMEOUT_MS = 20_000;
const MORPHLY_FIRST_FRAME_TIMEOUT_MS =
  REMOTE_VIDEO_READY_TIMEOUT_MS + REMOTE_VIDEO_VISIBLE_TIMEOUT_MS + 5_000;

interface RealtimeClient {
  disconnect: () => void;
  set: (config: { prompt?: string; enhance?: boolean; image?: string | Blob | File }) => Promise<void>;
  setPrompt: (text: string, options?: { enhance?: boolean }) => Promise<void>;
}

function emitElectronLog(level: 'log' | 'info' | 'warn' | 'error', message: string, data?: unknown) {
  try {
    if (typeof window !== 'undefined' && typeof window.require !== 'undefined') {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('renderer-log', { level, message, data });
    }
  } catch {
    // Ignore logging bridge failures.
  }
}

/** Waits for the remote stream to carry actual visible frames (not black). */
async function waitForRenderableStream(stream: MediaStream): Promise<void> {
  const probeVideo = document.createElement('video');
  const probeCanvas = document.createElement('canvas');
  const probeContext = probeCanvas.getContext('2d', { willReadFrequently: true });

  if (!probeContext) {
    throw new Error('Could not create Morphly probe context');
  }

  probeCanvas.width = 32;
  probeCanvas.height = 18;
  probeVideo.muted = true;
  probeVideo.autoplay = true;
  probeVideo.playsInline = true;
  probeVideo.srcObject = stream;

  await probeVideo.play().catch(() => {});

  const hasVisiblePixels = () => {
    if (
      probeVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      probeVideo.videoWidth <= 0 ||
      probeVideo.videoHeight <= 0
    ) {
      return false;
    }

    probeContext.drawImage(probeVideo, 0, 0, probeCanvas.width, probeCanvas.height);
    const { data } = probeContext.getImageData(0, 0, probeCanvas.width, probeCanvas.height);

    let brightPixelCount = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];

      if (red > 16 || green > 16 || blue > 16) {
        brightPixelCount++;
        if (brightPixelCount >= 8) {
          return true;
        }
      }
    }

    return false;
  };

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      if (visibilityCheckId !== null) {
        window.clearInterval(visibilityCheckId);
      }
      probeVideo.removeEventListener('loadeddata', maybeReady);
      probeVideo.removeEventListener('playing', maybeReady);
      probeVideo.removeEventListener('resize', maybeReady);
    };

    const maybeReady = () => {
      if (
        probeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        probeVideo.videoWidth > 0 &&
        probeVideo.videoHeight > 0
      ) {
        const visibleDeadline = window.setTimeout(() => {
          cleanup();
          reject(new Error('Timed out waiting for non-black Morphly video frames'));
        }, REMOTE_VIDEO_VISIBLE_TIMEOUT_MS);

        const finishVisibleCheck = () => {
          window.clearTimeout(visibleDeadline);
          cleanup();
          resolve();
        };

        const visibilityCheck = () => {
          if (hasVisiblePixels()) {
            finishVisibleCheck();
          }
        };

        visibilityCheck();
        visibilityCheckId = window.setInterval(visibilityCheck, 100);

        probeVideo.removeEventListener('loadeddata', maybeReady);
        probeVideo.removeEventListener('playing', maybeReady);
        probeVideo.removeEventListener('resize', maybeReady);
      }
    };

    let visibilityCheckId: number | null = null;
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for Morphly video frames'));
    }, REMOTE_VIDEO_READY_TIMEOUT_MS);

    probeVideo.addEventListener('loadeddata', maybeReady);
    probeVideo.addEventListener('playing', maybeReady);
    probeVideo.addEventListener('resize', maybeReady);
    maybeReady();
  });

  probeVideo.srcObject = null;
}

export function MorphlySessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('disconnected');
  const [lastError, setLastError] = useState<{ message: string } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remotePlayNonce, setRemotePlayNonce] = useState(0);
  const clientRef = useRef<RealtimeClient | null>(null);
  const promptRef = useRef('');
  const imageRef = useRef<Blob | undefined>(undefined);
  const statusRef = useRef<SessionStatus>('disconnected');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const disconnect = useCallback(async () => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setRemoteStream(null);
    setStatus((current) => (current === 'disconnected' ? current : 'disconnected'));
  }, []);

  const connect = useCallback(
    async (opts?: SessionConnectOptions) => {
      const stream = opts?.stream;
      if (!stream) throw new Error('A camera stream is required for Morphly sessions.');

      promptRef.current = opts?.prompt ?? '';
      imageRef.current = opts?.image;

      let firstFrameTimeoutId: number | null = null;
      let settleRemoteReady: (() => void) | null = null;
      let settleRemoteError: ((error: Error) => void) | null = null;
      let remoteReadySettled = false;

      const remoteReadyPromise = new Promise<void>((resolve, reject) => {
        const resolveOnce = () => {
          if (remoteReadySettled) return;
          remoteReadySettled = true;
          if (firstFrameTimeoutId !== null) window.clearTimeout(firstFrameTimeoutId);
          resolve();
        };
        const rejectOnce = (error: Error) => {
          if (remoteReadySettled) return;
          remoteReadySettled = true;
          if (firstFrameTimeoutId !== null) window.clearTimeout(firstFrameTimeoutId);
          reject(error);
        };

        settleRemoteReady = resolveOnce;
        settleRemoteError = rejectOnce;
        firstFrameTimeoutId = window.setTimeout(() => {
          rejectOnce(new Error('Morphly connected but did not return a usable video frame.'));
        }, MORPHLY_FIRST_FRAME_TIMEOUT_MS);
      });
      void remoteReadyPromise.catch(() => {});

      try {
        setStatus('connecting');
        setLastError(null);

        const { createMorphlyClient } = await import(/* @vite-ignore */ MORPHLY_SDK_URL);

        const tokenEndpoint = `${getApiUrl('/morphly-token')}`;
        const client = createMorphlyClient({ tokenEndpoint });

        const session = await client.realtime.connect(stream, {
          model: MORPHLY_REALTIME_MODEL,
          prompt: promptRef.current,
          image: imageRef.current,
          enhancePrompt: true,
          resolution: MORPHLY_OUTPUT_RESOLUTION,
          maxSessionSeconds: MORPHLY_MAX_SESSION_SECONDS,
          onRemoteStream: (editedStream: MediaStream) => {
            void (async () => {
              emitElectronLog('info', '[Morphly] Remote stream received');

              try {
                await waitForRenderableStream(editedStream);
              } catch (renderError) {
                emitElectronLog(
                  'warn',
                  '[Morphly] Remote stream did not produce visible frames',
                  String(renderError),
                );
                settleRemoteError?.(
                  renderError instanceof Error
                    ? renderError
                    : new Error('Morphly did not return visible video frames.'),
                );
                return;
              }

              const liveTracks = editedStream
                .getVideoTracks()
                .filter((track) => track.readyState === 'live');
              if (liveTracks.length === 0) {
                settleRemoteError?.(
                  new Error('Morphly connected but its video track ended before the first frame.'),
                );
                return;
              }

              editedStream.getVideoTracks().forEach((track) => {
                track.addEventListener('ended', () => {
                  emitElectronLog('warn', '[Morphly] Remote video track ended');
                });
              });

              setRemoteStream(editedStream);
              setRemotePlayNonce((n) => n + 1);
              setStatus('ready');
              settleRemoteReady?.();
            })();
          },
        });

        clientRef.current = session as RealtimeClient;
        await remoteReadyPromise;
      } catch (error) {
        if (firstFrameTimeoutId !== null) window.clearTimeout(firstFrameTimeoutId);
        console.error('[Morphly] SDK error:', error);
        emitElectronLog('error', '[Morphly] SDK error', String(error));

        clientRef.current?.disconnect();
        clientRef.current = null;
        setRemoteStream(null);
        setStatus('disconnected');

        const morphlyError = error as { code?: string; status?: number };
        if (morphlyError?.code === 'REALTIME_TEMPORARILY_DISABLED' || morphlyError?.status === 503) {
          setLastError({
            message:
              'Morphly realtime sessions are temporarily paused for maintenance. Please try again later.',
          });
          throw new Error(
            'Morphly realtime sessions are temporarily paused for maintenance. Please try again later.',
          );
        }

        const message = error instanceof Error ? error.message : 'Failed to connect to Morphly.';
        setLastError({ message });
        throw error instanceof Error ? error : new Error(message);
      }
    },
    [],
  );

  const requireReady = useCallback(() => {
    if (statusRef.current !== 'ready') {
      throw new Error(`Start a session before this action (status: ${statusRef.current}).`);
    }
  }, []);

  const reset = useCallback(async () => {
    requireReady();
  }, [requireReady]);

  const setPrompt = useCallback(async ({ prompt }: { prompt?: string }) => {
    requireReady();
    await clientRef.current?.setPrompt(prompt ?? '', { enhance: true });
  }, [requireReady]);

  const setPointer = useCallback(async () => false, []);

  const setKeepBacklog = useCallback(async () => {}, []);

  const setReferenceImage = useCallback(async ({ blob }: { blob?: Blob }) => {
    requireReady();
    if (!blob) return;
    await clientRef.current?.set({ prompt: promptRef.current, enhance: true, image: blob });
  }, [requireReady]);

  useEffect(() => () => void disconnect(), [disconnect]);

  const value = useMemo<SessionCommands>(
    () => ({
      kind: 'pro',
      status,
      metadata:
        status === 'ready' && remoteStream
          ? { ...EMPTY_SESSION_METADATA, generating: true, hasReference: true }
          : EMPTY_SESSION_METADATA,
      lastError,
      remoteStream,
      remotePlayNonce,
      connect,
      disconnect,
      reset,
      setPrompt,
      setPointer,
      setKeepBacklog,
      setReferenceImage,
    }),
    [status, lastError, remoteStream, remotePlayNonce, connect, disconnect, reset, setPrompt, setPointer, setKeepBacklog, setReferenceImage],
  );

  return (
    <RemoteStreamContext.Provider value={null}>
      <SessionCommandsContext.Provider value={value}>{children}</SessionCommandsContext.Provider>
    </RemoteStreamContext.Provider>
  );
}

const RemoteStreamContext = createContext<MediaStream | null>(null);

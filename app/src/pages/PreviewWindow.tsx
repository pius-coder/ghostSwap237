import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function PreviewWindow() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastStreamRef = useRef<MediaStream | null>(null);
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    document.title = t('preview.windowTitle');
  }, [t]);

  useEffect(() => {
    const previewVideo = videoRef.current;

    const syncFromDashboard = () => {
      if (!previewVideo) {
        return;
      }

      const openerWindow = window.opener as Window | null;

      if (!openerWindow || openerWindow.closed) {
        if (previewVideo.srcObject) {
          previewVideo.srcObject = null;
        }

        lastStreamRef.current = null;
        setHasStream(false);
        return;
      }

      const sourceVideo = openerWindow.document.getElementById('output') as HTMLVideoElement | null;
      const sourceStream = (sourceVideo?.srcObject as MediaStream | null) ?? null;

      if (sourceStream !== lastStreamRef.current) {
        previewVideo.srcObject = sourceStream;
        lastStreamRef.current = sourceStream;
      }

      setHasStream(Boolean(sourceStream));

      if (sourceStream && previewVideo.paused) {
        previewVideo.play().catch(() => {});
      }
    };

    syncFromDashboard();
    const intervalId = window.setInterval(syncFromDashboard, 250);

    return () => {
      window.clearInterval(intervalId);

      if (previewVideo) {
        previewVideo.srcObject = null;
      }
    };
  }, []);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full ${hasStream ? 'block object-contain' : 'hidden'}`}
      />

      {!hasStream && (
        <div className="w-full h-full flex items-center justify-center bg-black text-center px-6">
          <div className="max-w-md">
            <h1 className="text-white text-3xl font-semibold tracking-[0.08em] uppercase">{t('preview.windowTitle')}</h1>
            <p className="mt-4 text-sm text-muted-foreground">
              {t('preview.waiting')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PreviewWindow;

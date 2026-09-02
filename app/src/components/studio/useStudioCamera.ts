import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { LiveProvider } from '@/lib/liveProvider';
import type { CameraDeviceOption } from '@/lib/cameraDevices';

export function useStudioCamera(liveProvider: LiveProvider) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceStream, setSourceStream] = useState<MediaStream | null>(null);
  const [sourceTrack, setSourceTrack] = useState<MediaStreamTrack | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setSourceStream(null);
    setSourceTrack(null);
    setDeviceId(null);
    setLabel('');
  }, []);

  const activate = useCallback(async (device: CameraDeviceOption) => {
    try {
      const constraints: MediaTrackConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
        deviceId: { exact: device.deviceId },
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
      const [track] = stream.getVideoTracks();
      if (track) track.contentHint = liveProvider === 'pro' ? 'motion' : 'detail';

      streamRef.current?.getTracks().forEach((item) => item.stop());
      streamRef.current = stream;
      setSourceStream(stream);
      setSourceTrack(track ?? null);
      setDeviceId(device.deviceId);
      setLabel(device.label);
      setPickerOpen(false);
    } catch (error) {
      console.error('Webcam error:', error);
      toast.error(t('studio.webcamFailed'));
    }
  }, [liveProvider, t]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return {
    cameraOn: Boolean(sourceStream?.getVideoTracks().some((track) => track.readyState === 'live')),
    deviceId,
    label,
    pickerOpen,
    setPickerOpen,
    sourceStream,
    sourceTrack,
    setSourceTrack,
    streamRef,
    webcamVideoRef,
    activate,
    release,
  };
}

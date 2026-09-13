import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui';

/**
 * Camera QR scanner for the device-approval flow. Prefers the native `BarcodeDetector` (Chrome/Android —
 * where the RuStore TWA runs), lazily falls back to `jsqr` on desktops that lack it. Every camera track is
 * stopped via a single `cleanup()` reached from success, close, unmount, and error paths — a leaked track
 * leaves the camera LED on and reads as spyware.
 */
type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };

async function makeBarcodeDetector(): Promise<Detector | null> {
  try {
    const BD = (window as unknown as {
      BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> };
    }).BarcodeDetector;
    if (!BD) return null;
    const formats = await BD.getSupportedFormats();
    if (!formats.includes('qr_code')) return null;
    return new BD({ formats: ['qr_code'] });
  } catch {
    return null; // constructor throws on platforms that expose BarcodeDetector but not qr_code
  }
}

type Status = 'starting' | 'scanning' | 'denied' | 'nocam' | 'insecure' | 'error';

export function QrScanner({
  onResult,
  onClose,
  ru,
  accept,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
  ru: boolean;
  /** Optional guard: only a QR whose text passes this is accepted — a stray poster/URL QR keeps scanning. */
  accept?: (text: string) => boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('starting');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const canvas = document.createElement('canvas');

    const cleanup = () => {
      done = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      stream = null;
    };
    const finish = (text: string) => {
      if (done) return;
      cleanup();
      onResult(text);
    };

    void (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('insecure');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e) {
        setStatus((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'nocam');
        return;
      }
      if (done) {
        stream.getTracks().forEach((t) => t.stop()); // unmounted during the permission await
        return;
      }
      const video = videoRef.current;
      if (!video) {
        cleanup();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus('scanning');

      const detector = await makeBarcodeDetector();
      let jsqr: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
      if (!detector) {
        try {
          jsqr = (await import('jsqr')).default;
        } catch {
          cleanup(); // stream is already live here — don't leave the camera on behind the error overlay
          setStatus('error');
          return;
        }
      }

      const tick = async () => {
        const v = videoRef.current;
        if (done || !v) return;
        if (v.readyState >= 2 && v.videoWidth) {
          const ok = (t: string | undefined): t is string => !!t && (!accept || accept(t));
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (ok(codes[0]?.rawValue)) return finish(codes[0].rawValue); // else a non-matching QR → keep scanning
            } else if (jsqr) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const r = jsqr(img.data, img.width, img.height);
                if (ok(r?.data)) return finish(r!.data);
              }
            }
          } catch {
            // transient decode/frame error — keep scanning
          }
        }
        if (!done) raf = requestAnimationFrame(() => void tick());
      };
      raf = requestAnimationFrame(() => void tick());
    })();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errorText: Partial<Record<Status, string>> = {
    denied: ru ? 'Нет доступа к камере — разрешите его в браузере и попробуйте снова.' : 'Camera denied — allow it in the browser and retry.',
    nocam: ru ? 'Камера недоступна на этом устройстве.' : 'No camera available on this device.',
    insecure: ru ? 'Камера требует HTTPS.' : 'The camera needs HTTPS.',
    error: ru ? 'Не удалось запустить сканер.' : 'Could not start the scanner.',
  };

  return (
    <div className="mt-3 rounded-sm border border-line bg-surface p-3">
      <div className="relative overflow-hidden rounded-sm bg-ink" style={{ aspectRatio: '1 / 1', maxWidth: 260 }}>
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {status !== 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-2xs text-muted">
            {status === 'starting' ? (ru ? 'Запуск камеры…' : 'Starting camera…') : errorText[status]}
          </div>
        )}
      </div>
      <p className="mt-2 text-2xs text-muted">{ru ? 'Наведите камеру на QR-код с нового устройства.' : 'Point the camera at the QR on the new device.'}</p>
      <Button size="sm" variant="ghost" className="mt-2" onClick={onClose}>
        {ru ? 'Закрыть' : 'Close'}
      </Button>
    </div>
  );
}

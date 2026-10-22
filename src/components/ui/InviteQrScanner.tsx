import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { parseInviteUrl } from '../../lib/inviteUrl';
import { ErrorMessage } from './ErrorMessage';

interface InviteQrScannerProps {
  onScan: (token: string) => void;
  onClose: () => void;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function getBarcodeDetector(): BarcodeDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
}

export function InviteQrScanner({ onScan, onClose }: InviteQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannedRef = useRef(false);
  const lastInvalidValueRef = useRef<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let detecting = false;

    const stopStream = (stream: MediaStream | null) => {
      stream?.getTracks().forEach((track) => track.stop());
    };
    const stopCamera = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      setCameraError(null);
      setScanError(null);
      const Detector = getBarcodeDetector();
      if (!Detector) {
        setCameraError(
          'QR scanning is not supported in this browser. Open the invitation link instead.'
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access is unavailable. Open the invitation link instead.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (disposed) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stopCamera();
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (disposed) {
          stopCamera();
          return;
        }

        const detector = new Detector({ formats: ['qr_code'] });
        interval = setInterval(async () => {
          if (disposed || detecting || scannedRef.current || video.readyState < 2) return;
          detecting = true;
          try {
            let barcode: DetectedBarcode | undefined;
            try {
              [barcode] = await detector.detect(video);
            } catch {
              if (!disposed) {
                setCameraError('QR scanning stopped unexpectedly. Try starting the camera again.');
                stopCamera();
              }
              return;
            }
            if (!barcode || disposed || scannedRef.current) return;
            try {
              const token = parseInviteUrl(
                barcode.rawValue,
                import.meta.env['VITE_APP_URL'] as string | undefined,
                window.location.origin,
                import.meta.env.PROD
              );
              scannedRef.current = true;
              setScanError(null);
              onScan(token);
            } catch (scanError) {
              if (
                scanError instanceof Error &&
                scanError.message.startsWith('This QR code') &&
                lastInvalidValueRef.current !== barcode.rawValue
              ) {
                lastInvalidValueRef.current = barcode.rawValue;
                setScanError(scanError.message);
              }
            }
          } finally {
            detecting = false;
          }
        }, 250);
      } catch {
        if (!disposed) {
          setCameraError('Camera could not be started. Check camera permission and try again.');
          stopCamera();
        }
      }
    };

    void start();
    return () => {
      disposed = true;
      stopCamera();
    };
  }, [onScan, retryAttempt]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Scan invitation QR code"
    >
      <button
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close scanner"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl bg-[rgb(var(--color-bg))] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-primary text-base font-semibold">Scan invitation QR code</h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {cameraError ? (
          <ErrorMessage
            message={cameraError}
            retry={() => setRetryAttempt((attempt) => attempt + 1)}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                className="aspect-square w-full object-cover"
                autoPlay
                muted
                playsInline
                aria-label="Camera view for QR scanning"
              />
            </div>
            <p className="text-muted mt-3 flex items-center justify-center gap-2 text-sm">
              <Camera size={16} aria-hidden="true" /> Point the camera at a Fall Split invite QR
              code.
            </p>
          </>
        )}
        {scanError && (
          <p className="mt-3 text-center text-sm text-[rgb(var(--color-negative))]" role="alert">
            {scanError}
          </p>
        )}
      </div>
    </div>
  );
}

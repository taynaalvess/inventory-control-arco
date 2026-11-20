import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { CameraOff, X } from 'lucide-react';

/**
 * Leitura de código de barras/QR pela câmera do celular ou webcam.
 * Requer HTTPS (o GitHub Pages já é HTTPS).
 */
export function CameraScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let stopped = false;
    let last = { code: '', at: 0 };

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        videoRef.current!,
        (result) => {
          if (!result) return;
          const code = result.getText();
          const now = Date.now();
          if (code === last.code && now - last.at < 1500) return; // evita leitura duplicada
          last = { code, at: now };
          setFlash(true);
          setTimeout(() => setFlash(false), 180);
          cb.current(code);
        },
      )
      .then((c) => {
        if (stopped) c.stop();
        else controls = c;
      })
      .catch((e: Error) => {
        setError(
          e?.name === 'NotAllowedError'
            ? 'Permissão da câmera negada. Libere o acesso nas configurações do navegador.'
            : e?.name === 'NotFoundError'
              ? 'Nenhuma câmera encontrada neste dispositivo.'
              : `Não foi possível abrir a câmera: ${e?.message ?? e}`,
        );
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
      {!error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={`h-1/2 w-3/4 rounded-xl border-2 transition ${flash ? 'border-emerald-400 bg-emerald-400/20' : 'border-white/70'}`}>
            <div className="scanline mx-2 h-0.5 bg-rose-500/80 shadow-[0_0_8px_2px_rgba(244,63,94,0.6)]" />
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white">
          <CameraOff size={28} />
          {error}
        </div>
      )}
      <button onClick={onClose} className="absolute top-2 right-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80" aria-label="Fechar câmera">
        <X size={18} />
      </button>
    </div>
  );
}

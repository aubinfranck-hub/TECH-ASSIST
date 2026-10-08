import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

/**
 * Voix de l'assistant IA : lecture à voix haute (voix neuronale Google via notre serveur, sinon la voix du navigateur), dictée au
 * micro (reconnaissance vocale du navigateur) et capture d'écran à montrer à l'IA. Chaque outil se cache s'il ne peut pas fonctionner.
 */

let current: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  current?.pause();
  current = null;
  window.speechSynthesis?.cancel();
}

/** Lit un texte : voix Google d'abord, voix du navigateur en secours. Renvoie 'google' ou 'browser'. */
export async function speak(sessionId: string, sessionCode: string, text: string): Promise<'google' | 'browser'> {
  stopSpeaking();
  try {
    const res = await api.post<{ audio: string; mime: string }>(`/api/sessions/${sessionId}/tts`, { sessionCode, text });
    const audio = new Audio(`data:${res.mime};base64,${res.audio}`);
    current = audio;
    audio.onended = () => {
      if (current === audio) current = null;
    };
    await audio.play();
    return 'google';
  } catch (err) {
    if (!(err instanceof ApiError) && !(err instanceof DOMException)) throw err;
    if (!window.speechSynthesis) throw err;
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#]/g, '').slice(0, 900));
    u.lang = 'fr-FR';
    window.speechSynthesis.speak(u);
    return 'browser';
  }
}

export function useTtsAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    api.get<{ available: boolean }>('/api/tts/status').then((r) => setAvailable(r.available)).catch(() => setAvailable(false));
  }, []);
  // Sans voix Google, la voix du navigateur reste proposée.
  return available || typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function SpeakButton({ sessionId, sessionCode, text }: { sessionId: string; sessionCode: string; text: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void speak(sessionId, sessionCode, text).catch(() => undefined).finally(() => setBusy(false));
      }}
      className="mt-1 text-xs font-semibold text-brand-700 hover:underline disabled:opacity-50"
      aria-label="Écouter cette réponse"
    >
      {busy ? '🔊 …' : '🔊 Écouter'}
    </button>
  );
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const ref = useRef<RecognitionLike | null>(null);
  const Ctor = typeof window !== 'undefined' ? recognitionCtor() : null;
  if (!Ctor) return null;
  function toggle() {
    if (listening) {
      ref.current?.stop();
      return;
    }
    const rec = new Ctor!();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0]?.transcript ?? '').join(' ').trim();
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    ref.current = rec;
    setListening(true);
    rec.start();
  }
  return (
    <button type="button" disabled={disabled} onClick={toggle} className={`rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${listening ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
      {listening ? '⏹ J’écoute… (arrêter)' : '🎤 Parler'}
    </button>
  );
}

export interface CapturedImage {
  mime: 'image/jpeg';
  data: string;
}

/** Une capture de l'écran (ou d'une fenêtre) choisie par le client, réduite pour rester légère. Jamais conservée par le serveur. */
export async function captureScreen(maxChars = 780_000): Promise<CapturedImage> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 400));
    for (const [width, quality] of [[1280, 0.7], [1024, 0.6], [800, 0.55], [640, 0.5]] as const) {
      const scale = Math.min(1, width / (video.videoWidth || width));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((video.videoWidth || width) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || width * 0.6) * scale));
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
      if (data.length <= maxChars) return { mime: 'image/jpeg', data };
    }
    throw new Error('Capture trop lourde');
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function ScreenShotButton({ onCapture, disabled }: { onCapture: (image: CapturedImage) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) return null;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          captureScreen()
            .then(onCapture)
            .catch((e: unknown) => setError(e instanceof DOMException ? 'Partage annulé.' : 'Capture impossible.'))
            .finally(() => setBusy(false));
        }}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? '📷 …' : '📷 Montrer mon écran'}
      </button>
      {error && <span className="mt-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

// melodyflix web — Voice Search (Section 5.6)
// Wraps the Web Speech API (SpeechRecognition). Chrome/Edge/Safari
// support; Firefox does not. Falls back to unsupported gracefully.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseVoiceSearchOptions {
  lang?: string;              // BCP-47, default 'en-US'
  continuous?: boolean;       // default false
  interimResults?: boolean;   // default true
  onFinal?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  onError?: (err: string) => void;
}

export interface UseVoiceSearchResult {
  supported: boolean;
  listening: boolean;
  interim: string;
  final: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useVoiceSearch(opts: UseVoiceSearchOptions = {}): UseVoiceSearchResult {
  const {
    lang = 'en-US',
    continuous = false,
    interimResults = true,
    onFinal,
    onInterim,
    onError,
  } = opts;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [final, setFinal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const supported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window ||
    'webkitSpeechRecognition' in window
  );

  // Refs so handlers don't stale-close
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onFinalRef.current = onFinal;
    onInterimRef.current = onInterim;
    onErrorRef.current = onError;
  }, [onFinal, onInterim, onError]);

  const buildRecognition = useCallback(() => {
    if (!supported) return null;
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      let interimText = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (interimText) {
        setInterim(interimText);
        onInterimRef.current?.(interimText);
      }
      if (finalText) {
        setInterim('');
        setFinal(finalText);
        onFinalRef.current?.(finalText);
      }
    };
    rec.onerror = (e: any) => {
      const msg = e?.error ?? 'speech-error';
      setError(msg);
      onErrorRef.current?.(msg);
      if (msg === 'no-speech' || msg === 'aborted' || msg === 'not-allowed') {
        setListening(false);
      }
    };
    rec.onend = () => setListening(false);
    rec.onstart = () => { setListening(true); setError(null); };

    return rec;
  }, [supported, lang, continuous, interimResults]);

  const start = useCallback(() => {
    if (!supported) {
      setError('not-supported');
      onErrorRef.current?.('not-supported');
      return;
    }
    try {
      // Dispose any previous instance
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      const rec = buildRecognition();
      if (!rec) return;
      recognitionRef.current = rec;
      setFinal('');
      setInterim('');
      setError(null);
      rec.start();
    } catch (e: any) {
      setError(e?.message ?? 'start-failed');
      onErrorRef.current?.(e?.message ?? 'start-failed');
    }
  }, [supported, buildRecognition]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try { rec.stop(); } catch {}
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.abort(); } catch {}
    };
  }, []);

  return { supported, listening, interim, final, error, start, stop, toggle };
}

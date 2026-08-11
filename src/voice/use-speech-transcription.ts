"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API is not in lib.dom for every TypeScript version, and Safari
// only ships the prefixed constructor. These structural shapes cover exactly the
// surface used here rather than depending on ambient DOM declarations.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function supportsSpeechTranscription(): boolean {
  return !!getSpeechRecognitionCtor();
}

export interface UseSpeechTranscription {
  listening: boolean;
  /** Finalized transcript accumulated across the whole session (space-joined). */
  transcript: string;
  /** Not-yet-finalized text for the current utterance — show it, don't submit it. */
  interimTranscript: string;
  supported: boolean;
  error?: string;
  start: () => void;
  stop: () => void;
  /** Clears accumulated transcript — call after a successful submit. */
  reset: () => void;
}

/** Live, in-browser dictation. Zero backend: no key, no upload, no server. */
export function useSpeechTranscription(lang: string): UseSpeechTranscription {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string>();

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) { setError("unsupported"); return; }
    setError(undefined);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalChunk = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (finalChunk) setTranscript((prev) => (prev ? `${prev} ${finalChunk}`.trim() : finalChunk.trim()));
      setInterimTranscript(interim);
    };
    recognition.onerror = (event) => { setError(event.error); setListening(false); };
    recognition.onend = () => { setListening(false); setInterimTranscript(""); };
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }, [lang]);

  const stop = useCallback(() => { recognitionRef.current?.stop(); }, []);
  const reset = useCallback(() => { setTranscript(""); setInterimTranscript(""); }, []);

  useEffect(() => () => { recognitionRef.current?.stop(); }, []);

  return { listening, transcript, interimTranscript, supported: supportsSpeechTranscription(), error, start, stop, reset };
}

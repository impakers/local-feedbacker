import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { supportsSpeechTranscription, useSpeechTranscription, type UseSpeechTranscription } from "./use-speech-transcription";

interface ResultLike { isFinal: boolean; length: number; [index: number]: { transcript: string } }
type Handler<T> = ((event: T) => void) | null;

/** Stands in for the browser's SpeechRecognition; the real one needs a mic and a network round trip. */
class MockRecognition {
  static instances: MockRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: Handler<{ resultIndex: number; results: ArrayLike<ResultLike> }> = null;
  onerror: Handler<{ error: string }> = null;
  onend: (() => void) | null = null;
  started = false;

  constructor() { MockRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.onend?.(); }
}

function result(transcript: string, isFinal: boolean): ResultLike {
  return { isFinal, length: 1, 0: { transcript } };
}

const speechWindow = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

// React 19 refuses to run act() outside a declared test environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook(lang: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const latest: { current: UseSpeechTranscription } = { current: undefined as unknown as UseSpeechTranscription };
  const Probe = () => { latest.current = useSpeechTranscription(lang); return null; };
  await act(async () => { root.render(createElement(Probe)); });
  return { latest, unmount: () => act(async () => { root.unmount(); }) };
}

afterEach(() => {
  MockRecognition.instances = [];
  delete speechWindow.SpeechRecognition;
  delete speechWindow.webkitSpeechRecognition;
});

describe("speech transcription support", () => {
  it("is unsupported until the browser exposes a recognition constructor", () => {
    expect(supportsSpeechTranscription()).toBe(false);
    speechWindow.SpeechRecognition = MockRecognition;
    expect(supportsSpeechTranscription()).toBe(true);
  });

  it("accepts Safari's prefixed constructor", () => {
    speechWindow.webkitSpeechRecognition = MockRecognition;
    expect(supportsSpeechTranscription()).toBe(true);
  });
});

describe("useSpeechTranscription", () => {
  it("starts continuous interim recognition in the requested language", async () => {
    speechWindow.SpeechRecognition = MockRecognition;
    const { latest, unmount } = await renderHook("ko-KR");

    await act(async () => { latest.current.start(); });

    const recognition = MockRecognition.instances[0];
    expect(MockRecognition.instances).toHaveLength(1);
    expect(recognition.lang).toBe("ko-KR");
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.started).toBe(true);
    expect(latest.current.listening).toBe(true);
    await unmount();
  });

  it("accumulates finalized text and keeps interim text separate", async () => {
    speechWindow.SpeechRecognition = MockRecognition;
    const { latest, unmount } = await renderHook("en-US");
    await act(async () => { latest.current.start(); });
    const recognition = MockRecognition.instances[0];

    await act(async () => {
      recognition.onresult?.({ resultIndex: 0, results: [result("make the button ", true), result("bigg", false)] });
    });
    expect(latest.current.transcript).toBe("make the button");
    expect(latest.current.interimTranscript).toBe("bigg");

    await act(async () => {
      recognition.onresult?.({ resultIndex: 1, results: [result("make the button ", true), result("bigger", true)] });
    });
    expect(latest.current.transcript).toBe("make the button bigger");
    expect(latest.current.interimTranscript).toBe("");

    // Stopping ends the session; reset is what clears what was already captured.
    await act(async () => { latest.current.stop(); });
    expect(latest.current.listening).toBe(false);
    expect(latest.current.transcript).toBe("make the button bigger");

    await act(async () => { latest.current.reset(); });
    expect(latest.current.transcript).toBe("");
    await unmount();
  });

  it("surfaces recognition errors and stops listening", async () => {
    speechWindow.SpeechRecognition = MockRecognition;
    const { latest, unmount } = await renderHook("en-US");
    await act(async () => { latest.current.start(); });

    await act(async () => { MockRecognition.instances[0].onerror?.({ error: "not-allowed" }); });
    expect(latest.current.error).toBe("not-allowed");
    expect(latest.current.listening).toBe(false);
    await unmount();
  });
});

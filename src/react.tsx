"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DebugWidget, createLocalFeedbackStore, isVisibilityToggleShortcut, setStorageNamespace, type SubmitFeedbackPayload } from "./widget/orbit";
import { LANGUAGE_OPTIONS, getMessages, resolveLanguage } from "./i18n";
import { buildFeedbackPrompt, withAgentInstructions } from "./prompt/build-prompt";
import { promptInputFromSubmission } from "./prompt/from-submission";
import type { FeedbackLanguage, LocalFeedbackConfig } from "./types";
import { useSpeechTranscription } from "./voice/use-speech-transcription";

/** Local mode makes no requests; the widget's endpoint is never read. */
const LOCAL_ENDPOINT = "";

/** SpeechRecognition wants a BCP-47 tag, not the widget's own language code. */
const SPEECH_LANG: Record<FeedbackLanguage, string> = { en: "en-US", es: "es-ES", "zh-CN": "zh-CN", ko: "ko-KR" };

// This package ships browser-only types on purpose; NODE_ENV is whatever the
// consumer's bundler inlines, and is simply absent when nothing inlines it.
declare const process: { env?: { NODE_ENV?: string } } | undefined;

/** An explicit in-widget language pick outranks config/navigator and survives reloads. */
const LANGUAGE_KEY = "impakers-feedback-language";

// naked 도메인은 www 로 307 되돌린다 — 링크에 한 번 더 도는 주소를 싣지 않는다.
const HOME_URL = "https://www.impakers.club";
const REPO_URL = "https://github.com/impakers/local-feedbacker";

/**
 * Path prefix for the project page per language.
 *
 * The site serves Korean at the root and prefixes the other two. It has no
 * Chinese locale, so Chinese readers get the English page rather than a 404.
 */
const HOME_PREFIX: Record<FeedbackLanguage, string> = { ko: "", en: "/en", es: "/es", "zh-CN": "/en" };

function isSupported(value: string | null): value is FeedbackLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.value === value);
}

function storedLanguage(): FeedbackLanguage | null {
  if (typeof localStorage === "undefined") return null;
  // Private-mode Safari throws on access rather than returning null.
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    return isSupported(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function ImpakersFeedbackProvider(config: LocalFeedbackConfig) {
  // Storage is per-origin, so apps sharing one origin would otherwise pool their
  // feedback together. This has to run before anything reads storage — the store
  // below and DebugWidget's own state initialiser both do, during this render.
  // Idempotent, so a re-render (or StrictMode's double invoke) changes nothing.
  setStorageNamespace(config.namespace);

  // Only the explicit pick is state. With nothing picked the language is still
  // derived per render from config/navigator exactly as before.
  const [picked, setPicked] = useState<FeedbackLanguage | null>(storedLanguage);
  const language = picked ?? resolveLanguage(config.language ?? config.getLanguage?.() ?? (typeof navigator === "undefined" ? "en" : navigator.language));
  const m = getMessages(language);
  // DebugWidget reads window/localStorage while initialising, so it must not render on the server.
  const [mounted, setMounted] = useState(false);
  // Visible by default while developing; a shipped production bundle stays hidden
  // until the shortcut asks for it, unless the consumer says otherwise.
  const [visible, setVisible] = useState(() => config.defaultVisible ?? (typeof process !== "undefined" && process.env?.NODE_ENV !== "production"));
  const speech = useSpeechTranscription(SPEECH_LANG[language]);

  useEffect(() => { setMounted(true); }, []);

  // Ctrl/Cmd+Shift+. — show/hide. Bound unconditionally so the shortcut can bring
  // the widget back while it is hidden, and ignored while text is being edited.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (!isVisibilityToggleShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setVisible((v) => !v);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // The store is created once so DebugWidget's effects never re-run; submission
  // reads the newest language/transcript/config through this ref.
  const latest = useRef({ language, config, speech });
  useEffect(() => { latest.current = { language, config, speech }; });

  // Referentially stable (reads the newest language/transcript through `latest`), so
  // both the immediate copy below and the store's own recap persistence build the
  // prompt exactly the same way instead of duplicating the mapping.
  const buildPrompt = useCallback((payload: SubmitFeedbackPayload) => {
    const current = latest.current;
    return buildFeedbackPrompt(promptInputFromSubmission(payload, { language: current.language, transcript: current.speech.transcript }));
  }, []);

  // What gets stored is one feedback on its own; the standing agent instructions are
  // put back on whatever is handed over — a single recap, an export, or every
  // feedback at once — so a "copy all" carries them once at the top, not per item.
  const decorateDocument = useCallback((text: string) => withAgentInstructions(text, latest.current.language), []);

  const store = useMemo(() => createLocalFeedbackStore({
    buildPrompt,
    decorateDocument,
    onSubmit: (payload) => {
      const current = latest.current;
      const prompt = decorateDocument(buildPrompt(payload));
      current.speech.reset();
      void (async () => {
        try { await navigator.clipboard.writeText(prompt); } catch { /* clipboard denied — onCopy/bridge still run */ }
        current.config.onCopy?.(prompt);
        if (!current.config.onSendToBridge) return;
        try { await current.config.onSendToBridge({ prompt, feedback: payload.title, url: window.location.href }); } catch { /* user-owned bridge failures stay local */ }
      })();
    },
  }), []);

  // Number of submissions kept for "copy all". Reads through the store so a
  // submission from anywhere on the page updates the FAB badge.
  const pendingCount = useSyncExternalStore(store.subscribe, store.getPendingCount, () => 0);

  const setLanguage = useCallback((value: string) => {
    if (!isSupported(value)) return;
    setPicked(value);
    try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* storage denied — the pick still holds for this session */ }
  }, []);

  // Memoised so DebugWidget sees a new object only when the badge or language changes.
  const localExtras = useMemo(() => ({
    getEntryText: store.getEntryText,
    getEntryScreenshot: store.getEntryScreenshot,
    pendingCount,
    onCopyAll: async () => {
      const text = await store.copyAll();
      latest.current.config.onCopy?.(text);
    },
    // Local mode authenticates nobody; a stale hosted token on this origin must not
    // resurrect the account block in the shared settings panel.
    hideAccount: true,
    languageSettings: { value: language, options: LANGUAGE_OPTIONS, onChange: setLanguage, label: m.language },
    onClearAll: store.clearAll,
    clearAllLabel: m.clearAll,
    // Nothing here has an author, so "show only mine" can never mean anything.
    hideShowOnlyMine: true,
    panelLabels: {
      title: m.settings,
      markersVisible: m.markersVisible,
      hideDoneMarkers: m.hideDoneMarkers,
      markerColor: m.markerColor,
      shortcutsHeading: m.shortcutsHeading,
      logout: m.logout,
    },
    credit: {
      madeBy: m.creditMadeBy,
      learnMore: m.creditLearnMore,
      homeUrl: `${HOME_URL}${HOME_PREFIX[language]}/local-feedbacker`,
      contribute: m.creditContribute,
      repoUrl: REPO_URL,
    },
    shortcutsTitle: m.shortcutsOpen,
    shortcutLabels: {
      "feedback-mode": m.shortcutFeedbackMode,
      "toggle-widget": m.shortcutVisibility,
      "feedback-list": m.feedbackList,
      settings: m.settings,
      shortcuts: m.shortcutsOpen,
      "copy-all": m.copyAllMenu,
      "export-all": m.exportAll,
      "clear-all": m.clearAll,
      "toggle-markers": m.markersVisible,
      "toggle-hide-done": m.hideDoneMarkers,
      "marker-color": m.markerColor,
      close: m.shortcutCloseInput,
    },
    shortcutGroupLabels: { panels: m.groupPanels, feedback: m.groupFeedback, markers: m.groupMarkers, widget: m.groupWidget },
    confirmClearAllLabel: m.confirmClearAll,
    commentLabel: m.feedback,
    settingsLabel: m.settings,
    fabAriaLabel: m.feedback,
    copyAllLabel: m.copyAllMenu,
    cancelLabel: m.cancel,
    hideWidgetLabel: m.hideWidget,
    modalBadgeLabel: m.createdInModal,
    hintTitle: m.hintTitle,
    hintBody: m.hintBody,
    submitSuccessLabel: m.submitSuccess,
    submitErrorLabel: m.submitError,
    recapTitleLabel: m.recapTitle,
    recapCloseAriaLabel: m.close,
    recapCopiedLabel: m.copied,
    recapCopyLabel: m.copy,
    listEntries: store.listEntries,
    onRemoveEntry: store.removeEntry,
    feedbackListLabel: m.feedbackList,
    feedbackListTitle: m.feedbackList,
    feedbackListEmptyLabel: m.feedbackListEmpty,
    feedbackListCopyLabel: m.copy,
    feedbackListCopiedLabel: m.copied,
    feedbackListRemoveAriaLabel: m.remove,
    recapDeleteAriaLabel: m.remove,
    recapMissingLabel: m.recapMissing,
    // Never throws; the panel reads the resolved result to say what happened.
    onExportAll: store.exportAll,
    exportSupported: store.supportsExport(),
    exportLabel: m.exportAll,
    exportUnsupportedLabel: m.exportUnsupported,
    exportingLabel: m.exporting,
    exportDoneLabel: m.exportDone,
    exportRejectedLabel: m.exportRejected,
  }), [store, pendingCount, language, setLanguage, m]);

  if (!mounted || !visible) return null;

  return <DebugWidget
    endpoint={LOCAL_ENDPOINT}
    store={store}
    onHide={() => setVisible(false)}
    popoverPlaceholder={m.describe}
    popoverSubmitLabel={m.copy}
    localExtras={localExtras}
    popoverFooter={<>
      {speech.supported
        ? <button type="button" onClick={speech.listening ? speech.stop : speech.start}>{speech.listening ? `■ ${m.stopDictate}` : `🎙 ${m.dictate}`}</button>
        : <span style={{ opacity: 0.6 }}>{m.dictateUnsupported}</span>}
      {/* Interim text is dimmed because it is still being revised and is not what gets submitted. */}
      {speech.listening && speech.interimTranscript && <span style={{ opacity: 0.6 }}>{speech.interimTranscript}</span>}
      {!speech.listening && speech.transcript && <span>{speech.transcript}</span>}
      {speech.error && <span role="alert">{m.micError}</span>}
    </>}
  />;
}

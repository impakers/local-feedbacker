"use client";

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { MARKER_COLORS, type DebugSettings } from "../../core/settings";
import { SHORTCUT_HINTS, type ShortcutHint } from "../../core/shortcuts";
import { getStoredUser, getAuthState } from "../../core/auth";
import { getServiceName } from "../../core/auth";
import { useModalOverlayIsolation } from "../../utils/modal-isolation";
import type { DebugWidgetTheme } from "../../core/types";
import styles from "./styles.module.scss";

/** 로컬 모드 전용 언어 선택 필드. 미지정 시 필드 자체가 렌더되지 않는다. */
export interface SettingsPanelLanguageSettings {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** 필드 라벨. 미지정 시 `"언어"`. */
  label?: string;
}

/** 로컬 모드 전용 패널 문구 오버라이드. 미지정 필드는 기존 한국어 그대로. */
export interface SettingsPanelLabels {
  title?: string;
  markersVisible?: string;
  hideDoneMarkers?: string;
  markerColor?: string;
  shortcutsHeading?: string;
  logout?: string;
}

/**
 * 패널 맨 아래 제작자 표기. 로컬(OSS) 모드에서만 넘어온다 — 호스티드 위젯은
 * 고객사 화면 안에서 도니 만든 곳을 광고할 자리가 아니다.
 */
export interface SettingsPanelCredit {
  /** "임패커스가 만들었습니다" 한 줄. */
  madeBy: string;
  /** 소개 페이지 링크 문구. */
  learnMore: string;
  /** 소개 페이지 주소(언어에 맞춰 호출부가 고른다). */
  homeUrl: string;
  /**
   * "오픈 소스입니다 — 이슈·PR 환영합니다" 한 줄. 둘 다 있을 때만 렌더한다 —
   * 저장소가 비공개인 동안 링크를 걸면 모든 사용자에게 404 가 된다.
   */
  contribute?: string;
  repoUrl?: string;
}

export interface SettingsPanelProps {
  settings: DebugSettings;
  onChange: (settings: DebugSettings) => void;
  onClose: () => void;
  onLogout?: () => void;
  /** 패널 서피스 재질. 미지정 시 `"solid"` — 기존 불투명 흰 카드 그대로. */
  theme?: DebugWidgetTheme;
  /**
   * 로컬 모드 전용. `true` 면 계정 정보/로그아웃을 **인증 상태와 무관하게** 감춘다.
   * 인증 상태는 localStorage 전역이라, 같은 오리진에서 호스티드 위젯을 써 본 적이
   * 있으면 로컬 모드에서도 남은 토큰이 읽힌다. 그래서 조건을 얹는 게 아니라 끊는다.
   */
  hideAccount?: boolean;
  /** 로컬 모드 전용 언어 선택. 미지정(호스티드)이면 필드가 없다. */
  languageSettings?: SettingsPanelLanguageSettings;
  /**
   * 로컬 모드 전용. 남긴 피드백 전체 삭제. 미지정(호스티드)이면 버튼이 없다.
   *
   * 확인은 네이티브 대화상자가 아니라 **두 번 누르기**다. 첫 클릭(또는 ⌫)이 `armed`
   * 를 켜고 버튼 문구가 `confirmLabel` 로 바뀐다; 그 상태에서 한 번 더 누르면 지운다.
   * 상태를 부모가 들고 있는 이유: 키보드(⌫·Enter)와 이 버튼이 같은 확인을 공유해야
   * "버튼으로 켜고 Enter 로 확정"이 성립한다.
   */
  clearAllSettings?: {
    count: number;
    label: string;
    confirmLabel?: string;
    armed?: boolean;
    onClear: () => void;
  };
  /**
   * 로컬 모드 전용. 주면 접힌 "단축키 안내" 대신 **모든 단축키 시트를 여는 한 줄**이
   * 들어간다. 시트는 읽는 것이 아니라 실행하는 것이라 목록을 여기 중복해 두지 않는다.
   */
  onOpenShortcuts?: () => void;
  /** 각 행 라벨 옆에 붙일 키 표기. 미지정 필드는 표기 없음. */
  shortcutKeys?: {
    markersVisible?: string;
    hideDoneMarkers?: string;
    markerColor?: string;
    clearAll?: string;
    shortcuts?: string;
  };
  /** 로컬 모드 전용 문구 오버라이드. 미지정(호스티드)이면 기존 한국어 그대로. */
  panelLabels?: SettingsPanelLabels;
  /** 로컬 모드 전용 제작자 표기. 미지정이면 아예 렌더하지 않는다. */
  credit?: SettingsPanelCredit;
  /** 단축키 안내 목록 오버라이드. 미지정 시 기본(한국어) 목록. */
  shortcutHints?: ShortcutHint[];
  /**
   * 로컬 모드 전용. "내가 추가한 것만 표시"를 아예 렌더하지 않는다 —
   * 로컬 모드는 인증도 작성자도 없어서 이 토글이 의미가 없다.
   */
  hideShowOnlyMine?: boolean;
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  onLogout,
  theme = "solid",
  hideAccount = false,
  languageSettings,
  clearAllSettings,
  panelLabels,
  credit,
  shortcutHints = SHORTCUT_HINTS,
  hideShowOnlyMine = false,
  onOpenShortcuts,
  shortcutKeys,
}: SettingsPanelProps) {
  const user = getStoredUser();
  const serviceName = getServiceName();
  const isUserAuth = getAuthState() !== "unauthenticated" && !!user;
  const handleToggleMarkers = useCallback(() => {
    onChange({ ...settings, markersVisible: !settings.markersVisible });
  }, [settings, onChange]);

  const handleToggleHideDone = useCallback(() => {
    onChange({ ...settings, hideDoneMarkers: !settings.hideDoneMarkers });
  }, [settings, onChange]);

  const handleToggleShowOnlyMine = useCallback(() => {
    onChange({ ...settings, showOnlyMine: !settings.showOnlyMine });
  }, [settings, onChange]);

  // 단축키 안내 — 기본 접힘
  const [showShortcuts, setShowShortcuts] = useState(false);

  const handleColorChange = useCallback((color: string) => {
    onChange({ ...settings, markerColor: color });
  }, [settings, onChange]);

  // 호스트 앱의 Radix(shadcn) 모달이 body에 pointer-events:none을 걸어도
  // 이 패널(별도 body 포털)이 조작 가능하도록 격리한다.
  const isolationRef = useModalOverlayIsolation<HTMLDivElement>();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={isolationRef} data-impakers-debug="">
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={`${styles.panel} ${theme === "light-glass" ? styles.glass : ""}`}
        data-impakers-debug=""
      >
        <div className={styles.header}>
          <span className={styles.title}>{panelLabels?.title || "설정"}</span>
          <button className={styles.closeBtn} onClick={onClose} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {/* 로그인 유저 정보 */}
          {!hideAccount && isUserAuth && (
            <div className={styles.userInfo}>
              <div className={styles.userName}>{user!.userName}</div>
              <div className={styles.userEmail}>{user!.userEmail}</div>
              {serviceName && (
                <div className={styles.userService}>{serviceName}</div>
              )}
            </div>
          )}

          {/* 언어 선택 (로컬 모드 전용) */}
          {languageSettings && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>{languageSettings.label ?? "언어"}</div>
              <select
                className={styles.select}
                value={languageSettings.value}
                onChange={(e) => languageSettings.onChange(e.target.value)}
              >
                {languageSettings.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 남긴 피드백 전체 삭제 (로컬 모드 전용) — 라벨/버튼 짝이 아니라 독립 버튼.
              필드 행으로 두면 같은 문구가 왼쪽 라벨과 버튼 안에 두 번 보인다. */}
          {clearAllSettings && (
            <button
              className={`${styles.clearAllBtn} ${clearAllSettings.armed ? styles.armed : ""}`}
              type="button"
              disabled={clearAllSettings.count === 0}
              aria-live="polite"
              onClick={clearAllSettings.onClear}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              <span className={styles.clearAllText}>
                {clearAllSettings.armed && clearAllSettings.confirmLabel
                  ? clearAllSettings.confirmLabel
                  : `${clearAllSettings.label} (${clearAllSettings.count})`}
              </span>
              {!clearAllSettings.armed && shortcutKeys?.clearAll && (
                <kbd className={styles.hintKey}>{shortcutKeys.clearAll}</kbd>
              )}
            </button>
          )}

          {/* 마커 표시 토글 */}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              {panelLabels?.markersVisible || "마커 표시"}
              {shortcutKeys?.markersVisible && <kbd className={styles.hintKey}>{shortcutKeys.markersVisible}</kbd>}
            </div>
            <button
              className={`${styles.toggle} ${settings.markersVisible ? styles.on : ""}`}
              onClick={handleToggleMarkers}
              type="button"
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>

          {/* 완료 핀 숨기기 */}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              {panelLabels?.hideDoneMarkers || "완료 핀 숨기기"}
              {shortcutKeys?.hideDoneMarkers && <kbd className={styles.hintKey}>{shortcutKeys.hideDoneMarkers}</kbd>}
            </div>
            <button
              className={`${styles.toggle} ${settings.hideDoneMarkers ? styles.on : ""}`}
              onClick={handleToggleHideDone}
              type="button"
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>

          {/* 내가 추가한 것만 표시 (로컬 모드에는 작성자 개념이 없어 아예 감춘다) */}
          {!hideShowOnlyMine && (
            <div className={styles.field}>
              <div className={styles.fieldLabel}>내가 추가한 것만 표시</div>
              <button
                className={`${styles.toggle} ${settings.showOnlyMine ? styles.on : ""}`}
                onClick={handleToggleShowOnlyMine}
                type="button"
              >
                <span className={styles.toggleThumb} />
              </button>
            </div>
          )}

          {/* 마커 색상 (할 일=연한 톤, 진행중=선택한 진한 색) */}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              {panelLabels?.markerColor || "마커 색상"}
              {shortcutKeys?.markerColor && <kbd className={styles.hintKey}>{shortcutKeys.markerColor}</kbd>}
            </div>
            <div className={styles.colors}>
              {MARKER_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`${styles.colorBtn} ${settings.markerColor === c.value ? styles.selected : ""}`}
                  style={{ background: c.value }}
                  onClick={() => handleColorChange(c.value)}
                  title={c.label}
                  type="button"
                />
              ))}
            </div>
          </div>

          {/* 단축키: 로컬 모드는 실행되는 시트로 보내고, 호스티드는 접힌 목록 그대로 */}
          {onOpenShortcuts ? (
            <div className={styles.shortcuts}>
              <button className={styles.shortcutsToggle} onClick={onOpenShortcuts} type="button">
                <span>{panelLabels?.shortcutsHeading || "단축키 안내"}</span>
                <span className={styles.shortcutsOpenKeys}>
                  {shortcutKeys?.shortcuts && <kbd className={styles.hintKey}>{shortcutKeys.shortcuts}</kbd>}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </button>
            </div>
          ) : (
          <div className={styles.shortcuts}>
            <button
              className={styles.shortcutsToggle}
              onClick={() => setShowShortcuts((prev) => !prev)}
              aria-expanded={showShortcuts}
              type="button"
            >
              <span>{panelLabels?.shortcutsHeading || "단축키 안내"}</span>
              <svg
                className={`${styles.chevron} ${showShortcuts ? styles.chevronOpen : ""}`}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showShortcuts && (
              <ul className={styles.shortcutList}>
                {shortcutHints.map((hint) => (
                  <li key={hint.label} className={styles.shortcutRow}>
                    <span className={styles.shortcutLabel}>{hint.label}</span>
                    <span className={styles.shortcutKeys}>
                      {hint.keys.map((key, i) => (
                        <span key={key.label} className={styles.keyGroup}>
                          {i > 0 && <span className={styles.keySep}>+</span>}
                          <kbd className={styles.key}>
                            {key.label}
                            {key.icon && <span className={styles.keyIcon}>{key.icon}</span>}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}

          {/* 로그아웃 */}
          {!hideAccount && isUserAuth && onLogout && (
            <button className={styles.logoutBtn} onClick={onLogout} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {panelLabels?.logout || "로그아웃"}
            </button>
          )}

          {/* 제작자 표기 + 버전 (가장 하단) */}
          <div className={styles.version}>
            {credit && (
              <div className={styles.credit}>
                <p>
                  {credit.madeBy}{" "}
                  <a href={credit.homeUrl} target="_blank" rel="noopener noreferrer">
                    {credit.learnMore}
                  </a>
                </p>
                {credit.contribute && credit.repoUrl && (
                  <p>
                    {credit.contribute}{" "}
                    <a href={credit.repoUrl} target="_blank" rel="noopener noreferrer">
                      GitHub
                    </a>
                  </p>
                )}
              </div>
            )}
            v{process.env.PKG_VERSION}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
  /** 로컬 모드 전용. 남긴 피드백 전체 삭제. 미지정(호스티드)이면 버튼이 없다. */
  clearAllSettings?: {
    count: number;
    label: string;
    onClear: () => void;
  };
  /** 로컬 모드 전용 문구 오버라이드. 미지정(호스티드)이면 기존 한국어 그대로. */
  panelLabels?: SettingsPanelLabels;
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
  shortcutHints = SHORTCUT_HINTS,
  hideShowOnlyMine = false,
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
              className={styles.clearAllBtn}
              type="button"
              disabled={clearAllSettings.count === 0}
              onClick={() => {
                if (window.confirm(clearAllSettings.label)) clearAllSettings.onClear();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              {`${clearAllSettings.label} (${clearAllSettings.count})`}
            </button>
          )}

          {/* 마커 표시 토글 */}
          <div className={styles.field}>
            <div className={styles.fieldLabel}>{panelLabels?.markersVisible || "마커 표시"}</div>
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
            <div className={styles.fieldLabel}>{panelLabels?.hideDoneMarkers || "완료 핀 숨기기"}</div>
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
            <div className={styles.fieldLabel}>{panelLabels?.markerColor || "마커 색상"}</div>
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

          {/* 단축키 안내 (접힘) */}
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

          {/* 버전 (가장 하단) */}
          <div className={styles.version}>v{process.env.PKG_VERSION}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

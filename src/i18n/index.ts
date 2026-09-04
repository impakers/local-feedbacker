import type { FeedbackLanguage } from "../types";

export interface FeedbackMessages {
  feedback: string;
  clickedUi: string;
  confirmedSource: string;
  callsite: string;
  definition: string;
  supportingContext: string;
  requestedBehavior: string;
  element: string;
  selectedText: string;
  nearbyCopy: string;
  route: string;
  endpoint: string;
  routeFile: string;
  inspectInstruction: string;
  ambiguousInstruction: string;
  select: string;
  review: string;
  copy: string;
  copied: string;
  send: string;
  describe: string;
  language: string;
  settings: string;
  clearAll: string;
  copyAllMenu: string;
  markersVisible: string;
  hideDoneMarkers: string;
  captureEnabled: string;
  markerColor: string;
  shortcutsHeading: string;
  logout: string;
  shortcutFeedbackMode: string;
  shortcutVisibility: string;
  shortcutCloseInput: string;
  cancel: string;
  hideWidget: string;
  createdInModal: string;
  hintTitle: string;
  hintBody: string;
  submitSuccess: string;
  submitError: string;
  recapTitle: string;
  close: string;
  feedbackList: string;
  feedbackListEmpty: string;
  /** 목록에서 한 건 삭제하는 버튼의 aria-label. `close`("닫기")로는 동작이 뒤바뀐다. */
  remove: string;
  dictate: string;
  stopDictate: string;
  /** Replaces the button outright where the browser has no SpeechRecognition. */
  dictateUnsupported: string;
  micError: string;
  /** Heading the dictated text is filed under inside the built prompt. */
  voiceTranscriptLabel: string;
  /** Prompt section describing the modal the feedback was left inside. */
  modalContext: string;
  modalTitle: string;
  modalTrigger: string;
  modalLabel: string;
  /** Shown in place of the prompt when a marker outlived its stored text. */
  recapMissing: string;
  /** Settings-panel footnote: who made this, and where to file issues. */
  creditMadeBy: string;
  creditLearnMore: string;
  creditContribute: string;
  /** FAB/list action that downloads every entry as a single zip. */
  exportAll: string;
  /** Replaces the export button outright where downloads are unavailable. */
  exportUnsupported: string;
  /** Shown beside the export button while the zip is being assembled. */
  exporting: string;
  exportDone: string;
  /** The zip could not be built (e.g. a screenshot failed to decode). */
  exportRejected: string;
  /** Action that opens the sheet listing every command with its key. */
  shortcutsOpen: string;
  /** Inline confirm that replaces the native dialog for the destructive action. */
  confirmClearAll: string;
  /** Group headings in the shortcut sheet. */
  groupPanels: string;
  groupFeedback: string;
  groupMarkers: string;
  groupWidget: string;
}

/**
 * Each language is listed in its own script — a picker labelled in the language
 * currently selected is unreadable to the person trying to leave it.
 */
export const LANGUAGE_OPTIONS: { value: FeedbackLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ko", label: "한국어" },
];

const messages: Record<FeedbackLanguage, FeedbackMessages> = {
  en: {
    feedback: "Feedback", clickedUi: "Clicked UI", confirmedSource: "Confirmed implementation source — start here",
    callsite: "Call site", definition: "Definition", supportingContext: "Supporting context", requestedBehavior: "Requested agent behavior",
    element: "Element", selectedText: "Selected text", nearbyCopy: "Nearby copy", route: "Route", endpoint: "Endpoint", routeFile: "Route file",
    inspectInstruction: "Inspect the confirmed call site first. Preserve unrelated behavior.",
    ambiguousInstruction: "Ask a question if the requested visual or interaction change is ambiguous.",
    select: "Select UI", review: "Review prompt", copy: "Copy prompt", copied: "Copied", send: "Send to local bridge", describe: "Describe the change you want",
    language: "Language", settings: "Settings", clearAll: "Clear all feedback", copyAllMenu: "Copy all",
    markersVisible: "Show markers", hideDoneMarkers: "Hide completed pins", captureEnabled: "Capture screenshots", markerColor: "Marker color",
    shortcutsHeading: "Shortcuts", logout: "Log out",
    shortcutFeedbackMode: "Toggle feedback mode", shortcutVisibility: "Show/hide widget",
    shortcutCloseInput: "Close input → exit feedback mode",
    cancel: "Cancel", hideWidget: "Hide widget", createdInModal: "Created inside a modal",
    hintTitle: "Feedback mode",
    hintBody: "For screens that disappear on click, keep the cursor down — press and hold to capture",
    submitSuccess: "Feedback submitted", submitError: "Couldn't submit feedback",
    recapTitle: "Feedback you left", close: "Close",
    feedbackList: "Feedback list", feedbackListEmpty: "No feedback saved yet", remove: "Delete",
    dictate: "Dictate", stopDictate: "Stop", dictateUnsupported: "Dictation isn't supported in this browser",
    micError: "Microphone unavailable", voiceTranscriptLabel: "Voice note transcript:",
    modalContext: "Modal context", modalTitle: "Title", modalTrigger: "Trigger", modalLabel: "Label",
    recapMissing: "The original text is gone — you can still delete this pin",
    creditMadeBy: "Built by Impakers.", creditLearnMore: "Learn more",
    creditContribute: "Open source — issues and PRs are welcome:",
    exportAll: "Export all", exportUnsupported: "Export isn't supported in this browser",
    exporting: "Exporting…", exportDone: "Export complete",
    exportRejected: "Export failed — please try again",
    shortcutsOpen: "All shortcuts",
    confirmClearAll: "Delete all feedback? Enter to confirm, Esc to cancel",
    groupPanels: "Panels", groupFeedback: "Feedback", groupMarkers: "Markers", groupWidget: "Widget",
  },
  es: {
    feedback: "Comentarios", clickedUi: "Interfaz seleccionada", confirmedSource: "Fuente de implementación confirmada — empieza aquí",
    callsite: "Lugar de llamada", definition: "Definición", supportingContext: "Contexto complementario", requestedBehavior: "Comportamiento solicitado al agente",
    element: "Elemento", selectedText: "Texto seleccionado", nearbyCopy: "Texto cercano", route: "Ruta", endpoint: "Endpoint", routeFile: "Archivo de ruta",
    inspectInstruction: "Inspecciona primero el lugar de llamada confirmado. Conserva el comportamiento no relacionado.",
    ambiguousInstruction: "Haz una pregunta si el cambio visual o de interacción solicitado es ambiguo.",
    select: "Seleccionar UI", review: "Revisar prompt", copy: "Copiar prompt", copied: "Copiado", send: "Enviar al puente local", describe: "Describe el cambio que quieres",
    language: "Idioma", settings: "Configuración", clearAll: "Borrar todos los comentarios", copyAllMenu: "Copiar todo",
    markersVisible: "Mostrar marcadores", hideDoneMarkers: "Ocultar pines completados", captureEnabled: "Capturar capturas de pantalla", markerColor: "Color del marcador",
    shortcutsHeading: "Atajos", logout: "Cerrar sesión",
    shortcutFeedbackMode: "Alternar modo de comentarios", shortcutVisibility: "Mostrar/ocultar widget",
    shortcutCloseInput: "Cerrar entrada → salir del modo de comentarios",
    cancel: "Cancelar", hideWidget: "Ocultar widget", createdInModal: "Creado dentro de un modal",
    hintTitle: "Modo de comentarios",
    hintBody: "Para pantallas que desaparecen al hacer clic, mantén presionado el cursor — pulsa y sostén para capturar",
    submitSuccess: "Comentario enviado", submitError: "No se pudo enviar el comentario",
    recapTitle: "Comentario que dejaste", close: "Cerrar",
    feedbackList: "Lista de comentarios", feedbackListEmpty: "Aún no hay comentarios guardados", remove: "Eliminar",
    dictate: "Dictar", stopDictate: "Detener", dictateUnsupported: "El dictado no es compatible con este navegador",
    micError: "Micrófono no disponible", voiceTranscriptLabel: "Transcripción de la nota de voz:",
    modalContext: "Contexto del modal", modalTitle: "Título", modalTrigger: "Disparador", modalLabel: "Etiqueta",
    recapMissing: "El texto original ya no está — aún puedes eliminar este marcador",
    creditMadeBy: "Creado por Impakers.", creditLearnMore: "Más información",
    creditContribute: "Código abierto — issues y PRs son bienvenidos:",
    exportAll: "Exportar todo", exportUnsupported: "Exportar no es compatible con este navegador",
    exporting: "Exportando…", exportDone: "Exportación completa",
    exportRejected: "La exportación falló — inténtalo de nuevo",
    shortcutsOpen: "Todos los atajos",
    confirmClearAll: "¿Borrar todos los comentarios? Enter para confirmar, Esc para cancelar",
    groupPanels: "Paneles", groupFeedback: "Comentarios", groupMarkers: "Marcadores", groupWidget: "Widget",
  },
  "zh-CN": {
    feedback: "反馈", clickedUi: "点击的界面", confirmedSource: "已确认的实现源 — 从这里开始",
    callsite: "调用位置", definition: "定义", supportingContext: "补充上下文", requestedBehavior: "对代理的请求行为",
    element: "元素", selectedText: "选中文本", nearbyCopy: "附近文案", route: "路由", endpoint: "端点", routeFile: "路由文件",
    inspectInstruction: "请先检查已确认的调用位置。保留无关行为。",
    ambiguousInstruction: "如果所需的视觉或交互变更不明确，请先提问。",
    select: "选择界面", review: "检查提示词", copy: "复制提示词", copied: "已复制", send: "发送到本地桥接", describe: "描述你想要的变更",
    language: "语言", settings: "设置", clearAll: "清除全部反馈", copyAllMenu: "复制全部",
    markersVisible: "显示标记", hideDoneMarkers: "隐藏已完成的图钉", captureEnabled: "截取屏幕截图", markerColor: "标记颜色",
    shortcutsHeading: "快捷键", logout: "退出登录",
    shortcutFeedbackMode: "切换反馈模式", shortcutVisibility: "显示/隐藏小部件",
    shortcutCloseInput: "关闭输入框 → 退出反馈模式",
    cancel: "取消", hideWidget: "隐藏小部件", createdInModal: "在弹窗内创建",
    hintTitle: "反馈模式",
    hintBody: "对于点击后消失的界面，请按住光标不放——长按以捕获",
    submitSuccess: "反馈已提交", submitError: "反馈提交失败",
    recapTitle: "你留下的反馈", close: "关闭",
    feedbackList: "反馈列表", feedbackListEmpty: "暂无已保存的反馈", remove: "删除",
    dictate: "口述", stopDictate: "停止", dictateUnsupported: "此浏览器不支持语音听写",
    micError: "麦克风不可用", voiceTranscriptLabel: "语音备注转录：",
    modalContext: "弹窗上下文", modalTitle: "标题", modalTrigger: "触发器", modalLabel: "标签",
    recapMissing: "原文已不存在 — 仍可删除此标记",
    creditMadeBy: "Impakers 开发。", creditLearnMore: "了解更多",
    creditContribute: "开源项目 — 欢迎提交 issue 和 PR：",
    exportAll: "导出全部", exportUnsupported: "此浏览器不支持导出",
    exporting: "导出中…", exportDone: "导出完成",
    exportRejected: "导出失败 — 请重试",
    shortcutsOpen: "全部快捷键",
    confirmClearAll: "删除全部反馈？按 Enter 确认，Esc 取消",
    groupPanels: "面板", groupFeedback: "反馈", groupMarkers: "标记", groupWidget: "小部件",
  },
  ko: {
    feedback: "피드백", clickedUi: "클릭한 UI", confirmedSource: "확정 구현 소스 — 여기서 시작",
    callsite: "호출부", definition: "정의", supportingContext: "보조 컨텍스트", requestedBehavior: "에이전트 요청 사항",
    element: "요소", selectedText: "선택한 텍스트", nearbyCopy: "주변 문구", route: "경로", endpoint: "엔드포인트", routeFile: "라우트 파일",
    inspectInstruction: "확정된 호출부를 먼저 확인하고 관련 없는 동작은 유지하세요.",
    ambiguousInstruction: "요청한 시각 또는 상호작용 변경이 모호하면 질문하세요.",
    select: "UI 선택", review: "프롬프트 검토", copy: "프롬프트 복사", copied: "복사됨", send: "로컬 브리지로 보내기", describe: "원하는 변경을 설명하세요",
    language: "언어", settings: "설정", clearAll: "전체 피드백 삭제", copyAllMenu: "전체 복사",
    markersVisible: "마커 표시", hideDoneMarkers: "완료 핀 숨기기", captureEnabled: "스크린샷 캡처", markerColor: "마커 색상",
    shortcutsHeading: "단축키 안내", logout: "로그아웃",
    shortcutFeedbackMode: "피드백 모드 켜기/끄기", shortcutVisibility: "위젯 표시/숨김",
    shortcutCloseInput: "입력창 닫기 → 피드백 모드 해제",
    cancel: "취소", hideWidget: "위젯 숨기기", createdInModal: "모달에서 작성됨",
    hintTitle: "피드백 클릭",
    hintBody: "클릭하면 사라지는 화면은 커서를 떼지 말고 꾹 눌러 캡처하세요",
    submitSuccess: "피드백 생성이 완료되었습니다", submitError: "피드백 전송 실패",
    recapTitle: "남긴 피드백", close: "닫기",
    feedbackList: "피드백 목록", feedbackListEmpty: "저장된 피드백이 없습니다", remove: "삭제",
    dictate: "받아쓰기", stopDictate: "중지", dictateUnsupported: "이 브라우저는 받아쓰기를 지원하지 않습니다",
    micError: "마이크를 사용할 수 없습니다", voiceTranscriptLabel: "음성 메모 텍스트:",
    modalContext: "모달 컨텍스트", modalTitle: "제목", modalTrigger: "트리거", modalLabel: "라벨",
    recapMissing: "원문을 찾을 수 없어요 — 이 핀만 지울 수 있어요",
    creditMadeBy: "임패커스가 만들었습니다.", creditLearnMore: "자세히 보기",
    creditContribute: "오픈 소스입니다 — 이슈·PR 환영합니다:",
    exportAll: "전체 내보내기", exportUnsupported: "이 브라우저는 내보내기를 지원하지 않습니다",
    exporting: "내보내는 중…", exportDone: "내보내기 완료",
    exportRejected: "내보내기에 실패했어요 — 다시 시도해 주세요",
    shortcutsOpen: "모든 단축키",
    confirmClearAll: "전체 피드백을 삭제할까요? Enter 확인 · Esc 취소",
    groupPanels: "패널", groupFeedback: "피드백", groupMarkers: "마커", groupWidget: "위젯",
  },
};

export function resolveLanguage(language?: string): FeedbackLanguage {
  const normalized = language?.toLowerCase() ?? "";
  if (normalized.startsWith("es")) return "es";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  if (normalized.startsWith("ko")) return "ko";
  return "en";
}

export function getMessages(language: FeedbackLanguage): FeedbackMessages {
  return messages[language];
}

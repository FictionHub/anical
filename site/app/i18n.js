// i18n — Japanese / Korean / Chinese + English UI.
//
// Translations live here as flat key → string maps. A `t(key)` function resolves
// the current language, falling back to English when a key is missing.
//
// Languages: en (default), ja (Japanese), ko (Korean), zh (Simplified Chinese).
// The HTML `lang` attribute and `og:locale` are updated on language change.

export const LOCALES = ["en", "ja", "ko", "zh"];
export const LOCALE_NAMES = { en: "English", ja: "日本語", ko: "한국어", zh: "中文（简体）" };

const T = {
  en: {
    // Navigation / views
    "nav.month": "Month",
    "nav.week": "Week",
    "nav.agenda": "Agenda",
    "nav.board": "Board",
    "nav.lists": "Lists",
    "nav.dashboard": "Stats",
    "nav.recs": "For you",
    "nav.gems": "Gems",
    "nav.browse": "Browse",
    "nav.taste": "Taste",
    "nav.events": "Events",
    "nav.franchise": "Franchise",

    // Status labels
    "status.watching": "Watching",
    "status.plan": "Plan to Watch",
    "status.completed": "Completed",
    "status.on_hold": "On Hold",
    "status.dropped": "Dropped",

    // Settings
    "settings.title": "Settings",
    "settings.appearance": "Appearance",
    "settings.theme": "Theme",
    "settings.accent": "Accent",
    "settings.density": "Density",
    "settings.corner_radius": "Corner radius",
    "settings.cover_art": "Cover art",
    "settings.region": "Region",
    "settings.language": "Language",
    "settings.week_starts": "Week starts",
    "settings.time_format": "Time format",
    "settings.day_sort": "Order within a day",
    "settings.show_donghua": "Donghua",
    "settings.account": "Account",
    "settings.notes": "Notes",
    "settings.taste_predictions": "Taste & predictions",
    "settings.looking_back": "Looking back",
    "settings.your_data": "Your data",

    // Common
    "common.watched": "Watched",
    "common.rating": "Rating",
    "common.score": "Score",
    "common.episodes": "Episodes",
    "common.status": "Status",
    "common.season": "Season",
    "common.studio": "Studio",
    "common.tags": "Tags",
    "common.description": "Description",
    "common.related": "Related",
    "common.staff": "Staff",
    "common.where_to_watch": "Where to watch",
    "common.back": "Back",
    "common.retry": "Try again",

    // Franchise
    "franchise.release_order": "Release order",
    "franchise.watch_order": "Watch order",
    "franchise.progress": "Franchise progress",
    "franchise.where_to_start": "Where to start",
    "franchise.entries": "entries",
    "franchise.watched": "watched",

    // Notifications
    "notify.alert": "Airs in ~{lead} min",
    "notify.time_moved": "Time moved",
    "notify.break": "Broadcast break — no episode this week",
  },

  ja: {
    "nav.month": "月",
    "nav.week": "週",
    "nav.agenda": "アジェンダ",
    "nav.board": "ボード",
    "nav.lists": "リスト",
    "nav.dashboard": "統計",
    "nav.recs": "おすすめ",
    "nav.gems": "隠れた名作",
    "nav.browse": "閲覧",
    "nav.taste": "好み",
    "nav.events": "イベント",
    "nav.franchise": "シリーズ",

    "status.watching": "視聴中",
    "status.plan": "視聴予定",
    "status.completed": "視聴済み",
    "status.on_hold": "中断",
    "status.dropped": "視聴中断",

    "settings.title": "設定",
    "settings.appearance": "外観",
    "settings.theme": "テーマ",
    "settings.accent": "アクセントカラー",
    "settings.density": "密度",
    "settings.corner_radius": "角丸み",
    "settings.cover_art": "カバーアート",
    "settings.region": "地域",
    "settings.language": "言語",
    "settings.week_starts": "週の開始",
    "settings.time_format": "時刻形式",
    "settings.day_sort": "1日の並び順",
    "settings.show_donghua": "中国アニメ",
    "settings.account": "アカウント",
    "settings.notes": "メモ",
    "settings.taste_predictions": "好みと予測",
    "settings.looking_back": "振り返り",
    "settings.your_data": "データ",

    "common.watched": "視聴済み",
    "common.rating": "評価",
    "common.score": "スコア",
    "common.episodes": "話数",
    "common.status": "ステータス",
    "common.season": "シーズン",
    "common.studio": "スタジオ",
    "common.tags": "タグ",
    "common.description": "説明",
    "common.related": "関連作品",
    "common.staff": "スタッフ",
    "common.where_to_watch": "視聴方法",
    "common.back": "戻る",
    "common.retry": "もう一度試す",

    "franchise.release_order": "公開順",
    "franchise.watch_order": "視聴順",
    "franchise.progress": "シリーズ進行状況",
    "franchise.where_to_start": "どこから見るか",
    "franchise.entries": "エントリ",
    "franchise.watched": "視聴済み",

    "notify.alert": "{lead}分後に放送",
    "notify.time_moved": "時間変更",
    "notify.break": "放送休止 — 今週は放送なし",
  },

  ko: {
    "nav.month": "월",
    "nav.week": "주",
    "nav.agenda": "일정",
    "nav.board": "보드",
    "nav.lists": "목록",
    "nav.dashboard": "통계",
    "nav.recs": "추천",
    "nav.gems": "숨은 명작",
    "nav.browse": "찾아보기",
    "nav.taste": "취향",
    "nav.events": "이벤트",
    "nav.franchise": "시리즈",

    "status.watching": "시청 중",
    "status.plan": "시청 예정",
    "status.completed": "시청 완료",
    "status.on_hold": "보류",
    "status.dropped": "시청 중단",

    "settings.title": "설정",
    "settings.appearance": "모양",
    "settings.theme": "테마",
    "settings.accent": "악센트 색상",
    "settings.density": "밀도",
    "settings.corner_radius": "모서리 둥글기",
    "settings.cover_art": "커버 아트",
    "settings.region": "지역",
    "settings.language": "언어",
    "settings.week_starts": "주 시작",
    "settings.time_format": "시간 형식",
    "settings.day_sort": "하루 내 정렬",
    "settings.show_donghua": "중국 애니메이션",
    "settings.account": "계정",
    "settings.notes": "메모",
    "settings.taste_predictions": "취향 및 예측",
    "settings.looking_back": "돌아보기",
    "settings.your_data": "데이터",

    "common.watched": "시청 완료",
    "common.rating": "평가",
    "common.score": "점수",
    "common.episodes": "화수",
    "common.status": "상태",
    "common.season": "시즌",
    "common.studio": "스튜디오",
    "common.tags": "태그",
    "common.description": "설명",
    "common.related": "관련 작품",
    "common.staff": "스태프",
    "common.where_to_watch": "시청 방법",
    "common.back": "뒤로",
    "common.retry": "다시 시도",

    "franchise.release_order": "공개 순서",
    "franchise.watch_order": "시청 순서",
    "franchise.progress": "시리즈 진행도",
    "franchise.where_to_start": "어디서 시작할까",
    "franchise.entries": "항목",
    "franchise.watched": "시청 완료",

    "notify.alert": "{lead}분 후에 방송",
    "notify.time_moved": "시간 변경",
    "notify.break": "방송 휴지 — 이번 주 방송 없음",
  },

  zh: {
    "nav.month": "月",
    "nav.week": "周",
    "nav.agenda": "议程",
    "nav.board": "看板",
    "nav.lists": "列表",
    "nav.dashboard": "统计",
    "nav.recs": "为你推荐",
    "nav.gems": "隐藏宝藏",
    "nav.browse": "浏览",
    "nav.taste": "口味",
    "nav.events": "活动",
    "nav.franchise": "系列",

    "status.watching": "观看中",
    "status.plan": "计划观看",
    "status.completed": "已观看",
    "status.on_hold": "搁置",
    "status.dropped": "已弃坑",

    "settings.title": "设置",
    "settings.appearance": "外观",
    "settings.theme": "主题",
    "settings.accent": "强调色",
    "settings.density": "密度",
    "settings.corner_radius": "圆角",
    "settings.cover_art": "封面",
    "settings.region": "地区",
    "settings.language": "语言",
    "settings.week_starts": "周开始",
    "settings.time_format": "时间格式",
    "settings.day_sort": "天内排序",
    "settings.show_donghua": "国产动画",
    "settings.account": "账户",
    "settings.notes": "笔记",
    "settings.taste_predictions": "口味与预测",
    "settings.looking_back": "回顾",
    "settings.your_data": "数据",

    "common.watched": "已观看",
    "common.rating": "评分",
    "common.score": "得分",
    "common.episodes": "集数",
    "common.status": "状态",
    "common.season": "季度",
    "common.studio": "工作室",
    "common.tags": "标签",
    "common.description": "描述",
    "common.related": "相关作品",
    "common.staff": "制作人员",
    "common.where_to_watch": "观看地点",
    "common.back": "返回",
    "common.retry": "重试",

    "franchise.release_order": "发布顺序",
    "franchise.watch_order": "观看顺序",
    "franchise.progress": "系列进度",
    "franchise.where_to_start": "从哪里开始",
    "franchise.entries": "个条目",
    "franchise.watched": "已观看",

    "notify.alert": "{lead}分钟后播出",
    "notify.time_moved": "时间变更",
    "notify.break": "放送中断 — 本周无新集",
  },
};

let currentLocale = "en";

export function setLocale(locale){
  if(!LOCALES.includes(locale)) locale = "en";
  currentLocale = locale;
  try{ localStorage.setItem("anical.locale", locale); }catch(e){}
  const html=document.documentElement;
  html.setAttribute("lang", locale);
  const meta=document.querySelector('meta[property="og:locale"]');
  if(meta) meta.setAttribute("content", locale.replace("-","_").toUpperCase()+"_"+locale.toUpperCase());
  return locale;
}

export function getLocale(){ return currentLocale; }

// t(key, params) — replace {param} placeholders.
export function t(key, params={}){
  let s = T[currentLocale]?.[key] || T.en[key] || key;
  for(const [k,v] of Object.entries(params)) s = s.replace(new RegExp(`\\{${k}\\}`,"g"), String(v));
  return s;
}

// Initialize from stored preference or browser language.
export function initI18n(){
  try{ const stored = localStorage.getItem("anical.locale"); if(stored && LOCALES.includes(stored)){ currentLocale = stored; } }
  catch(e){}
  if(currentLocale === "en"){
    const bl = navigator.language || navigator.userLanguage || "en";
    const base = bl.split("-")[0].split("_")[0];
    if(LOCALES.includes(base)) currentLocale = base;
  }
  setLocale(currentLocale);
}

import { dealHandAccent, dealSeatHoverLabel } from "../dealReadyTint";
import type { DropZone } from "../dropZones";
import { zoneAction, zoneTitle, type DraggedKind } from "../zoneLabels";
import { COLORS } from "./constants";

// Как выглядит дроп-зона в каждый момент. Зоны видны ВСЕГДА, но по-разному: в покое — еле
// заметные очертания и название зоны, во время драга — заливка и ДЕЙСТВИЕ («что будет,
// если бросить сюда»). Отдельный модуль, потому что это чистые правила, а не рисование.

/** Серый «туман» запрета: поверх недоступного бокса, когда над ним держат карту. */
const FORBIDDEN_GRAY = 0x2a2f2c;

export interface ZoneChromeInput {
  zone: DropZone;
  /** Идёт драг (колоды или карты). */
  dragging: boolean;
  /** Карта держится ИМЕННО над этим боксом. */
  hovered: boolean;
  /** Что тащат — от этого зависит подпись действия. */
  dragged: DraggedKind;
  /** Моя готовность: в раздаче красит полосу руки жёлтым/серым. */
  myReady: boolean;
  /** Зона сейчас принимает карты. Недоступная под картой краснеет «низя». */
  live: boolean;
  /** Комната в ИГРЕ: центр стола перестаёт быть местом колоды и становится игральной зоной. */
  inGame: boolean;
}

export interface ZoneChrome {
  /** Заливка зоны или null (в покое её нет). */
  fill: { color: number; alpha: number } | null;
  stroke: { width: number; color: number; alpha: number };
  label: { text: string; tint: number; alpha: number };
  /** Обводка глагола для читаемости поверх содержимого бокса (на ховере). */
  labelOutline: { color: number; width: number } | null;
}

/**
 * Как выглядит дроп-зона в каждый момент. Пять состояний:
 *   idle (нет драга)               — еле заметная рамка + название по центру;
 *   драг, доступна, не наведена     — полупрозрачный фон + КРАТКИЙ глагол;
 *   драг, доступна, наведена        — почти непрозрачный фон + глагол с обводкой (читается
 *                                     поверх содержимого бокса);
 *   драг, НЕдоступна, не наведена   — остаётся в idle (не зовёт к себе);
 *   драг, НЕдоступна, наведена      — серый плотный оверлей + «низя».
 * Чистые правила, рисует по ним zonePaint.
 */
export function zoneChrome(o: ZoneChromeInput): ZoneChrome {
  const dealHand = o.zone === "hand";
  const base = dealHand ? dealHandAccent(o.myReady) : COLORS.gold;

  // Idle: и без драга, и недоступная-не-наведённая зона выглядят одинаково спокойно.
  if (!o.dragging || (!o.live && !o.hovered)) {
    return {
      fill: null,
      stroke: { width: 1.5, color: base, alpha: 0.14 },
      label: { text: zoneTitle(o.zone, o.inGame), tint: base, alpha: o.dragging ? 0.1 : 0.16 },
      labelOutline: null,
    };
  }

  // Недоступная под картой: серый туман запрета + «низя», без всякого призыва.
  if (!o.live) {
    return {
      fill: { color: FORBIDDEN_GRAY, alpha: 0.82 },
      stroke: { width: 3, color: COLORS.hot, alpha: 0.5 },
      label: { text: "низя", tint: 0xe8ddc4, alpha: 0.95 },
      labelOutline: { color: 0x000000, width: 3 },
    };
  }

  const verb = zoneAction(o.zone, o.dragged, o.inGame);
  if (o.hovered) {
    // Наведена: фон почти непрозрачный, глагол крупный с обводкой — перекрывает содержимое
    // бокса (карту, что держат, он не трогает — она выше всех по z).
    const activeText = dealHand && !o.inGame ? dealSeatHoverLabel(true) : verb;
    return {
      fill: { color: dealHand ? base : COLORS.hot, alpha: 0.92 },
      stroke: { width: 5, color: COLORS.gold, alpha: 0.95 },
      label: { text: activeText, tint: COLORS.ink, alpha: 0.98 },
      labelOutline: { color: 0xffffff, width: 3 },
    };
  }

  // Доступна, но карта не над ней: полупрозрачный фон + глагол, зовущий к себе.
  return {
    fill: { color: base, alpha: 0.2 },
    stroke: { width: 2.5, color: base, alpha: 0.45 },
    label: { text: verb, tint: base, alpha: 0.6 },
    labelOutline: null,
  };
}

// Слот колоды: разметка, а не дроп-зона — по ней игрок понимает, где лежит колода.
// Сброс раньше был здесь же, но он ПРИНИМАЕТ карты, поэтому переехал в настоящие
// дроп-зоны (dropZones.ts) и рисуется вместе с ними — с подсветкой и действием.
export type TableSlot = "deck";

const SLOT_LABELS: Record<TableSlot, string> = {
  deck: "колода",
};

export function tableSlotChrome(slot: TableSlot): {
  stroke: { width: number; color: number; alpha: number };
  label: string;
  tint: number;
  alpha: number;
} {
  return {
    stroke: { width: 2, color: COLORS.gold, alpha: 0.35 },
    label: SLOT_LABELS[slot],
    tint: COLORS.gold,
    alpha: 0.5,
  };
}

/**
 * Подпись слота стоит НАД боксом: под колодой уже висит её счётчик, а внутри бокса
 * подпись перекрыли бы карты. Возвращает y центра текста (у него anchor 0.5).
 */
export function slotLabelY(rect: { cy: number; h: number }, cardH: number): number {
  return rect.cy - rect.h / 2 - cardH * 0.16;
}

/** Подпись слота мельче зонной: она служебная и не должна спорить с картами. */
export function slotLabelFontSize(slotWidth: number, cardH: number): number {
  const base = Math.min(22, Math.max(10, cardH * 0.26));
  const longest = Math.max(...Object.values(SLOT_LABELS).map((t) => t.length));
  return Math.max(8, Math.min(base, (slotWidth * 0.9) / Math.max(1, longest * 0.62)));
}

/**
 * Размер шрифта подписи зоны: от размера карты, но так, чтобы САМАЯ ДЛИННАЯ из подписей
 * этой зоны влезала по ширине. Считаем по максимуму, иначе шрифт прыгал бы при смене
 * названия на действие во время драга.
 */
export function zoneLabelFontSize(zone: DropZone, zoneWidth: number, cardH: number): number {
  const base = Math.min(44, Math.max(14, cardH * 0.5));
  // По максимуму из ВСЕХ вариантов подписи, включая игровые: иначе кегль прыгал бы при
  // смене названия на действие и при переходе стола из раздачи в игру.
  const longest = Math.max(
    ...[false, true].flatMap((g) => [
      zoneTitle(zone, g).length,
      zoneAction(zone, "card", g).length,
      zoneAction(zone, "take", g).length,
    ]),
  );
  const fit = (zoneWidth * 0.9) / Math.max(1, longest * 0.62);
  return Math.max(9, Math.min(base, fit));
}

/**
 * Размер надписи поверх стола («низяяя» и причины отказов) и ширина переноса.
 *
 * Кегль считается не только от карты, но и ОТ ТЕКСТА: «низяяя» — одно короткое слово и
 * может быть огромным, а причина отказа вроде «карты берут сами» тем же кеглем уезжает за
 * оба края экрана. Поэтому длинную надпись ужимаем и переносим по словам — на телефоне
 * она ложится в две строки.
 */
export function noticeStyle(cardH: number, screenW: number, text: string): { fontSize: number; wrapWidth: number } {
  const wrapWidth = Math.max(1, screenW * 0.86);
  const base = Math.min(110, Math.max(34, cardH * 1.2));
  const words = text.split(/\s+/).filter(Boolean);
  // Строка переноса вмещает не меньше двух средних слов — иначе текст рассыпается в
  // столбик по слову. И ни одно слово не должно быть шире строки: его бы обрезало.
  const longestWord = words.reduce((m, w) => Math.max(m, w.length), 1);
  const twoWords = words.length > 1 ? Math.ceil(text.length / 2) + 1 : text.length;
  const need = Math.max(longestWord, Math.min(twoWords, text.length));
  const fit = wrapWidth / Math.max(1, need * 0.62);
  return { fontSize: Math.max(18, Math.min(base, fit)), wrapWidth };
}

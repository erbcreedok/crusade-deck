import { dealHandAccent, dealSeatHoverLabel } from "../dealReadyTint";
import type { DropZone } from "../dropZones";
import { zoneAction, zoneTitle, type DraggedKind } from "../zoneLabels";
import { COLORS } from "./constants";

// Как выглядит дроп-зона в каждый момент. Зоны видны ВСЕГДА, но по-разному: в покое — еле
// заметные очертания и название зоны, во время драга — заливка и ДЕЙСТВИЕ («что будет,
// если бросить сюда»). Отдельный модуль, потому что это чистые правила, а не рисование.

export interface ZoneChromeInput {
  zone: DropZone;
  /** Идёт драг (колоды или карты). */
  dragging: boolean;
  /** Курсор именно над этой зоной. */
  active: boolean;
  /** Что тащат — от этого зависит подпись действия. */
  dragged: DraggedKind;
  /** Моя готовность: в раздаче красит полосу руки жёлтым/серым. */
  myReady: boolean;
}

export interface ZoneChrome {
  /** Заливка зоны или null (в покое её нет). */
  fill: { color: number; alpha: number } | null;
  stroke: { width: number; color: number; alpha: number };
  label: { text: string; tint: number; alpha: number };
}

export function zoneChrome(o: ZoneChromeInput): ZoneChrome {
  // Полоса руки: готов → жёлтая, не готов → серая (дилер всегда жёлтый).
  const dealHand = o.zone === "hand";
  const base = dealHand ? dealHandAccent(o.myReady) : COLORS.gold;

  let fill: ZoneChrome["fill"] = null;
  if (o.active && dealHand) fill = { color: base, alpha: 0.82 }; // ховер раздачи — плотный оверлей
  else if (o.active) fill = { color: 0xffe08a, alpha: 0.16 };
  else if (o.dragging) fill = { color: base, alpha: 0.06 };

  const stroke = {
    width: o.active ? 5 : o.dragging ? 2.5 : 1.5,
    color: o.active ? COLORS.hot : base,
    alpha: o.active ? 0.95 : o.dragging ? 0.4 : dealHand ? 0.18 : 0.16,
  };

  const text =
    o.active && dealHand
      ? dealSeatHoverLabel(true) // себе раздать можно всегда
      : o.dragging
        ? zoneAction(o.zone, o.dragged)
        : zoneTitle(o.zone);

  const label = {
    text,
    tint: o.active && dealHand ? COLORS.ink : o.active ? COLORS.hot : base,
    alpha: o.active ? (dealHand ? 0.95 : 0.75) : o.dragging ? 0.35 : dealHand ? 0.12 : 0.14,
  };

  return { fill, stroke, label };
}

// Боковые слоты игрового стола. Не дроп-зоны: это разметка, по которой игрок понимает,
// где что лежит. Оттого и вид у них тише зон — только рамка и подпись под ней.
export type TableSlot = "deck" | "discard";

const SLOT_LABELS: Record<TableSlot, string> = {
  deck: "колода",
  discard: "сброс",
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
  const longest = Math.max(zoneTitle(zone).length, zoneAction(zone, "card").length, zoneAction(zone, "take").length);
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

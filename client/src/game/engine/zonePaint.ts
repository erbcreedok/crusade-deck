import { Graphics, Text } from "pixi.js";
import { dropZoneRegions, type DropTarget, type DropZone } from "../dropZones";
import type { RoomLayout, RoundedRect } from "../layout";
import { zoneLabelPlacement, type DraggedKind } from "../zoneLabels";
import {
  noticeStyle,
  slotLabelFontSize,
  slotLabelY,
  tableSlotChrome,
  zoneChrome,
  zoneLabelFontSize,
  type TableSlot,
} from "./zoneChrome";

// Рисование дроп-зон. Что рисовать — решает zoneChrome.ts; здесь только Pixi.

export interface ZonePaintDeps {
  g: Graphics;
  /** Какие зоны сейчас принимают карты (см. dropZoneActivity.ts). */
  live: Set<DropZone>;
  labels: Partial<Record<DropZone, Text>>;
  /** Подписи боковых слотов игрового стола (колода / сброс). */
  slotLabels: Partial<Record<TableSlot, Text>>;
  layout: RoomLayout;
  dragging: boolean;
  hoverZone: DropTarget | null;
  dragged: DraggedKind;
  myReady: boolean;
  /** Комната в игре: центр стола — игральная зона, а не место колоды. */
  inGame: boolean;
  /** Лейбл ПОВЕРХ карт для наведённой зоны (со своей тенью, eventMode none). */
  hoverLabel: Text;
}

export function paintZones(d: ZonePaintDeps): void {
  d.g.clear();
  d.hoverLabel.visible = false; // покажем ниже, если под картой есть зона
  paintTableSlots(d.g, d.layout, d.slotLabels);
  const regions = dropZoneRegions(d.layout);
  (Object.keys(regions) as DropZone[]).forEach((zone) => {
    const { rect } = regions[zone];
    const label = d.labels[zone];
    if (rect.w <= 0 || rect.h <= 0) {
      if (label) label.visible = false;
      return;
    }
    const live = d.live.has(zone);
    const c = zoneChrome({
      zone,
      dragging: d.dragging,
      hovered: d.dragging && d.hoverZone?.zone === zone,
      dragged: d.dragged,
      myReady: d.myReady,
      live,
      inGame: d.inGame,
    });
    const x = rect.cx - rect.w / 2;
    const y = rect.cy - rect.h / 2;

    if (c.fill) d.g.roundRect(x, y, rect.w, rect.h, rect.r).fill(c.fill);
    d.g.roundRect(x, y, rect.w, rect.h, rect.r).stroke(c.stroke);

    // Наведённая зона: глагол/«низя» рисуем ПОВЕРХ карт бокса отдельным лейблом (выше всех,
    // со своей тенью). Он один на весь стол — под картой всегда не больше одной зоны.
    if (c.hoverText) {
      d.hoverLabel.text = c.hoverText.text;
      d.hoverLabel.tint = c.hoverText.tint;
      d.hoverLabel.x = rect.cx;
      d.hoverLabel.y = rect.cy; // на месте центра зоны — в игровой зоне наплывает поверх стеков
      d.hoverLabel.visible = true;
    }

    // Лейбл на слое зон: место — свойство зоны (у колоды снаружи, её рисует paintTableSlots).
    // Под картой (hoverText) его прячем — читается только верхний.
    if (label) {
      if (zoneLabelPlacement(zone) !== "center" || c.hoverText) {
        label.visible = false;
      } else {
        label.text = c.label.text;
        label.x = rect.cx;
        label.y = rect.cy;
        label.visible = true;
        label.tint = c.label.tint;
        label.alpha = c.label.alpha;
      }
    }
  });
}

/**
 * Надпись поверх стола: кегль и перенос по словам под ТЕКУЩИЙ текст. Вызывается и на
 * ресайзе, и на каждой смене текста — длинная причина отказа должна лечь в две строки,
 * а короткое «низяяя» остаться крупным.
 */
export function applyNoticeStyle(notice: Text, cardH: number, screenW: number): void {
  const st = noticeStyle(cardH, screenW, notice.text);
  notice.style.fontSize = st.fontSize;
  notice.style.wordWrap = true;
  notice.style.wordWrapWidth = st.wrapWidth;
  notice.style.align = "center";
  notice.style.lineHeight = st.fontSize * 0.92;
}

/**
 * Боковые слоты игрового стола: слева колода, справа сброс. Рисуются только в игре (в
 * раздаче их нет), тихой рамкой без заливки — это разметка стола, а не дроп-зоны: под
 * ними ничего не подсвечивается и на них ничего не бросают. Сброс пока просто пустое
 * место: карты туда начнут ложиться, когда появятся правила.
 */
export function paintTableSlots(
  g: Graphics,
  layout: RoomLayout,
  labels: Partial<Record<TableSlot, Text>>,
): void {
  const rects: Record<TableSlot, RoundedRect | null> = { deck: layout.deckSlot };
  for (const slot of Object.keys(rects) as TableSlot[]) {
    const rect = rects[slot];
    const label = labels[slot];
    if (!rect || rect.w <= 0 || rect.h <= 0) {
      if (label) label.visible = false;
      continue;
    }
    const c = tableSlotChrome(slot);
    g.roundRect(rect.cx - rect.w / 2, rect.cy - rect.h / 2, rect.w, rect.h, rect.r).stroke(c.stroke);
    if (!label) continue;
    label.text = c.label;
    label.x = rect.cx;
    label.y = slotLabelY(rect, layout.cardH);
    label.style.fontSize = slotLabelFontSize(rect.w, layout.cardH);
    label.tint = c.tint;
    label.alpha = c.alpha;
    label.visible = true;
  }
}

/** Размер шрифта подписей/«низяяя» от размера карты (обновляется на ресайзе). */
export function styleZoneLabels(
  labels: Partial<Record<DropZone, Text>>,
  layout: RoomLayout,
  noticeText: Text | null,
  screenW = 0,
): void {
  const regions = dropZoneRegions(layout);
  for (const zone of Object.keys(labels) as DropZone[]) {
    const t = labels[zone];
    if (!t) continue;
    t.style.fontSize = zoneLabelFontSize(zone, regions[zone].rect.w, layout.cardH);
  }
  if (noticeText) applyNoticeStyle(noticeText, layout.cardH, screenW);
}

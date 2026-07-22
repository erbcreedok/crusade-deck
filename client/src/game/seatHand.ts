// Чужие руки на местах за столом (режим раздачи).
//
// Два независимых флага (как на сервере):
//   handFanned — веер или стопка (раскладка);
//   handOpen   — лица или рубашки (видимость номиналов).
// Закрытая рука МОЖЕТ быть веером — просто рубашками. Открытая стопка показывает лица.

import { anim } from "./anim/config";
import { fanCard, clampFanWidth, fanMaxAngleDeg } from "./fan";
import { stackOffset, stackExtent } from "./deckStack";

export type SeatHandKind = "empty" | "stack" | "fan";

export function seatHandKind(dealMode: boolean, handCount: number, handFanned: boolean): SeatHandKind {
  if (!dealMode || handCount <= 0) return "empty";
  return handFanned ? "fan" : "stack";
}

/** Лицо или рубашка на чужом месте: открытая рука — лица, закрытая — рубашки. */
export function seatCardFaceUp(handOpen: boolean): boolean {
  return handOpen;
}

export interface SeatHandCard {
  x: number;
  y: number;
  rot: number;
  z: number;
}

export interface SeatHandLayout {
  kind: SeatHandKind;
  scale: number;
  cardW: number;
  cardH: number;
  cards: SeatHandCard[];
  counter: { x: number; y: number } | null;
}

export interface SeatHandArgs {
  rect: { cx: number; cy: number; w: number; h: number };
  count: number;
  handFanned: boolean;
  dealMode: boolean;
  tableCardW: number;
  tableCardH: number;
  /** доля от размера карты стола; по умолчанию anim.deck.seatScale */
  seatScale?: number;
}

// Запас под имя сверху и счётчик снизу внутри рамки места.
const NAME_PAD = 0.22;
const COUNTER_PAD = 0.2;

export function layoutSeatHand(args: SeatHandArgs): SeatHandLayout {
  const kind = seatHandKind(args.dealMode, args.count, args.handFanned);
  const scale = args.seatScale ?? anim.deck.seatScale;
  const cardW = args.tableCardW * scale;
  const cardH = args.tableCardH * scale;
  if (kind === "empty") {
    return { kind, scale, cardW, cardH, cards: [], counter: null };
  }

  const { cx, cy, w, h } = args.rect;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const nameY = top + h * NAME_PAD;
  const counterY = bottom - h * COUNTER_PAD * 0.35;
  const areaTop = nameY;
  const areaBottom = counterY - Math.max(10, cardH * 0.28);
  const areaCy = (areaTop + areaBottom) / 2;
  const areaH = Math.max(cardH, areaBottom - areaTop);
  const areaW = Math.max(cardW, w * 0.9);

  if (kind === "stack") {
    const n = args.count;
    const cards: SeatHandCard[] = [];
    for (let i = 0; i < n; i++) {
      const so = stackOffset(i, n, false);
      cards.push({
        x: cx + so.dx * scale,
        y: areaCy + so.dy * scale,
        rot: 0,
        z: i,
      });
    }
    const ext = stackExtent(n);
    const topCard = cards[n - 1]!;
    return {
      kind,
      scale,
      cardW,
      cardH,
      cards,
      counter: {
        x: cx,
        y: topCard.y + cardH / 2 + ext.h * scale * 0.5 + Math.max(8, cardH * 0.22),
      },
    };
  }

  // Веер по числу карт — независимо от handOpen.
  const baseAngle = anim.fan.maxAngleDeg * anim.fan.idle.angleScale;
  const angleDeg = fanMaxAngleDeg(args.count, baseAngle, anim.fan.maxStepAngleDeg);
  const fitW = Math.max(cardW, Math.min(areaW, w - 8) - cardW);
  const width = clampFanWidth(fitW, args.count, cardW, anim.fan.widthFactor, anim.fan.maxStepIdle);
  const anchor = { x: cx, y: areaCy - areaH * 0.08 };
  const cards: SeatHandCard[] = [];
  for (let i = 0; i < args.count; i++) {
    const c = fanCard(i, args.count, anchor, width, angleDeg, anim.fan.widthFactor);
    cards.push({ x: c.x, y: c.y, rot: c.rot, z: i });
  }
  let maxBottom = areaCy;
  for (const c of cards) {
    maxBottom = Math.max(maxBottom, c.y + cardH / 2);
  }
  return {
    kind,
    scale,
    cardW,
    cardH,
    cards,
    counter: { x: cx, y: Math.min(bottom - 4, maxBottom + Math.max(8, cardH * 0.2)) },
  };
}

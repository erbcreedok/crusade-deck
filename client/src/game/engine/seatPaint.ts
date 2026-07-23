import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { anim } from "../anim/config";
import { cardBackSkin, type CardBackId } from "../cardBack";
import { dealSeatHoverLabel } from "../dealReadyTint";
import type { SeatView } from "../seats";
import type { SeatBox } from "../seatLayout";
import { layoutSeatHand, seatCardFaceUp, type SeatHandLayout } from "../seatHand";
import { stackStripeIndices } from "../deckStack";
import { CARD_EDGE, COLORS, PIXEL_FONT, TEX_H } from "./constants";
import { seatChrome, seatLabel } from "./seatChrome";

// Отрисовка чужих мест: прямоугольник, имя с метками, стопка/веер руки и ховер раздачи.
// Правила «как оно выглядит» живут в seatChrome.ts, раскладка руки — в seatHand.ts;
// здесь остаётся только собственно Pixi.

export interface SeatPaintDeps {
  /** Слой мест: сюда добавляются тексты и узлы рук. */
  layer: Container;
  /** Общая Graphics под рамки/заливки (её чистит вызывающий). */
  g: Graphics;
  backTex: Texture;
  /** Лицевая текстура карты (кэш движка). */
  faceTex: (card: string) => Texture;
  cardBack: CardBackId;
  cardW: number;
  cardH: number;
  /** Место под курсором во время драга карты на раздачу. */
  hoverSeat: string | null;
  /** Идёт ли драг карты на раздачу (только тогда место подсвечивается как дроп-зона). */
  dealDragging: boolean;
  /** Сколько карт ПОКАЗЫВАТЬ (схема уже новая, а призраки ещё летят). */
  visualCount: (seat: SeatView) => number;
  /**
   * Комната в ИГРЕ. Тогда числа карт на чужих местах не показываем совсем: за настоящим
   * столом их тоже никто не объявляет, а в раздаче счётчик нужен — дилер следит, сколько
   * кому ушло.
   */
  inGame: boolean;
}

/** Всё, что нарисовали: движок держит ссылки, чтобы убрать это на следующей перерисовке. */
export interface SeatPaintResult {
  texts: Text[];
  nodes: Container[];
}

export function paintSeats(seats: readonly SeatView[], boxes: readonly SeatBox[], d: SeatPaintDeps): SeatPaintResult {
  const out: SeatPaintResult = { texts: [], nodes: [] };
  const fontSize = Math.min(20, Math.max(11, d.cardH * 0.22));

  for (const box of boxes) {
    const seat = seats.find((s) => s.id === box.id);
    if (!seat) continue;
    const { cx, cy, w, h, r } = box.rect;
    const x = cx - w / 2;
    const y = cy - h / 2;
    const hot = d.dealDragging && d.hoverSeat === seat.id;
    const chrome = seatChrome({ ...seat });

    // Idle: только тонкая рамка-стиль (жёлтый/серый), без заливки и эффектов.
    // Контент внутри не красим — цвет только у обводки зоны.
    if (chrome.fill) d.g.roundRect(x, y, w, h, r).fill({ color: 0x000000, alpha: 0.18 });
    d.g.roundRect(x, y, w, h, r).stroke({ width: 2, color: chrome.border, alpha: chrome.strokeAlpha });

    // Имя — к верхнему краю; середину в раздаче занимает стопка/веер руки.
    const label = new Text({
      text: seatLabel(seat),
      style: {
        fontFamily: PIXEL_FONT,
        fontSize,
        fill: seat.connected ? COLORS.seatName : COLORS.seatNameOff,
        letterSpacing: 1,
        align: "center",
        wordWrap: true,
        wordWrapWidth: Math.max(20, w - 10),
      },
    });
    label.anchor.set(0.5, 0);
    label.x = cx;
    label.y = y + 4;
    d.layer.addChild(label);
    out.texts.push(label);

    const visualCount = d.visualCount(seat);
    const handLayout = layoutSeatHand({
      rect: box.rect,
      count: visualCount,
      handFanned: seat.handFanned,
      tableCardW: d.cardW,
      tableCardH: d.cardH,
      showCounter: !d.inGame,
    });
    if (handLayout.kind !== "empty") {
      const node = paintSeatHand(seat, handLayout, visualCount, d);
      if (node) out.nodes.push(node);
    } else if (!d.inGame) {
      // Пустая рука в раздаче — текстовый счётчик вместо карт («—», когда ноль).
      // В игре места молчат: ни карт, ни числа.
      const count = new Text({
        text: visualCount > 0 ? `🂠 ${visualCount}` : "—",
        style: { fontFamily: PIXEL_FONT, fontSize, fill: COLORS.seatCount, letterSpacing: 1 },
      });
      count.anchor.set(0.5, 1);
      count.x = cx;
      count.y = y + h - 4;
      d.layer.addChild(count);
      out.texts.push(count);
    }

    // Ховер раздачи: плотный оверлей поверх контента бокса + действие.
    if (hot && chrome.readyTint != null) {
      const overlay = new Graphics();
      overlay.roundRect(x, y, w, h, r).fill({ color: chrome.readyTint, alpha: 0.82 });
      overlay.roundRect(x, y, w, h, r).stroke({ width: 4, color: COLORS.hot, alpha: 0.95 });
      overlay.eventMode = "none";
      d.layer.addChild(overlay);
      out.nodes.push(overlay);

      const action = new Text({
        text: dealSeatHoverLabel(chrome.dealReady),
        style: {
          fontFamily: PIXEL_FONT,
          fontSize: Math.min(36, Math.max(18, h * 0.28)),
          fill: COLORS.ink,
          letterSpacing: 2,
          align: "center",
        },
      });
      action.anchor.set(0.5);
      action.x = cx;
      action.y = cy;
      action.eventMode = "none";
      d.layer.addChild(action);
      out.texts.push(action);
    }
  }

  return out;
}

/** Стопка (закрытая) или веер (открытая) + цифровой счётчик под ними. */
function paintSeatHand(
  seat: SeatView,
  L: SeatHandLayout,
  visualCount: number,
  d: SeatPaintDeps,
): Container | null {
  if (L.cards.length === 0) return null;
  const root = new Container();
  root.eventMode = "none";
  root.alpha = seat.connected ? 1 : 0.45;

  if (L.kind === "stack") paintSeatStack(root, seat, L, d);
  else paintSeatFan(root, seat, L, d);

  if (L.counter) {
    const count = new Text({
      text: String(visualCount),
      style: {
        fontFamily: PIXEL_FONT,
        fontSize: Math.max(11, Math.min(22, L.cardH * 0.38)),
        fill: COLORS.gold,
        letterSpacing: 1,
      },
    });
    count.anchor.set(0.5);
    count.x = L.counter.x;
    count.y = L.counter.y;
    root.addChild(count);
  }

  d.layer.addChild(root);
  return root;
}

/** Стопка на месте: кирпич + верх. При handOpen верх — лицо (остальное рубашки). */
function paintSeatStack(root: Container, seat: SeatView, L: SeatHandLayout, d: SeatPaintDeps): void {
  const n = L.cards.length;
  const w = L.cardW;
  const h = L.cardH;
  const r = Math.max(2, w * 0.1);
  const bg = cardBackSkin(d.cardBack).bg;
  const top = L.cards[n - 1]!;
  const showFaces = seatCardFaceUp(seat.handOpen);

  if (n >= 3) {
    const g = new Graphics();
    const back = L.cards[0]!;
    g.roundRect(back.x - w / 2, back.y - h / 2, w, h, r)
      .fill({ color: bg })
      .stroke({ width: 1.2, color: CARD_EDGE.side });
    for (const i of stackStripeIndices(n, anim.deck.stripeSpacing).filter((i) => i > 0)) {
      const c = L.cards[i]!;
      g.roundRect(c.x - w / 2, c.y - h / 2, w, h, r).fill({ color: bg });
      g.moveTo(c.x - w / 2 + 0.6, c.y - h / 2 + r)
        .lineTo(c.x - w / 2 + 0.6, c.y + h / 2 - r)
        .stroke({ width: 1.2, color: CARD_EDGE.side });
      g.moveTo(c.x - w / 2 + r, c.y + h / 2 - 0.6)
        .lineTo(c.x + w / 2 - r, c.y + h / 2 - 0.6)
        .stroke({ width: 1.2, color: CARD_EDGE.bottom });
    }
    root.addChild(g);
  } else {
    for (let i = 0; i < n - 1; i++) {
      const c = L.cards[i]!;
      const spr = new Sprite(d.backTex);
      spr.anchor.set(0.5);
      spr.position.set(c.x, c.y);
      spr.scale.set(L.cardH / TEX_H);
      root.addChild(spr);
    }
  }

  const topId = seat.hand[n - 1] ?? "";
  const topTex = showFaces && topId ? d.faceTex(topId) : d.backTex;
  const topSpr = new Sprite(topTex);
  topSpr.anchor.set(0.5);
  topSpr.position.set(top.x, top.y);
  topSpr.scale.set(L.cardH / TEX_H);
  root.addChild(topSpr);
}

/** Веер на месте. Лица — только если handOpen; иначе рубашки (закрытый веер). */
function paintSeatFan(root: Container, seat: SeatView, L: SeatHandLayout, d: SeatPaintDeps): void {
  const ids = seat.hand;
  const showFaces = seatCardFaceUp(seat.handOpen);
  for (let i = 0; i < L.cards.length; i++) {
    const c = L.cards[i]!;
    const id = ids[i] ?? "";
    const tex = showFaces && id ? d.faceTex(id) : d.backTex;
    const spr = new Sprite(tex);
    spr.anchor.set(0.5);
    spr.position.set(c.x, c.y);
    spr.rotation = c.rot;
    spr.scale.set(L.cardH / TEX_H);
    root.addChild(spr);
  }
}

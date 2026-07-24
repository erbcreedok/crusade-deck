import type { Sprite } from "pixi.js";
import type { CardBody } from "../CardBody";

/** Карта на экране: простая мутируемая структура, а не React-нода. */
export interface CardVisual {
  body: CardBody;
  sprite: Sprite;
  card: string; // идентичность карты ("10♠") — для лицевой текстуры
  phase: number; // фазовый сдвиг idle-покачивания (чтобы стопка не «дышала» унисоном)
}

/** Позиция-цель одной карты в анимации растасовки/выплеска. */
export interface ShufflePose {
  x: number;
  y: number;
  rot: number;
}

/** Геометрия веера: якорь дуги, её ширина и максимальный угол крайних карт. */
export interface FanGeom {
  anchor: { x: number; y: number };
  width: number;
  angleDeg: number;
}

/** Раскладка круглой кнопки «сложить» (центр + радиус хит-зоны). */
export interface ButtonLayout {
  x: number;
  y: number;
  r: number;
}

/**
 * Стопка ДОСКИ (не рука): у каждой свой слот, но веером они раскрываются в одном месте.
 *
 * Кучки игральной зоны — такие же стопки доски, просто их много и они появляются на ходу,
 * поэтому имя у них составное: `play:0`, `play:1`… Разбор имени — в engine/boardPile.ts.
 * Именно это позволило зоне достаться весь механизм веера даром: «раскрытая стопка» уже
 * была понятием движка, её надо было только назвать.
 */
export type BoardPile = "deck" | "discard" | `play:${number}`;

/** Слой теней: маска-объединение силуэтов и одна заливка сквозь неё (см. RoomEngine). */
export interface ShadowLayer {
  mask: import("pixi.js").Graphics;
  fill: import("pixi.js").Graphics;
}

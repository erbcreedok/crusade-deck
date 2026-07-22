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

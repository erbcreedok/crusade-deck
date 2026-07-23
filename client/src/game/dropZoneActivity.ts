import type { DropZone } from "./dropZones";
import type { BoardPile } from "./engine/types";

// Какие дроп-зоны «живые» прямо сейчас. Раскрытый веер доски занимает середину стола и
// меняет смысл всего вокруг: пока он лежит, остальные зоны не должны звать к себе карту.
//
// Это ПРАВИЛА, а не рисование: движок красит по ним зоны, а дроп всё равно проверяется
// отдельно (и на сервере тоже). Отдельный модуль — потому что комбинаций четыре и на
// глаз их не удержать.

/** Откуда сейчас тянут карту. */
export type DragSource =
  /** Ничего не тащат — зоны просто размечают стол. */
  | "none"
  /** Карту вытащили из веера доски (колода или сброс). */
  | "board"
  /** Карту тащат из своей руки. */
  | "hand";

export interface ZoneActivityInput {
  /** Какая стопка доски раскрыта веером, если раскрыта. */
  boardFan: BoardPile | null;
  source: DragSource;
  /** Есть ли на столе боксы колоды и сброса (в раздаче их нет). */
  gameMode: boolean;
}

const ALL: DropZone[] = ["center", "hand", "deck", "discard"];

export function activeDropZones(o: ZoneActivityInput): Set<DropZone> {
  // В раздаче доска не размечена: зоны как были — стол и рука.
  if (!o.gameMode) return new Set<DropZone>(["center", "hand"]);

  // Веер не раскрыт — работают обычные боксы стола: игровая зона (центр), рука, сброс.
  // Колода карт не принимает никогда (в игре она закрыта), поэтому её в живых нет.
  if (!o.boardFan) return new Set<DropZone>(["center", "hand", "discard"]);

  // Веер доски раскрыт и занимает центр — ИГРОВАЯ ЗОНА отключается: пока веер лежит, центр
  // принадлежит ему, а не сетке кучек. Остаются рука (для board-карты) и сброс.
  if (o.source === "board") return new Set<DropZone>(["hand", "discard"]);
  if (o.source === "hand") return new Set<DropZone>(["discard"]);

  // Веер раскрыт, но ничего не тащат: гасим всё, кроме сброса — только он готов принять
  // карту. А если веером раскрыт САМ сброс, гасим и его: он сейчас не стопка, а веер.
  return o.boardFan === "discard" ? new Set<DropZone>() : new Set<DropZone>(["discard"]);
}

/** Удобная форма того же ответа: зона за зоной. */
export function zoneActivityMap(o: ZoneActivityInput): Record<DropZone, boolean> {
  const active = activeDropZones(o);
  return Object.fromEntries(ALL.map((z) => [z, active.has(z)])) as Record<DropZone, boolean>;
}

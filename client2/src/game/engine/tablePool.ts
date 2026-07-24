import type { CardTargets } from "../CardBody";
import type { CardVisual } from "./types";

// Единый пул карт СТОЛА (Путь 2, см. PATH2.md). Обобщение CardPile с одного бокса на весь
// стол: один спрайт на идентичность карты, боксы — лишь якоря покоя. Переход карты между
// боксами = setTarget на ТОМ ЖЕ спрайте → настоящий бесшовный перелёт, без призраков и
// пересоздания. Спрайты живут в одном Map<cardId, CardVisual>; где какая лежит — задаёт
// плоский список слотов {card, box, within}.
//
// Класс НЕ знает про Pixi: создание спрайта, вычисление якоря по живой раскладке и уход
// карты из видимости — колбэки движка. Поэтому пул тестируется без WebGL.

export interface TableSlot {
  card: string;
  box: string; // "deck" | "hand" | "discard" | "play:N" | ...
  within: number; // индекс внутри бокса (порядок)
}

export interface TablePoolOptions {
  /** Создать спрайт+тело для новой карты (текстуру/слой знает движок). */
  create: (card: string) => CardVisual;
  /** Место покоя слота (движок знает живую раскладку deckStack/handRow/discardHeap/playGrid). */
  anchor: (slot: TableSlot) => CardTargets;
  /** Откуда НОВАЯ карта стартует до полёта (якорь источника). По умолчанию — её же anchor. */
  spawnAnchor?: (slot: TableSlot) => CardTargets;
  /** Только что созданной карте: z-порядок/текстура/видимость. */
  onEnter?: (visual: CardVisual, slot: TableSlot) => void;
  /** Переехавшей (существующей) карте: обновить z/текстуру под новый слот. */
  onPlace?: (visual: CardVisual, slot: TableSlot) => void;
  /** Карта ушла из видимости (в чужое место / собрана): ретайр — анимация ухода/уничтожение. */
  onLeave?: (visual: CardVisual, card: string) => void;
}

export interface TableApplyResult {
  entered: string[]; // впервые появились
  moved: string[]; // сменили слот (в т.ч. бокс) — летят на новое место
  left: string[]; // ушли из видимости
}

export class TablePool {
  private byCard = new Map<string, CardVisual>();
  /** Текущая раскладка: слот на каждую видимую карту. */
  slots: TableSlot[] = [];

  constructor(private readonly o: TablePoolOptions) {}

  get size(): number {
    return this.byCard.size;
  }

  has(card: string): boolean {
    return this.byCard.has(card);
  }

  get(card: string): CardVisual | undefined {
    return this.byCard.get(card);
  }

  all(): CardVisual[] {
    return [...this.byCard.values()];
  }

  /** Карты бокса в порядке within. */
  inBox(box: string): CardVisual[] {
    return this.slots
      .filter((s) => s.box === box)
      .sort((a, b) => a.within - b.within)
      .map((s) => this.byCard.get(s.card))
      .filter((v): v is CardVisual => !!v);
  }

  /**
   * Привести пул к новой раскладке слотов. Реюз по идентичности: карта, что уже есть,
   * СОХРАНЯЕТ свой спрайт и летит пружиной из старого места в новое (в т.ч. в другой бокс).
   * Новые появляются у spawnAnchor и летят к слоту; исчезнувшие уходят через onLeave.
   *
   * Дубликаты card в next схлопываются в один спрайт (последний слот побеждает): состав
   * стола — множество уникальных карт, дубль означал бы рассинхрон, и «карт-близнецов»
   * движок развести бы не смог.
   */
  apply(next: readonly TableSlot[]): TableApplyResult {
    const entered: string[] = [];
    const moved: string[] = [];
    const left: string[] = [];
    const wanted = new Set(next.map((s) => s.card));

    for (const [card, v] of this.byCard) {
      if (!wanted.has(card)) {
        this.byCard.delete(card);
        this.o.onLeave?.(v, card);
        left.push(card);
      }
    }

    for (const slot of next) {
      let v = this.byCard.get(slot.card);
      if (!v) {
        v = this.o.create(slot.card);
        this.byCard.set(slot.card, v);
        v.body.snapTo(this.o.spawnAnchor?.(slot) ?? this.o.anchor(slot));
        this.o.onEnter?.(v, slot);
        v.body.setTarget(this.o.anchor(slot));
        entered.push(slot.card);
      } else {
        this.o.onPlace?.(v, slot);
        v.body.setTarget(this.o.anchor(slot));
        moved.push(slot.card);
      }
    }

    this.slots = next.map((s) => ({ ...s }));
    return { entered, moved, left };
  }

  /** Отпустить всё (движок уже уничтожил сцену целиком). */
  clear(): void {
    this.byCard.clear();
    this.slots = [];
  }
}

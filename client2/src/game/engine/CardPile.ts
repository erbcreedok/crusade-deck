import type { CardTargets } from "../CardBody";
import { anim } from "../anim/config";
import { moveCard } from "../deckOrder";
import type { CardVisual } from "./types";

// Стопка карт на экране: порядок (идентичности карт) плюс привязанные к ним спрайты.
//
// Колода на столе и своя рука — это ОДНА И ТА ЖЕ вещь с разной раскладкой, но раньше они
// жили в движке двумя зеркальными наборами полей и методов (reconcileByIdentity /
// reconcileHandByIdentity, restTarget / handRestTarget), и любая правка требовалась
// дважды. Разница между ними теперь сводится к двум колбэкам: где лежит карта с номером i
// (restTarget) и что сделать с только что созданным спрайтом (place — z-порядок у колоды,
// «спрячь, пока летит» у руки).
//
// Спрайты привязаны к ИДЕНТИЧНОСТИ карты, а не к индексу массива: только поэтому тасовку
// можно проиграть по-настоящему — каждая карта летит из своего старого слота в новый,
// а не телепортируется.

export interface CardPileOptions {
  /** Создать спрайт+тело для новой карты (текстуру и слой знает движок). */
  create: (card: string) => CardVisual;
  /** Куда карта с номером i ложится в покое. */
  restTarget: (index: number) => CardTargets;
  /** Что сделать с ТОЛЬКО ЧТО созданной картой: z-порядок, видимость и т.п. */
  place?: (visual: CardVisual, index: number) => void;
}

export class CardPile {
  /** Спрайты в порядке стопки. Движок мутирует их напрямую — это его карты. */
  cards: CardVisual[] = [];
  /** Порядок карт (идентичности). Правда о составе — здесь, а не в спрайтах. */
  order: string[] = [];

  constructor(private readonly o: CardPileOptions) {}

  get count(): number {
    return this.order.length;
  }

  /** Есть ли такая карта в стопке. */
  has(card: string): boolean {
    return this.order.includes(card);
  }

  indexOf(visual: CardVisual): number {
    return this.cards.indexOf(visual);
  }

  /**
   * Переставить спрайты в порядок newOrder, ПЕРЕИСПОЛЬЗУЯ их по идентичности карты (тела
   * остаются на текущих местах — их двигает анимация). Новые карты появляются сразу на
   * своём месте, исчезнувшие (раздали/забрали) уничтожаются.
   *
   * Пул по id, а не Map: если в старом списке случайно оказались дубликаты, Map оставил бы
   * лишние спрайты висеть на сцене навсегда.
   */
  reconcile(newOrder: readonly string[]): void {
    const pool = new Map<string, CardVisual[]>();
    for (const c of this.cards) {
      const key = c.card || "";
      const bucket = pool.get(key);
      if (bucket) bucket.push(c);
      else pool.set(key, [c]);
    }

    const next: CardVisual[] = [];
    for (let j = 0; j < newOrder.length; j++) {
      const card = newOrder[j]!;
      // Переиспользованной карте СТАРЫЙ z-порядок сохраняем: растасовка сменит его в
      // апексе полёта, где перещёлк не читается как подмена карты на месте.
      let v = pool.get(card)?.pop();
      if (!v) {
        v = this.o.create(card);
        v.body.snapTo(this.o.restTarget(j));
        this.o.place?.(v, j);
      }
      v.card = card;
      v.phase = j * anim.idle.phaseStep; // фазовый сдвиг idle: стопка не «дышит» унисоном
      next.push(v);
    }
    for (const bucket of pool.values()) {
      for (const leftover of bucket) leftover.sprite.destroy();
    }
    this.cards = next;
    this.order = [...newOrder];
  }

  /**
   * Оптимистичная перестановка одной карты. Возвращает false при рассинхроне порядка со
   * спрайтами — тогда лучше не трогать ничего и дождаться правды с сервера.
   */
  moveCard(card: string, to: number): boolean {
    return this.applyOrder(moveCard(this.order, card, to));
  }

  /** Применить готовый порядок к уже существующим спрайтам (без создания и удаления). */
  applyOrder(order: readonly string[]): boolean {
    const byCard = new Map(this.cards.map((c) => [c.card, c]));
    const next = order.map((c) => byCard.get(c)).filter((c): c is CardVisual => !!c);
    if (next.length !== this.cards.length) return false; // рассинхрон — не трогаем
    this.order = [...order];
    this.cards = next;
    return true;
  }

  /**
   * Запомнить порядок, не трогая спрайтов. Нужно, когда состояние комнаты приехало ДО
   * монтирования сцены: сцены ещё нет, но состав уже известен — на mount его доиграют.
   */
  remember(order: readonly string[]): void {
    this.order = [...order];
  }

  /** Разложить карты по их местам покоя (после реордера/смены зоны). */
  layout(apply: (visual: CardVisual, index: number, target: CardTargets) => void): void {
    this.cards.forEach((c, i) => apply(c, i, this.o.restTarget(i)));
  }

  /** Отпустить всё (движок уже уничтожил сцену целиком). */
  clear(): void {
    this.cards = [];
    this.order = [];
  }
}

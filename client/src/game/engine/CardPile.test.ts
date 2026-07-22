import { describe, expect, it, vi } from "vitest";
import { CardPile } from "./CardPile";
import type { CardVisual } from "./types";

// Подставная карта: от настоящей нужны только идентичность, «тело» (куда её кладут)
// и спрайт, который можно уничтожить.
function fakeVisual(card: string): CardVisual {
  return {
    card,
    phase: 0,
    body: { snapTo: vi.fn(), px: 0, py: 0 } as unknown as CardVisual["body"],
    sprite: { destroy: vi.fn(), zIndex: 0, visible: true } as unknown as CardVisual["sprite"],
  };
}

function makePile(place?: (v: CardVisual, i: number) => void) {
  const created: string[] = [];
  const pile = new CardPile({
    create: (card) => {
      created.push(card);
      return fakeVisual(card);
    },
    restTarget: (i) => ({ x: i * 10, y: 0, rot: 0, scale: 1 }),
    place,
  });
  return { pile, created };
}

const ids = (pile: CardPile) => pile.cards.map((c) => c.card);

describe("CardPile.reconcile", () => {
  it("создаёт спрайт на каждую новую карту", () => {
    const { pile, created } = makePile();
    pile.reconcile(["A♠", "K♥"]);
    expect(created).toEqual(["A♠", "K♥"]);
    expect(ids(pile)).toEqual(["A♠", "K♥"]);
    expect(pile.count).toBe(2);
  });

  it("тасовка переиспользует те же спрайты — новых не создаёт", () => {
    const { pile, created } = makePile();
    pile.reconcile(["A♠", "K♥", "Q♦"]);
    const before = [...pile.cards];
    pile.reconcile(["Q♦", "A♠", "K♥"]);
    expect(created).toHaveLength(3);
    expect(pile.cards).toEqual([before[2], before[0], before[1]]);
  });

  it("ушедшая карта уничтожается ровно одна", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥"]);
    const gone = pile.cards[0]!;
    const stays = pile.cards[1]!;
    pile.reconcile(["K♥"]);
    expect(gone.sprite.destroy).toHaveBeenCalled();
    expect(stays.sprite.destroy).not.toHaveBeenCalled();
  });

  it("новая карта сразу кладётся на своё место, а не выезжает из ниоткуда", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥"]);
    expect(pile.cards[1]!.body.snapTo).toHaveBeenCalledWith({ x: 10, y: 0, rot: 0, scale: 1 });
  });

  it("place зовётся только для новых карт (у переиспользованных свой z-порядок)", () => {
    const place = vi.fn();
    const { pile } = makePile(place);
    pile.reconcile(["A♠"]);
    expect(place).toHaveBeenCalledTimes(1);
    place.mockClear();
    pile.reconcile(["A♠", "K♥"]);
    expect(place).toHaveBeenCalledTimes(1);
    expect(place.mock.calls[0]![1]).toBe(1); // индекс новой карты
  });

  it("дубликаты в старом составе не оставляют висящих спрайтов", () => {
    const { pile } = makePile();
    // Подсовываем стопке дубликат (рассинхрон, который когда-то и случался).
    pile.reconcile(["A♠"]);
    pile.cards.push(fakeVisual("A♠"));
    const twins = [...pile.cards];

    pile.reconcile(["A♠"]);
    // Ровно один спрайт остаётся на сцене, второй уничтожен — иначе близнец висел бы вечно.
    expect(pile.cards).toHaveLength(1);
    const destroyed = twins.filter((v) => (v.sprite.destroy as unknown as { mock: { calls: [] } }).mock.calls.length > 0);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).not.toBe(pile.cards[0]);
  });

  it("фаза idle раздаётся по индексу — стопка не «дышит» унисоном", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥", "Q♦"]);
    const phases = pile.cards.map((c) => c.phase);
    expect(new Set(phases).size).toBe(3);
  });

  it("пустой порядок опустошает стопку", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠"]);
    pile.reconcile([]);
    expect(pile.cards).toHaveLength(0);
    expect(pile.count).toBe(0);
  });
});

describe("CardPile.moveCard / applyOrder", () => {
  it("двигает карту в новый слот вместе с её спрайтом", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥", "Q♦"]);
    expect(pile.moveCard("Q♦", 0)).toBe(true);
    expect(ids(pile)).toEqual(["Q♦", "A♠", "K♥"]);
    expect(pile.order).toEqual(["Q♦", "A♠", "K♥"]);
  });

  it("применяет готовый порядок целиком", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥"]);
    expect(pile.applyOrder(["K♥", "A♠"])).toBe(true);
    expect(ids(pile)).toEqual(["K♥", "A♠"]);
  });

  it("при рассинхроне отказывается и НИЧЕГО не меняет", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥"]);
    expect(pile.applyOrder(["A♠", "неизвестная"])).toBe(false);
    expect(ids(pile)).toEqual(["A♠", "K♥"]);
    expect(pile.order).toEqual(["A♠", "K♥"]);
  });

  it("порядок и спрайты остаются согласованными", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥", "Q♦"]);
    pile.moveCard("A♠", 2);
    expect(pile.order).toEqual(ids(pile));
  });
});

describe("CardPile.remember", () => {
  it("запоминает состав до монтирования, спрайтов не создавая", () => {
    const { pile, created } = makePile();
    pile.remember(["A♠", "K♥"]);
    expect(pile.order).toEqual(["A♠", "K♥"]);
    expect(pile.count).toBe(2);
    expect(created).toHaveLength(0);
    expect(pile.cards).toHaveLength(0);
  });

  it("запомненный состав доигрывается позже обычным reconcile", () => {
    const { pile, created } = makePile();
    pile.remember(["A♠", "K♥"]);
    pile.reconcile(pile.order);
    expect(created).toEqual(["A♠", "K♥"]);
  });
});

describe("CardPile.layout", () => {
  it("отдаёт каждой карте её место покоя", () => {
    const { pile } = makePile();
    pile.reconcile(["A♠", "K♥"]);
    const seen: number[] = [];
    pile.layout((_v, i, t) => seen.push(t.x ?? -1));
    expect(seen).toEqual([0, 10]);
  });
});

import { describe, it, expect } from "vitest";
import { computeLayout, type RoundedRect, recommendedHandHeight } from "./layout";

function inside(r: RoundedRect, w: number, h: number) {
  return r.cx - r.w / 2 >= -1 && r.cx + r.w / 2 <= w + 1 && r.cy - r.h / 2 >= -1 && r.cy + r.h / 2 <= h + 1;
}

describe("computeLayout", () => {
  it("зоны центра и руки занимают ≥80% ширины", () => {
    const l = computeLayout(800, 600);
    expect(l.centerZone.w).toBeGreaterThanOrEqual(800 * 0.8);
    expect(l.handZone.w).toBeGreaterThanOrEqual(800 * 0.8);
  });

  it("все зоны вписаны в канвас", () => {
    const l = computeLayout(800, 600);
    expect(inside(l.centerZone, 800, 600)).toBe(true);

    expect(inside(l.handZone, 800, 600)).toBe(true);
  });


  it("центр целиком выше нижней полосы", () => {
    const l = computeLayout(800, 600);
    expect(l.centerZone.cy + l.centerZone.h / 2).toBeLessThan(l.handZone.cy - l.handZone.h / 2);
  });


  it("якоря колоды совпадают с центрами своих зон", () => {
    const l = computeLayout(800, 600);
    expect(l.deckAnchor).toEqual({ x: l.centerZone.cx, y: l.centerZone.cy });
    expect(l.handAnchor).toEqual({ x: l.handZone.cx, y: l.handZone.cy });
  });

  it("карта имеет пропорции игральной (узкая по ширине)", () => {
    const l = computeLayout(800, 600);
    expect(l.cardW / l.cardH).toBeCloseTo(0.7, 1);
  });

  it("масштабируется: канвас крупнее → карта крупнее (до клампа)", () => {
    const small = computeLayout(320, 480);
    const big = computeLayout(1200, 900);
    expect(big.cardH).toBeGreaterThan(small.cardH);
  });

  it("размер карты ограничен сверху на огромном канвасе", () => {
    const huge = computeLayout(4000, 3000);
    expect(huge.cardH).toBeLessThanOrEqual(140);
  });

  it("устойчив к вырожденным размерам (0/крошечный) — без NaN и отрицательных размеров", () => {
    const l = computeLayout(0, 0);
    expect(Number.isFinite(l.centerZone.w)).toBe(true);
    expect(l.centerZone.w).toBeGreaterThanOrEqual(0);
    expect(l.cardH).toBeGreaterThan(0);
  });
});

// Чужие места (посадка «П») отжимают центр стола: сверху — полоса, по бокам — колонки.
describe("computeLayout с посадкой игроков", () => {
  const insets = { top: 80, left: 120, right: 120 };

  it("центр ужимается по ширине под боковые колонки", () => {
    const free = computeLayout(900, 700);
    const squeezed = computeLayout(900, 700, insets);
    expect(squeezed.centerZone.w).toBeLessThan(free.centerZone.w);
    expect(squeezed.centerZone.cx - squeezed.centerZone.w / 2).toBeGreaterThanOrEqual(insets.left - 1);
    expect(squeezed.centerZone.cx + squeezed.centerZone.w / 2).toBeLessThanOrEqual(900 - insets.right + 1);
  });

  it("центр не залезает под верхнюю полосу мест", () => {
    const l = computeLayout(900, 700, insets);
    expect(l.centerZone.cy - l.centerZone.h / 2).toBeGreaterThanOrEqual(insets.top - 1);
  });

  it("моя рука от чужой посадки не зависит", () => {
    const free = computeLayout(900, 700);
    const squeezed = computeLayout(900, 700, insets);

    expect(squeezed.handZone).toEqual(free.handZone);
  });

  it("якорь колоды едет вместе с ужатым центром", () => {
    const l = computeLayout(900, 700, insets);
    expect(l.deckAnchor).toEqual({ x: l.centerZone.cx, y: l.centerZone.cy });
  });

  it("абсурдные отступы не дают отрицательный центр", () => {
    const l = computeLayout(300, 500, { top: 400, left: 400, right: 400 });
    expect(l.centerZone.w).toBeGreaterThan(0);
    expect(l.centerZone.h).toBeGreaterThan(0);
  });
});

// Панель действий внизу — HTML фиксированной высоты поверх канваса. Игровые зоны
// обязаны заканчиваться НАД ней, иначе карты уезжают под кнопки.
describe("computeLayout с панелью действий внизу", () => {
  const insets = { top: 0, left: 0, right: 0, bottom: 90 };

  it("нижняя полоса (рука) не залезает под панель", () => {
    const l = computeLayout(800, 600, insets);
    expect(l.handZone.cy + l.handZone.h / 2).toBeLessThanOrEqual(600 - insets.bottom);

  });

  it("без панели полоса опускается ниже — отступ реально работает", () => {
    const free = computeLayout(800, 600);
    const raised = computeLayout(800, 600, insets);
    expect(raised.handZone.cy).toBeLessThan(free.handZone.cy);
  });

  it("центр по-прежнему выше нижней полосы", () => {
    const l = computeLayout(800, 600, insets);
    expect(l.centerZone.cy + l.centerZone.h / 2).toBeLessThan(l.handZone.cy - l.handZone.h / 2);
  });

  it("абсурдная панель не съедает зоны в ноль", () => {
    const l = computeLayout(400, 500, { top: 0, left: 0, right: 0, bottom: 5000 });
    expect(l.handZone.h).toBeGreaterThan(0);

    expect(l.centerZone.h).toBeGreaterThan(0);
  });
});

// узкой полоской у края и уходит на задний план. Без фокуса — привычные 80/20.

describe("высота полосы руки", () => {
  it("на узком экране ужимается КАРТА, а не раздувается полоса", () => {
    const narrow = computeLayout(320, 560);
    const wide = computeLayout(900, 1200);
    expect(narrow.cardH).toBeLessThan(wide.cardH);
    // Полоса не должна съедать больше ~40% высоты — ради этого и режется карта.
    expect(narrow.handZone.h).toBeLessThanOrEqual(560 * 0.45);
  });

  it("низкая панель действий тоже ужимает карту, а не полосу", () => {
    const free = computeLayout(400, 800);
    const squeezed = computeLayout(400, 800, { top: 0, left: 0, right: 0, bottom: 300 });
    expect(squeezed.cardH).toBeLessThanOrEqual(free.cardH);
    expect(squeezed.handZone.h).toBeLessThanOrEqual(free.handZone.h);
  });

  it("вмещает карту и кнопку «сложить руку» под ней, с запасом", () => {
    for (const [w, h] of [[400, 800], [1400, 900], [360, 640]] as const) {
      const l = computeLayout(w, h);
      const need = recommendedHandHeight(l.cardH);
      expect(l.handZone.h).toBeGreaterThanOrEqual(need - 1e-9);
      // Проверяем именно смысл: карта + диаметр кнопки помещаются, и что-то остаётся.
      expect(need).toBeGreaterThan(l.cardH * 1.9);
    }
  });

  it("панель действий снизу не может ужать полосу ниже рекомендованной", () => {
    const l = computeLayout(400, 800, { top: 0, left: 0, right: 0, bottom: 380 });
    expect(l.handZone.h).toBeGreaterThanOrEqual(recommendedHandHeight(l.cardH) - 1e-9);
  });
});

// Стол в ИГРЕ (после «ГОУ!») делится на три бокса: колода слева, игровая зона по центру,
// пустой слот сброса справа. В раздаче стола-с-боксами нет — там колода лежит по центру,
// и дилер раздаёт с неё.
describe("computeLayout — игровой стол", () => {
  const sizes = [
    [390, 800],
    [320, 640],
    [900, 1200],
    [1400, 900],
  ] as const;

  it("в раздаче боксов нет, колода лежит в центре", () => {
    const l = computeLayout(390, 800);
    expect(l.deckSlot).toBeNull();
    expect(l.discardSlot).toBeNull();
    expect(l.deckAnchor.x).toBeCloseTo(l.centerZone.cx, 5);
  });

  it("в игре колода уезжает влево, сброс — вправо, игра — между ними", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, undefined, true);
      expect(l.deckSlot).not.toBeNull();
      expect(l.discardSlot).not.toBeNull();
      expect(l.deckSlot!.cx).toBeLessThan(l.centerZone.cx);
      expect(l.discardSlot!.cx).toBeGreaterThan(l.centerZone.cx);
    }
  });

  it("игровая зона — самый широкий бокс", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, undefined, true);
      expect(l.centerZone.w).toBeGreaterThan(l.deckSlot!.w);
      expect(l.centerZone.w).toBeGreaterThan(l.discardSlot!.w);
    }
  });

  it("боксы не наезжают друг на друга", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, undefined, true);
      const rightOf = (r: { cx: number; w: number }) => r.cx + r.w / 2;
      const leftOf = (r: { cx: number; w: number }) => r.cx - r.w / 2;
      expect(rightOf(l.deckSlot!)).toBeLessThanOrEqual(leftOf(l.centerZone) + 1e-9);
      expect(rightOf(l.centerZone)).toBeLessThanOrEqual(leftOf(l.discardSlot!) + 1e-9);
    }
  });

  it("колода покоится в своём слоте, а не в игровой зоне", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, undefined, true);
      expect(l.deckAnchor.x).toBeCloseTo(l.deckSlot!.cx, 5);
      expect(l.deckAnchor.y).toBeCloseTo(l.deckSlot!.cy, 5);
    }
  });

  it("слоты вмещают стопку карт целиком", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, undefined, true);
      for (const slot of [l.deckSlot!, l.discardSlot!]) {
        expect(slot.w).toBeGreaterThanOrEqual(l.cardW);
        expect(slot.h).toBeGreaterThanOrEqual(l.cardH);
      }
    }
  });

  it("боксы разъезжаются к краям экрана, но руку не трогают", () => {
    for (const [w, h] of sizes) {
      const deal = computeLayout(w, h);
      const game = computeLayout(w, h, undefined, true);
      expect(game.handZone).toEqual(deal.handZone);
      for (const box of [game.deckSlot!, game.centerZone, game.discardSlot!]) {
        expect(box.cx - box.w / 2).toBeGreaterThanOrEqual(0);
        expect(box.cx + box.w / 2).toBeLessThanOrEqual(w);
        expect(box.cy + box.h / 2).toBeLessThanOrEqual(game.handZone.cy - game.handZone.h / 2 + 1e-9);
      }
    }
  });

  it("игровая зона шире, чем центр стола в раздаче: боксы ушли к краям", () => {
    for (const [w, h] of sizes) {
      const deal = computeLayout(w, h);
      const game = computeLayout(w, h, undefined, true);
      const boxes = game.deckSlot!.w + game.centerZone.w + game.discardSlot!.w;
      expect(boxes).toBeGreaterThan(deal.centerZone.w);
    }
  });

  it("сброс — колонка во всю высоту стола: в неё удобно целиться картой", () => {
    for (const [w, h] of sizes) {
      const game = computeLayout(w, h, undefined, true);
      expect(game.discardSlot!.h).toBe(game.centerZone.h);
      expect(game.discardSlot!.h).toBeGreaterThan(game.deckSlot!.h);
      expect(game.discardSlot!.w).toBeLessThan(game.deckSlot!.w);
    }
  });

  it("веер доски раскрывается в игровой зоне, а не над слотом колоды", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, undefined, true);
      expect(l.boardFanAnchor.x).toBeCloseTo(l.centerZone.cx, 5);
      expect(l.boardFanAnchor.y).toBeCloseTo(l.centerZone.cy, 5);
      expect(l.boardFanAnchor.x).not.toBeCloseTo(l.deckAnchor.x, 1);
    }
  });

  it("в раздаче место веера то же самое — центр стола", () => {
    const l = computeLayout(390, 800);
    expect(l.boardFanAnchor).toEqual(l.deckAnchor);
  });

  it("на узком экране игровая зона не вырождается", () => {
    const l = computeLayout(320, 640, undefined, true);
    expect(l.centerZone.w).toBeGreaterThan(l.cardW);
  });
});

// Соседи по кругу сидят в верхних углах, над крайними боксами стола. Ширину стола они не
// режут — иначе на телефоне игровая зона схлопывалась бы в щель между двумя местами.
// Вместо этого крайние боксы уступают им по вертикали (см. seatLayout.ts).
describe("computeLayout — стол уступает боковым соседям по вертикали", () => {
  const W = 420;
  const H = 760;
  const base = { top: 80, side: 0 };
  const withSides = { top: 80, side: 110 };

  it("в игре колода съезжает ниже, освобождая угол под соседа", () => {
    const free = computeLayout(W, H, base, true);
    const yielded = computeLayout(W, H, withSides, true);
    expect(yielded.deckSlot!.cy).toBeGreaterThan(free.deckSlot!.cy);
    expect(yielded.deckSlot!.h).toBeCloseTo(free.deckSlot!.h);
  });

  it("сброс становится ниже ростом, а не съезжает целиком", () => {
    const free = computeLayout(W, H, base, true);
    const yielded = computeLayout(W, H, withSides, true);
    expect(yielded.discardSlot!.h).toBeLessThan(free.discardSlot!.h);
    // верх колонки опустился ровно на высоту соседа, низ остался на месте
    const top = (r: { cy: number; h: number }) => r.cy - r.h / 2;
    const bottom = (r: { cy: number; h: number }) => r.cy + r.h / 2;
    expect(top(yielded.discardSlot!)).toBeGreaterThan(top(free.discardSlot!));
    expect(bottom(yielded.discardSlot!)).toBeCloseTo(bottom(free.discardSlot!));
  });

  it("игровая зона в середине не трогается: соседи стоят по краям, а не над ней", () => {
    const free = computeLayout(W, H, base, true);
    const yielded = computeLayout(W, H, withSides, true);
    expect(yielded.centerZone).toEqual(free.centerZone);
  });

  it("стол по ширине не режется: боковые соседи не сужают его", () => {
    const free = computeLayout(W, H, base, true);
    const yielded = computeLayout(W, H, withSides, true);
    expect(yielded.discardSlot!.cx + yielded.discardSlot!.w / 2).toBeCloseTo(
      free.discardSlot!.cx + free.discardSlot!.w / 2,
    );
  });

  it("в раздаче делить нечего — стол просто опускается под соседей", () => {
    const free = computeLayout(W, H, base);
    const yielded = computeLayout(W, H, withSides);
    expect(yielded.centerZone.cy - yielded.centerZone.h / 2).toBeGreaterThan(
      free.centerZone.cy - free.centerZone.h / 2,
    );
  });

  it("абсурдная высота соседей не выворачивает боксы наизнанку", () => {
    const l = computeLayout(W, H, { top: 80, side: 5000 }, true);
    expect(l.deckSlot!.h).toBeGreaterThan(0);
    expect(l.discardSlot!.h).toBeGreaterThan(0);
    expect(l.discardSlot!.cy + l.discardSlot!.h / 2).toBeLessThanOrEqual(H);
  });
});

import { describe, it, expect } from "vitest";
import { boardFanCardScale, layoutDeckFan } from "./deckFan";
import { fanCard } from "./fan";

const zone = { cx: 200, cy: 300, w: 400, h: 280 };
const stackAnchor = { x: 200, y: 300 }; // центр зоны = якорь стопки

describe("layoutDeckFan", () => {
  it("якорь веера = якорь стопки, а не верх зоны (как у руки)", () => {
    const g = layoutDeckFan({
      stackAnchor,
      zone,
      count: 36,
      cardW: 70,
      cardH: 100,
      reservedBelow: 130,
    });
    expect(g.anchor.x).toBe(stackAnchor.x);
    expect(g.anchor.y).toBe(stackAnchor.y);
    const handStyleTop = zone.cy - zone.h / 2 + 100 * 0.55;
    expect(g.anchor.y).toBeGreaterThan(handStyleTop + 50);
  });

  it("не схлопывается в спираль: ширина от зоны, даже если снизу мало места", () => {
    const g = layoutDeckFan({
      stackAnchor,
      zone,
      count: 19,
      cardW: 70,
      cardH: 100,
      reservedBelow: 130, // раньше из‑за этого sagMax=1 и width≈8
    });
    expect(g.width).toBeGreaterThan(200);
    // Крайние карты разведены по X, а не свалены в кучу с огромным углом на крошечной дуге.
    const left = fanCard(0, 19, g.anchor, g.width, g.angleDeg, 0.9);
    const right = fanCard(18, 19, g.anchor, g.width, g.angleDeg, 0.9);
    expect(right.x - left.x).toBeGreaterThan(150);
  });

  it("мало карт — угол маленький", () => {
    const g = layoutDeckFan({
      stackAnchor,
      zone,
      count: 2,
      cardW: 70,
      cardH: 100,
    });
    expect(g.angleDeg).toBeLessThanOrEqual(2.01);
  });
});

describe("boardFanCardScale", () => {
  const cardW = 63;

  it("мало карт — крупнее обычного", () => {
    expect(boardFanCardScale(3, 320, cardW)).toBeGreaterThan(1.2);
    expect(boardFanCardScale(1, 320, cardW)).toBeGreaterThan(boardFanCardScale(6, 320, cardW));
  });

  it("много карт — обычный размер, но не мельче", () => {
    expect(boardFanCardScale(36, 320, cardW)).toBe(1);
    expect(boardFanCardScale(52, 100, cardW)).toBe(1);
  });

  it("растёт вместе с отведённой шириной, но упирается в потолок", () => {
    expect(boardFanCardScale(5, 400, cardW)).toBeGreaterThan(boardFanCardScale(5, 250, cardW));
    expect(boardFanCardScale(2, 5000, cardW)).toBe(boardFanCardScale(1, 5000, cardW));
  });

  it("вырожденные значения не ломают масштаб", () => {
    expect(boardFanCardScale(0, 320, cardW)).toBe(1);
    expect(boardFanCardScale(5, 0, cardW)).toBe(1);
    expect(boardFanCardScale(5, 320, 0)).toBe(1);
  });
});

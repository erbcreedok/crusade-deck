import { describe, it, expect } from "vitest";
import { layoutDeckFan } from "./deckFan";
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

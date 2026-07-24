import { describe, expect, it } from "vitest";
import { pipLayout } from "./pipLayout";

describe("pipLayout", () => {
  it("число значков совпадает с номиналом для 2..10", () => {
    for (let n = 2; n <= 10; n++) {
      expect(pipLayout(String(n))).toHaveLength(n);
    }
  });

  it("для картинок и туза раскладки нет — рисуются иначе", () => {
    expect(pipLayout("A")).toEqual([]);
    expect(pipLayout("J")).toEqual([]);
    expect(pipLayout("Q")).toEqual([]);
    expect(pipLayout("K")).toEqual([]);
  });

  it("все значки внутри лица (0..1)", () => {
    for (let n = 2; n <= 10; n++) {
      for (const p of pipLayout(String(n))) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(1);
      }
    }
  });

  it("нижняя половина перевёрнута, верхняя — нет, центр не переворачивается", () => {
    for (const p of pipLayout("10")) {
      expect(p.flip).toBe(p.y > 0.5);
    }
    // Тройка: верх, центр, низ — только нижний перевёрнут.
    const three = pipLayout("3");
    expect(three.map((p) => p.flip)).toEqual([false, false, true]);
  });

  it("чётные номиналы симметричны по вертикали, читаются с обоих концов", () => {
    // Нечётные (5, 7, 9) намеренно несимметричны: лишний значок сидит в центре/верху,
    // как на настоящих картах, — проверяем именно чётные.
    for (const n of [2, 4, 6, 8, 10]) {
      const ys = pipLayout(String(n))
        .map((p) => p.y)
        .sort((a, b) => a - b);
      const mirrored = ys.map((y) => 1 - y).sort((a, b) => a - b);
      for (let i = 0; i < ys.length; i++) expect(ys[i]).toBeCloseTo(mirrored[i]!, 6);
    }
  });
});

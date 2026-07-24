import { describe, expect, it } from "vitest";
import { layoutCollapseButton, stepReveal } from "./collapseArrow";

describe("layoutCollapseButton", () => {
  it("кнопка стоит по центру зоны и ПОД веером", () => {
    const fan = { anchor: { x: 200, y: 400 }, width: 300, angleDeg: 30 };
    const b = layoutCollapseButton(200, fan, 90);
    expect(b.x).toBe(200);
    expect(b.y).toBeGreaterThan(fan.anchor.y - 90 / 2); // ниже верхнего края карты
    expect(b.r).toBeGreaterThan(0);
  });

  it("радиус считается от карты, а не задан константой", () => {
    const fan = { anchor: { x: 200, y: 400 }, width: 300, angleDeg: 30 };
    expect(layoutCollapseButton(200, fan, 140).r).toBeGreaterThan(layoutCollapseButton(200, fan, 60).r);
  });
});

describe("stepReveal", () => {
  it("едет к 1, пока кнопку хотят показать", () => {
    const r = stepReveal(0, true, 0.05, 1);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it("гаснет к нулю, когда кнопка больше не нужна", () => {
    expect(stepReveal(0.3, false, 0.05, 1)).toBeLessThan(0.3);
  });

  it("не перелетает границы 0..1", () => {
    expect(stepReveal(0.9, true, 10, 1)).toBe(1);
    expect(stepReveal(0.1, false, 10, 1)).toBe(0);
  });

  it("на своей цели стоит на месте — цикл может уснуть", () => {
    expect(stepReveal(1, true, 0.05, 1)).toBe(1);
    expect(stepReveal(0, false, 0.05, 1)).toBe(0);
  });

  it("быстрые анимации проявляют кнопку быстрее", () => {
    expect(stepReveal(0, true, 0.02, 3)).toBeGreaterThan(stepReveal(0, true, 0.02, 1));
  });
});

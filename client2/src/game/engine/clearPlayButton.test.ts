import { describe, expect, it } from "vitest";
import { clearPlayButton, hitsClearPlay } from "./clearPlayButton";

const ZONE = { cx: 200, cy: 150, w: 300, h: 200 };

describe("clearPlayButton", () => {
  it("сидит в правом верхнем углу бокса", () => {
    const b = clearPlayButton(ZONE, 86);
    expect(b.cx).toBeGreaterThan(ZONE.cx);
    expect(b.cy).toBeLessThan(ZONE.cy);
  });

  it("целиком внутри бокса — не свисает за края", () => {
    const b = clearPlayButton(ZONE, 86);
    expect(b.cx + b.w / 2).toBeLessThanOrEqual(ZONE.cx + ZONE.w / 2);
    expect(b.cy - b.h / 2).toBeGreaterThanOrEqual(ZONE.cy - ZONE.h / 2);
  });

  // Кнопка меряется картой, а не пикселями: на маленьком столе она обязана ужаться сама.
  it("на мелкой карте кнопка мельче", () => {
    expect(clearPlayButton(ZONE, 40).h).toBeLessThan(clearPlayButton(ZONE, 120).h);
  });

  it("в узком боксе кнопка не съедает его целиком", () => {
    const narrow = { cx: 50, cy: 50, w: 60, h: 80 };
    const b = clearPlayButton(narrow, 120);
    expect(b.w).toBeLessThanOrEqual(narrow.w * 0.6 + 0.001);
  });

  it("палец по кнопке попадает, мимо — нет", () => {
    const b = clearPlayButton(ZONE, 86);
    expect(hitsClearPlay(b, b.cx, b.cy)).toBe(true);
    expect(hitsClearPlay(b, b.cx, b.cy + b.h)).toBe(false);
    expect(hitsClearPlay(b, ZONE.cx, ZONE.cy)).toBe(false);
  });
});

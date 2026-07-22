import { describe, it, expect } from "vitest";
import { stackOffset, stackExtent, lightShadowOffset } from "./deckStack";

const N = 36;

describe("stackOffset", () => {
  it("передняя (верхняя) карта — выше и правее задней", () => {
    const front = stackOffset(N - 1, N);
    const back = stackOffset(0, N);
    expect(front.dx).toBeGreaterThan(back.dx); // правее
    expect(front.dy).toBeLessThan(back.dy); // выше (y растёт вниз)
  });

  it("стопка отцентрована по якорю — середина колоды лежит в нуле", () => {
    const mid = stackOffset((N - 1) / 2, N);
    expect(mid.dx).toBeCloseTo(0, 10);
    expect(mid.dy).toBeCloseTo(0, 10);
    // и края симметричны
    expect(stackOffset(0, N).dx).toBeCloseTo(-stackOffset(N - 1, N).dx, 10);
  });

  it("смещение растёт линейно по номеру карты", () => {
    const step = stackOffset(1, N).dx - stackOffset(0, N).dx;
    expect(stackOffset(11, N).dx - stackOffset(10, N).dx).toBeCloseTo(step, 10);
  });

  it("одна карта лежит ровно в якоре", () => {
    expect(stackOffset(0, 1)).toEqual({ dx: 0, dy: 0 });
  });

  it("даже полная колода 52 карты не расползается шире карты", () => {
    expect(Math.abs(stackOffset(51, 52).dx)).toBeLessThan(40);
    expect(Math.abs(stackOffset(51, 52).dy)).toBeLessThan(40);
  });
});

describe("stackExtent", () => {
  it("габарит блока растёт с числом карт — толщина колоды видна", () => {
    expect(stackExtent(52).w).toBeGreaterThan(stackExtent(36).w);
    expect(stackExtent(52).h).toBeGreaterThan(stackExtent(36).h);
  });

  it("колода из одной карты (и пустая) толщины не имеет", () => {
    expect(stackExtent(1)).toEqual({ w: 0, h: 0 });
    expect(stackExtent(0)).toEqual({ w: 0, h: 0 });
  });

  it("габарит совпадает с разбросом крайних карт", () => {
    const first = stackOffset(0, 36);
    const last = stackOffset(35, 36);
    expect(stackExtent(36).w).toBeCloseTo(Math.abs(last.dx - first.dx), 10);
    expect(stackExtent(36).h).toBeCloseTo(Math.abs(last.dy - first.dy), 10);
  });
});

describe("lightShadowOffset", () => {
  const H = 128;

  it("свет сверху справа → тень падает вниз-влево", () => {
    const o = lightShadowOffset(H, 0);
    expect(o.dx).toBeLessThan(0);
    expect(o.dy).toBeGreaterThan(0);
  });

  it("тень уезжает дальше, когда карта поднята", () => {
    const flat = lightShadowOffset(H, 0);
    const lifted = lightShadowOffset(H, 0.18);
    expect(Math.abs(lifted.dx)).toBeGreaterThan(Math.abs(flat.dx));
    expect(lifted.dy).toBeGreaterThan(flat.dy);
  });

  it("масштабируется от размера карты", () => {
    expect(lightShadowOffset(H * 2, 0).dy).toBeCloseTo(lightShadowOffset(H, 0).dy * 2, 10);
  });

  it("тень уходит В СТОРОНУ ЗАДНЕЙ карты — свет один и тот же", () => {
    const shadow = lightShadowOffset(H, 0);
    const back = stackOffset(0, N); // задняя карта: ниже и левее
    expect(Math.sign(shadow.dx)).toBe(Math.sign(back.dx));
    expect(Math.sign(shadow.dy)).toBe(Math.sign(back.dy));
  });
});

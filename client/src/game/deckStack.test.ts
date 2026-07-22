import { describe, it, expect } from "vitest";
import { stackOffset, lightShadowOffset } from "./deckStack";
import { anim } from "./anim/config";

describe("stackOffset", () => {
  it("нижняя карта стопки лежит ровно в якоре", () => {
    expect(stackOffset(0)).toEqual({ dx: 0, dy: 0 });
  });

  it("стопка уходит ВНИЗ и ВЛЕВО, а не строго вниз", () => {
    const top = stackOffset(20);
    expect(top.dx).toBeLessThan(0); // влево
    expect(top.dy).toBeGreaterThan(0); // вниз
  });

  it("смещение растёт линейно по номеру карты", () => {
    expect(stackOffset(10).dx).toBeCloseTo(stackOffset(5).dx * 2, 10);
    expect(stackOffset(10).dy).toBeCloseTo(stackOffset(5).dy * 2, 10);
  });

  it("даже полная колода 52 карты не расползается шире карты", () => {
    const top = stackOffset(51);
    expect(Math.abs(top.dx)).toBeLessThan(40);
    expect(top.dy).toBeLessThan(40);
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

  it("направление совпадает с направлением стопки — свет один и тот же", () => {
    const shadow = lightShadowOffset(H, 0);
    const stack = stackOffset(10);
    expect(Math.sign(shadow.dx)).toBe(Math.sign(stack.dx));
    expect(Math.sign(shadow.dy)).toBe(Math.sign(stack.dy));
    expect(anim.deck.stackDx).toBeLessThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { CardBody } from "./CardBody";

function settle(body: CardBody, steps = 400, dt = 1 / 60) {
  for (let i = 0; i < steps; i++) body.step(dt);
}

describe("CardBody", () => {
  it("после setTarget и множества шагов приходит близко к цели по всем каналам", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    b.setTarget({ x: 200, y: -120, rot: 0.2, scale: 1.3 });
    settle(b);
    expect(b.px).toBeCloseTo(200, 0);
    expect(b.py).toBeCloseTo(-120, 0);
    expect(b.scaleVal).toBeCloseTo(1.3, 1);
    // осев, наклон от скорости исчезает → визуальный угол = целевой
    expect(b.rotation).toBeCloseTo(0.2, 1);
  });

  it("snapTo ставит и текущее, и целевое мгновенно", () => {
    const b = new CardBody();
    b.snapTo({ x: 50, y: 60 });
    expect(b.px).toBe(50);
    expect(b.py).toBe(60);
  });

  it("наклоняется в сторону движения (инерция): вправо → положительный крен", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    b.setTarget({ x: 1000 });
    b.step(1 / 60); // один шаг — большая горизонтальная скорость
    expect(b.rotation).toBeGreaterThan(0.05);
  });

  it("влево → отрицательный крен", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    b.setTarget({ x: -1000 });
    b.step(1 / 60);
    expect(b.rotation).toBeLessThan(-0.05);
  });

  it("крен ограничен максимумом из конфига", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    b.setTarget({ x: 1e9 });
    b.step(1 / 60);
    expect(b.rotation).toBeLessThanOrEqual(0.31); // anim.tilt.max = 0.3 + запас
  });

  it("isResting: true в покое, false пока летит к цели", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    expect(b.isResting()).toBe(true);
    b.setTarget({ x: 300 });
    b.step(1 / 60);
    expect(b.isResting()).toBe(false); // в полёте
    settle(b);
    expect(b.isResting()).toBe(true); // осела
  });

  it("tiltScale=0 отключает инерционный крен (умеренный/выкл режим)", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    b.tiltScale = 0;
    b.setTarget({ x: 1000 });
    b.step(1 / 60); // большая горизонтальная скорость, но крена быть не должно
    expect(b.rotation).toBeCloseTo(0, 5);
  });

  it("snap-режим шага телепортирует в цель без крена", () => {
    const b = new CardBody();
    b.snapTo({ x: 0, y: 0, rot: 0, scale: 1 });
    b.setTarget({ x: 500, rot: 0.1 });
    b.step(1 / 60, true);
    expect(b.px).toBe(500);
    expect(b.rotation).toBeCloseTo(0.1, 5); // без наклона от скорости
  });
});

import { describe, expect, it } from "vitest";
import {
  DISCARD_HEAP_MAX,
  discardHeapExtent,
  discardHeapPose,
  discardHeapVisible,
} from "./discardHeap";

const poses = Array.from({ length: DISCARD_HEAP_MAX }, (_, d) => discardHeapPose(d));

describe("узор кучки сброса", () => {
  it("верхняя карта ложится в середину горки — её туда только что бросили", () => {
    expect(discardHeapPose(0)).toMatchObject({ dx: 0, dy: 0 });
  });

  it("все семь поз разные — иначе карты слиплись бы в одну", () => {
    const seen = new Set(poses.map((p) => `${p.dx}|${p.dy}|${p.deg}`));
    expect(seen.size).toBe(DISCARD_HEAP_MAX);
  });

  // Горку делает поворот, а не разъезд: смещения тут маленькие по необходимости.
  it("каждая карта лежит под своим углом, и ни одна не встала ровно", () => {
    for (const p of poses) expect(Math.abs(p.deg)).toBeGreaterThan(0);
  });

  it("углы валятся в обе стороны — кучка, а не расчёска", () => {
    expect(poses.some((p) => p.deg > 0)).toBe(true);
    expect(poses.some((p) => p.deg < 0)).toBe(true);
  });

  // Слот сброса шире карты на четверть (SLOT_PAD): не влезем — свесимся за бокс.
  it("кучка умещается в слот: не шире и не выше 1.25 карты", () => {
    const e = discardHeapExtent();
    expect(1 + e.w).toBeLessThanOrEqual(1.25);
    expect(1 + e.h).toBeLessThanOrEqual(1.25);
  });

  it("карты разбросаны вокруг центра, а не в одну сторону", () => {
    expect(poses.some((p) => p.dx > 0)).toBe(true);
    expect(poses.some((p) => p.dx < 0)).toBe(true);
    expect(poses.some((p) => p.dy > 0)).toBe(true);
    expect(poses.some((p) => p.dy < 0)).toBe(true);
  });

  it("на виду только семь верхних, остальные считаются лежащими под ними", () => {
    expect(discardHeapVisible(0)).toBe(true);
    expect(discardHeapVisible(DISCARD_HEAP_MAX - 1)).toBe(true);
    expect(discardHeapVisible(DISCARD_HEAP_MAX)).toBe(false);
    expect(discardHeapVisible(50)).toBe(false);
  });

  // Невидимые держим в центре кучки: всплывшая карта не должна прилетать со стороны.
  it("карты глубже видимых лежат там же, где последняя видимая", () => {
    expect(discardHeapPose(DISCARD_HEAP_MAX)).toEqual(discardHeapPose(DISCARD_HEAP_MAX - 1));
    expect(discardHeapPose(99)).toEqual(discardHeapPose(DISCARD_HEAP_MAX - 1));
  });

  it("габарит кучки постоянный — счётчик под слотом не ползёт с числом карт", () => {
    expect(discardHeapExtent()).toEqual(discardHeapExtent());
    expect(discardHeapExtent().w).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { rowOffsets, rowWidth, rowStep } from "./handRow";

const CARD_W = 60;
const MAX = 600;

describe("rowOffsets", () => {
  it("шаг равномерный по всему ряду — без дыр и без отступов у краёв", () => {
    const o = rowOffsets(8, CARD_W, MAX);
    expect(o[0]).toBe(0);
    const step = o[1] - o[0];
    for (let i = 1; i < o.length; i++) expect(o[i] - o[i - 1]).toBeCloseTo(step, 6);
  });

  it("карты идут внахлёст: шаг заметно меньше ширины карты", () => {
    // Именно нахлёст и прячет номиналы: видна полоска шириной в шаг, а не вся карта.
    expect(rowStep(6, CARD_W, MAX)).toBeLessThan(CARD_W * 0.5);
    expect(rowStep(6, CARD_W, MAX)).toBeGreaterThan(0);
  });

  it("много карт — ряд сжимается, но каждая карта остаётся видна торцом", () => {
    const o = rowOffsets(36, CARD_W, MAX);
    expect(o.length).toBe(36);
    for (let i = 1; i < o.length; i++) expect(o[i] - o[i - 1]).toBeGreaterThan(0);
    expect(rowWidth(36, CARD_W, MAX)).toBeLessThanOrEqual(MAX + 1);
  });

  it("смещения строго возрастают — карты не наезжают задом наперёд", () => {
    const o = rowOffsets(12, CARD_W, MAX);
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1]);
  });

  it("одна карта и пустая рука", () => {
    expect(rowOffsets(1, CARD_W, MAX)).toEqual([0]);
    expect(rowOffsets(0, CARD_W, MAX)).toEqual([]);
    expect(rowWidth(0, CARD_W, MAX)).toBe(0);
    expect(rowWidth(1, CARD_W, MAX)).toBe(CARD_W);
  });

  it("узкая зона не ломает раскладку — шаг упирается в минимум", () => {
    const o = rowOffsets(20, CARD_W, CARD_W * 1.5);
    for (let i = 1; i < o.length; i++) expect(o[i] - o[i - 1]).toBeGreaterThanOrEqual(2 - 1e-9);
  });
});

describe("rowWidth", () => {
  it("ширина ряда — от левого края первой карты до правого края последней", () => {
    const o = rowOffsets(5, CARD_W, MAX);
    expect(rowWidth(5, CARD_W, MAX)).toBeCloseTo(o[4] + CARD_W, 6);
  });

  it("растёт с числом карт", () => {
    expect(rowWidth(10, CARD_W, MAX)).toBeGreaterThan(rowWidth(3, CARD_W, MAX));
  });
});

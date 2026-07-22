import { describe, expect, it } from "vitest";
import { randomPermutation, scrambleRot, SCRAMBLE_ROT } from "./scramble";

describe("randomPermutation", () => {
  it("это именно перестановка: тот же набор индексов", () => {
    const perm = randomPermutation(8);
    expect([...perm].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("с детерминированным rnd результат воспроизводится", () => {
    const rnd = () => 0; // всегда берём нулевой элемент
    expect(randomPermutation(4, rnd)).toEqual(randomPermutation(4, rnd));
  });

  it("действительно перемешивает (не отдаёт исходный порядок)", () => {
    // rnd=0 → каждый шаг меняет текущий элемент с нулевым: порядок гарантированно уедет.
    expect(randomPermutation(6, () => 0)).not.toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("вырожденные размеры не ломают", () => {
    expect(randomPermutation(0)).toEqual([]);
    expect(randomPermutation(1)).toEqual([0]);
    expect(randomPermutation(-3)).toEqual([]);
  });
});

describe("scrambleRot", () => {
  it("укладывается в ±SCRAMBLE_ROT", () => {
    expect(scrambleRot(() => 0)).toBeCloseTo(-SCRAMBLE_ROT);
    expect(scrambleRot(() => 1)).toBeCloseTo(SCRAMBLE_ROT);
    expect(scrambleRot(() => 0.5)).toBeCloseTo(0);
  });
});

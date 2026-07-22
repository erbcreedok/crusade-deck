import { describe, it, expect } from "vitest";
import { dealOrder, autoDealPlan, AUTO_DEAL_INTERVAL_MS } from "./dealing";

const SEATS = ["a", "b", "dealer", "c"];

describe("dealOrder", () => {
  it("начинает с соседа дилера, дилер последний", () => {
    expect(dealOrder(SEATS, "dealer")).toEqual(["c", "a", "b", "dealer"]);
  });

  it("один игрок — он и есть весь порядок", () => {
    expect(dealOrder(["dealer"], "dealer")).toEqual(["dealer"]);
  });
});

describe("autoDealPlan", () => {
  it("по две карты игроку, потом следующему", () => {
    const order = dealOrder(SEATS, "dealer"); // c, a, b, dealer
    expect(autoDealPlan(order, 8)).toEqual(["c", "c", "a", "a", "b", "b", "dealer", "dealer"]);
  });

  it("крутит круг, пока не кончатся карты; нечётный остаток — одна", () => {
    const order = ["x", "y"];
    expect(autoDealPlan(order, 5)).toEqual(["x", "x", "y", "y", "x"]);
    expect(autoDealPlan(order, 36)).toHaveLength(36);
    expect(autoDealPlan(order, 36).slice(0, 4)).toEqual(["x", "x", "y", "y"]);
  });

  it("пустой порядок / ноль карт — пустой план", () => {
    expect(autoDealPlan([], 10)).toEqual([]);
    expect(autoDealPlan(["a"], 0)).toEqual([]);
  });
});


describe("AUTO_DEAL_INTERVAL_MS", () => {
  it("2 карты в секунду", () => {
    expect(AUTO_DEAL_INTERVAL_MS).toBe(500);
  });
});

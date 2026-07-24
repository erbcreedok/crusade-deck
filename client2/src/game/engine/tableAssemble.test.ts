import { describe, expect, it } from "vitest";
import { assembleTable } from "./tableAssemble";

describe("assembleTable", () => {
  it("разводит четыре бокса по (box, within)", () => {
    const slots = assembleTable(["A♠", "K♥"], ["Q♦"], ["J♣"], []);
    expect(slots).toEqual([
      { card: "A♠", box: "deck", within: 0 },
      { card: "K♥", box: "deck", within: 1 },
      { card: "Q♦", box: "hand", within: 0 },
      { card: "J♣", box: "discard", within: 0 },
    ]);
  });

  it("зона разворачивается в кучки play:N, within — снизу вверх", () => {
    const slots = assembleTable([], [], [], [
      ["6♠", "7♠"],
      ["10♦"],
    ]);
    expect(slots).toEqual([
      { card: "6♠", box: "play:0", within: 0 },
      { card: "7♠", box: "play:0", within: 1 },
      { card: "10♦", box: "play:1", within: 0 },
    ]);
  });

  it("каждая карта попадает в список ровно один раз", () => {
    const slots = assembleTable(["A♠"], ["K♥"], ["Q♦"], [["J♣"]]);
    expect(slots.map((s) => s.card).sort()).toEqual(["A♠", "J♣", "K♥", "Q♦"]);
  });

  it("пустой стол — пустой список", () => {
    expect(assembleTable([], [], [], [])).toEqual([]);
  });
});

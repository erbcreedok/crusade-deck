import { describe, it, expect } from "vitest";
import { flipWholeDeck, flippedFacing } from "./deckFacing.js";

const deck = ["A♠", "2♠", "3♠"];
const allDown = { "A♠": false, "2♠": false, "3♠": false };

describe("flipWholeDeck", () => {
  it("переворот стопки: порядок реверсится, КАЖДАЯ карта меняет сторону", () => {
    const out = flipWholeDeck(deck, allDown);
    expect(out.order).toEqual(["3♠", "2♠", "A♠"]);
    expect(out.facing).toEqual({ "A♠": true, "2♠": true, "3♠": true });
  });

  it("рубашками вниз → после переворота колода лежит лицом вверх", () => {
    expect(flipWholeDeck(deck, allDown).facing["3♠"]).toBe(true);
  });

  it("у карт бывает СВОЁ направление — переворот меняет каждое, а не выравнивает", () => {
    const mixed = { "A♠": true, "2♠": false, "3♠": true };
    expect(flipWholeDeck(deck, mixed).facing).toEqual({ "A♠": false, "2♠": true, "3♠": false });
  });

  it("двойной переворот возвращает колоду в исходное состояние", () => {
    const once = flipWholeDeck(deck, allDown);
    const twice = flipWholeDeck(once.order, once.facing);
    expect(twice.order).toEqual(deck);
    expect(twice.facing).toEqual(allDown);
  });

  it("неизвестные карты считаются рубашкой вверх, пустая колода безопасна", () => {
    expect(flipWholeDeck(deck, {}).facing).toEqual({ "A♠": true, "2♠": true, "3♠": true });
    expect(flipWholeDeck([], {})).toEqual({ order: [], facing: {} });
  });
});

describe("flippedFacing", () => {
  it("переворачивает только указанные карты", () => {
    expect(flippedFacing(allDown, ["2♠"])).toEqual({ "A♠": false, "2♠": true, "3♠": false });
  });

  it("порядок карт не трогается — это переворот на месте", () => {
    const out = flippedFacing(allDown, ["A♠", "3♠"]);
    expect(Object.keys(out).sort()).toEqual(["2♠", "3♠", "A♠"]);
  });

  it("повтор в списке не отменяет сам себя", () => {
    expect(flippedFacing(allDown, ["2♠", "2♠"])["2♠"]).toBe(true);
  });

  it("неизвестные карты игнорируются", () => {
    expect(flippedFacing(allDown, ["K♦"])).toEqual(allDown);
  });
});

import { describe, expect, it } from "vitest";
import { resolveMove, type Piles } from "./moveRules.js";

const base = (): Piles => ({
  deck: ["6♠", "7♠", "8♠"],
  discard: ["A♥"],
  play: [["K♣", "Q♣"], ["J♦"]],
  hand: ["2♣", "3♣"],
});

describe("resolveMove", () => {
  it("колода → сброс: карта уходит из колоды, ложится лицом", () => {
    const r = resolveMove(base(), { card: "8♠", from: "deck", to: "discard" })!;
    expect(r.piles.deck).toEqual(["6♠", "7♠"]);
    expect(r.piles.discard).toEqual(["A♥", "8♠"]);
    expect(r.faceUp).toBe(true);
  });

  it("колода → игральная зона новой кучкой", () => {
    const r = resolveMove(base(), { card: "6♠", from: "deck", to: "play" })!;
    expect(r.piles.deck).toEqual(["7♠", "8♠"]);
    expect(r.piles.play).toEqual([["K♣", "Q♣"], ["J♦"], ["6♠"]]);
  });

  it("колода → зона в конкретную кучку", () => {
    const r = resolveMove(base(), { card: "6♠", from: "deck", to: "play", toStack: 0 })!;
    expect(r.piles.play[0]).toEqual(["K♣", "Q♣", "6♠"]);
  });

  it("колода → своя рука прячет карту (не лицом)", () => {
    const r = resolveMove(base(), { card: "7♠", from: "deck", to: "hand" })!;
    expect(r.piles.hand).toEqual(["2♣", "3♣", "7♠"]);
    expect(r.faceUp).toBe(false);
  });

  it("зона → сброс: карта из кучки уходит в сброс", () => {
    const r = resolveMove(base(), { card: "Q♣", from: "play", to: "discard" })!;
    expect(r.piles.play).toEqual([["K♣"], ["J♦"]]);
    expect(r.piles.discard).toEqual(["A♥", "Q♣"]);
  });

  it("зона → зона: карта переезжает из кучки в кучку", () => {
    const r = resolveMove(base(), { card: "J♦", from: "play", to: "play", toStack: 0 })!;
    // Кучка [J♦] опустела и исчезла ДО вставки — адресат 0 указывает на [K♣,Q♣].
    expect(r.piles.play).toEqual([["K♣", "Q♣", "J♦"]]);
  });

  it("сброс → рука: карту подняли себе", () => {
    const r = resolveMove(base(), { card: "A♥", from: "discard", to: "hand" })!;
    expect(r.piles.discard).toEqual([]);
    expect(r.piles.hand).toContain("A♥");
  });

  it("рука → сброс", () => {
    const r = resolveMove(base(), { card: "2♣", from: "hand", to: "discard" })!;
    expect(r.piles.hand).toEqual(["3♣"]);
    expect(r.piles.discard).toEqual(["A♥", "2♣"]);
  });

  it("карты нет в источнике — ход невозможен", () => {
    expect(resolveMove(base(), { card: "9♦", from: "deck", to: "discard" })).toBeNull();
    expect(resolveMove(base(), { card: "A♥", from: "hand", to: "discard" })).toBeNull();
  });

  it("устаревший индекс кучки — карта ложится новой, а не пропадает", () => {
    const r = resolveMove(base(), { card: "6♠", from: "deck", to: "play", toStack: 9 })!;
    expect(r.piles.play.at(-1)).toEqual(["6♠"]);
  });

  it("не мутирует переданные боксы", () => {
    const p = base();
    resolveMove(p, { card: "8♠", from: "deck", to: "discard" });
    expect(p.deck).toEqual(["6♠", "7♠", "8♠"]);
    expect(p.discard).toEqual(["A♥"]);
  });
});

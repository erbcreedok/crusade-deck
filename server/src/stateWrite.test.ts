import { describe, expect, it } from "vitest";
import { GameState, Player } from "./GameState.js";
import {
  clearAllHands,
  facingRecord,
  handsSnapshot,
  writeDeck,
  writeFacing,
  writeFreshDeck,
  writeHand,
} from "./stateWrite.js";

function stateWith(deck: string[], players: Record<string, string[]> = {}): GameState {
  const state = new GameState();
  writeDeck(state, deck);
  deck.forEach((c) => state.faceUp.set(c, false));
  for (const [sid, hand] of Object.entries(players)) {
    const p = new Player();
    writeHand(p, hand);
    p.handOpen = true;
    p.handFanned = true;
    p.handHidden.set(hand[0] ?? "x", true);
    state.players.set(sid, p);
  }
  return state;
}

describe("writeDeck", () => {
  it("переписывает колоду целиком", () => {
    const state = stateWith(["A♠", "K♥", "Q♦"]);
    writeDeck(state, ["Q♦", "A♠"]);
    expect(state.deck.toArray()).toEqual(["Q♦", "A♠"]);
  });

  it("укорачивание колоды не оставляет хвоста", () => {
    const state = stateWith(["A♠", "K♥", "Q♦"]);
    writeDeck(state, ["A♠"]);
    expect(state.deck.length).toBe(1);
  });

  it("пустой порядок опустошает колоду", () => {
    const state = stateWith(["A♠"]);
    writeDeck(state, []);
    expect(state.deck.toArray()).toEqual([]);
  });

  it("setAt за пределы длины ДОПИСАЛ БЫ элемент — ради этого и нужна запись через clear+push", () => {
    // Тот самый капкан, из-за которого колода дважды раздувалась до 60 карт.
    const state = stateWith(["A♠", "K♥", "Q♦"]);
    state.deck.setAt(5, "лишняя");
    expect(state.deck.length).toBe(4); // не 3 и не 6 — молча дописал
    // А writeDeck возвращает колоду ровно к переданному порядку.
    writeDeck(state, ["A♠", "K♥", "Q♦"]);
    expect(state.deck.toArray()).toEqual(["A♠", "K♥", "Q♦"]);
  });
});

describe("writeHand", () => {
  it("переписывает руку игрока целиком", () => {
    const p = new Player();
    writeHand(p, ["A♠", "K♥"]);
    writeHand(p, ["K♥"]);
    expect(p.hand.toArray()).toEqual(["K♥"]);
  });
});

describe("facingRecord / writeFacing", () => {
  it("читает стороны карт в обычный объект", () => {
    const state = stateWith(["A♠", "K♥"]);
    state.faceUp.set("A♠", true);
    expect(facingRecord(state)).toEqual({ "A♠": true, "K♥": false });
  });

  it("применяет только переданные карты, остальные не трогает", () => {
    const state = stateWith(["A♠", "K♥"]);
    writeFacing(state, { "A♠": true });
    expect(facingRecord(state)).toEqual({ "A♠": true, "K♥": false });
  });
});

describe("writeFreshDeck", () => {
  it("новая колода ложится рубашкой вверх, старые стороны исчезают", () => {
    const state = stateWith(["A♠"]);
    state.faceUp.set("A♠", true);
    writeFreshDeck(state, ["2♣", "3♣"]);
    expect(state.deck.toArray()).toEqual(["2♣", "3♣"]);
    expect(facingRecord(state)).toEqual({ "2♣": false, "3♣": false });
  });
});

describe("handsSnapshot", () => {
  it("снимает руки и их размеры до опустошения", () => {
    const state = stateWith(["A♠"], { a: ["K♥", "Q♦"], b: [] });
    expect(handsSnapshot(state)).toEqual({
      hands: { a: ["K♥", "Q♦"], b: [] },
      counts: { a: 2, b: 0 },
    });
  });
});

describe("clearAllHands", () => {
  it("убирает карты, спрятанные карты и режимы показа", () => {
    const state = stateWith(["A♠"], { a: ["K♥"] });
    clearAllHands(state);
    const p = state.players.get("a")!;
    expect(p.hand.toArray()).toEqual([]);
    expect(p.handHidden.size).toBe(0);
    expect(p.handOpen).toBe(false);
    expect(p.handFanned).toBe(false);
  });
});

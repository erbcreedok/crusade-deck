import { describe, it, expect } from "vitest";
import { barActionsFor } from "./barActions";
import { EMPTY_SELECTION, toggleSelection } from "./selection";

const deckSelected = toggleSelection(EMPTY_SELECTION, "deck", "deck");
const twoDecks = toggleSelection(deckSelected, "deck", "deck2");

describe("barActionsFor — кнопки под выделенное", () => {
  it("ничего не выделено — кнопок нет", () => {
    const a = barActionsFor(EMPTY_SELECTION, { deckZone: "center", canMoveDeck: true });
    expect(a.main).toBeNull();
    expect(a.secondary).toBeNull();
  });

  it("колода в центре: A — в руку", () => {
    const a = barActionsFor(deckSelected, { deckZone: "center", canMoveDeck: true });
    expect(a.main?.id).toBe("deck_to_hand");
    expect(a.secondary).toBeNull();
  });

  it("колода в руке: Б — вернуть в центр", () => {
    const a = barActionsFor(deckSelected, { deckZone: "hand", canMoveDeck: true });
    expect(a.secondary?.id).toBe("deck_to_center");
  });

  it("у действий есть человеческие подписи", () => {
    const a = barActionsFor(deckSelected, { deckZone: "center", canMoveDeck: true });
    expect(a.main?.label.trim()).not.toBe("");
  });

  it("колоду двигать нельзя (не дилер / не лобби) — действий нет", () => {
    const a = barActionsFor(deckSelected, { deckZone: "center", canMoveDeck: false });
    expect(a.main).toBeNull();
    expect(a.secondary).toBeNull();
  });

  it("выделено несколько колод — эти действия пока не про них", () => {
    const a = barActionsFor(twoDecks, { deckZone: "center", canMoveDeck: true });
    expect(a.main).toBeNull();
    expect(a.secondary).toBeNull();
  });

  it("выделены не колоды — действий колоды нет", () => {
    const cards = toggleSelection(EMPTY_SELECTION, "card", "10♠");
    const a = barActionsFor(cards, { deckZone: "center", canMoveDeck: true });
    expect(a.main).toBeNull();
  });

  it("колода у чужого места — действий пока нет (не описаны)", () => {
    for (const zone of ["seat", "away"] as const) {
      const a = barActionsFor(deckSelected, { deckZone: zone, canMoveDeck: true });
      expect(a.main).toBeNull();
      expect(a.secondary).toBeNull();
    }
  });
});

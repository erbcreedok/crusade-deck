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

describe("barActionsFor — режим раздачи", () => {
  const deal = {
    deckZone: "center" as const,
    canMoveDeck: false,
    dealMode: true,
  };

  it("дилер: Перемешать + ГОУ!", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...deal, amIDealer: true });
    expect(a.main?.id).toBe("shuffle");
    expect(a.secondary?.id).toBe("go");
    expect(a.secondary?.label).toContain("ГОУ");
  });

  it("автораздача с панели ушла — она живёт в меню", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...deal, amIDealer: true, autoDealing: true });
    expect(a.secondary?.id).toBe("go");
  });

  it("игрок: Готов / Ждите…", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...deal, amIDealer: false, myReady: false });
    expect(a.main?.id).toBe("ready");
    expect(a.secondary?.id).toBe("wait");
  });

  it("игрок готовый: Не готов", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...deal, amIDealer: false, myReady: true });
    expect(a.main?.id).toBe("unready");
  });
});

describe("barActionsFor — режим свободы", () => {
  const free = {
    deckZone: "center" as const,
    canMoveDeck: false,
    dealMode: true,
    freeMode: true,
  };

  it("дилер: главное действие — Перераздача", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.main?.id).toBe("redeal");
    expect(a.main?.label).toContain("Перераздача");
  });

  it("свобода важнее раздачи: «ГОУ!» и «Перемешать» уступают место Перераздаче", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: true });
    expect(a.secondary?.id).not.toBe("go");
    expect(a.main?.id).not.toBe("shuffle");
  });

  it("остальным в свободе кнопок нет — карты берут жестом со стола", () => {
    const a = barActionsFor(EMPTY_SELECTION, { ...free, amIDealer: false });
    expect(a.main).toBeNull();
    expect(a.secondary).toBeNull();
  });
});

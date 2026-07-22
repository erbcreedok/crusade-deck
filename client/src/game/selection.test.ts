import { describe, it, expect } from "vitest";
import { EMPTY_SELECTION, toggleSelection, isSelected, clearSelection, selectionSize } from "./selection";

describe("выделение элементов стола", () => {
  it("пустое выделение — ни типа, ни элементов", () => {
    expect(EMPTY_SELECTION.type).toBeNull();
    expect(selectionSize(EMPTY_SELECTION)).toBe(0);
  });

  it("тап по элементу выделяет его", () => {
    const s = toggleSelection(EMPTY_SELECTION, "deck", "d1");
    expect(s.type).toBe("deck");
    expect(isSelected(s, "deck", "d1")).toBe(true);
  });

  it("повторный тап по тому же элементу снимает выделение", () => {
    const s = toggleSelection(toggleSelection(EMPTY_SELECTION, "deck", "d1"), "deck", "d1");
    expect(isSelected(s, "deck", "d1")).toBe(false);
    expect(selectionSize(s)).toBe(0);
  });

  it("сняв последний элемент, теряем и тип — выделения больше нет", () => {
    const s = toggleSelection(toggleSelection(EMPTY_SELECTION, "deck", "d1"), "deck", "d1");
    expect(s.type).toBeNull();
  });

  it("элементы ОДНОГО типа копятся: несколько колод выделяются вместе", () => {
    let s = toggleSelection(EMPTY_SELECTION, "deck", "d1");
    s = toggleSelection(s, "deck", "d2");
    expect(selectionSize(s)).toBe(2);
    expect(isSelected(s, "deck", "d1")).toBe(true);
    expect(isSelected(s, "deck", "d2")).toBe(true);
  });

  it("карты из разных колод выделяются вместе — важен тип, а не происхождение", () => {
    let s = toggleSelection(EMPTY_SELECTION, "card", "d1:10♠");
    s = toggleSelection(s, "card", "d2:A♥");
    expect(selectionSize(s)).toBe(2);
    expect(s.type).toBe("card");
  });

  it("элемент ДРУГОГО типа сбрасывает весь прежний выбор", () => {
    let s = toggleSelection(EMPTY_SELECTION, "card", "10♠");
    s = toggleSelection(s, "card", "A♥");
    s = toggleSelection(s, "deck", "d1");
    expect(s.type).toBe("deck");
    expect(selectionSize(s)).toBe(1);
    expect(isSelected(s, "card", "10♠")).toBe(false);
  });

  it("это работает в любую сторону: колода сбрасывает выбор карт и наоборот", () => {
    const decks = toggleSelection(toggleSelection(EMPTY_SELECTION, "deck", "d1"), "deck", "d2");
    const cards = toggleSelection(decks, "card", "10♠");
    expect(cards.type).toBe("card");
    expect(selectionSize(cards)).toBe(1);

    const player = toggleSelection(cards, "player", "p1");
    expect(player.type).toBe("player");
    expect(selectionSize(player)).toBe(1);
  });

  it("clearSelection сбрасывает всё", () => {
    const s = clearSelection();
    expect(s.type).toBeNull();
    expect(selectionSize(s)).toBe(0);
  });

  it("isSelected не путает одинаковые id разных типов", () => {
    const s = toggleSelection(EMPTY_SELECTION, "deck", "x");
    expect(isSelected(s, "deck", "x")).toBe(true);
    expect(isSelected(s, "player", "x")).toBe(false);
  });

  it("выделение неизменяемо — прежний объект не мутируется", () => {
    const a = toggleSelection(EMPTY_SELECTION, "deck", "d1");
    const b = toggleSelection(a, "deck", "d2");
    expect(selectionSize(a)).toBe(1);
    expect(selectionSize(b)).toBe(2);
  });
});

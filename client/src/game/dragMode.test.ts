import { describe, it, expect } from "vitest";
import { dragModeFor } from "./dragMode";

// Колода всегда в центре стола: тащить её целиком некуда, палец берёт только карты.
describe("dragModeFor — что берёт палец", () => {
  it("рука ВНЕ фокуса: шеренга не таскается — сначала раскрой веер", () => {
    expect(dragModeFor({ onHand: true, handFocused: false })).toBe("none");
  });

  it("рука В фокусе: отдельные карты (перестановка)", () => {
    expect(dragModeFor({ onHand: true, handFocused: true })).toBe("card");
  });

  it("колода в центре: дилер тащит верхнюю карту на раздачу", () => {
    expect(dragModeFor({ onHand: false, handFocused: false, canDeal: true })).toBe("topCard");
  });

  it("не-дилер на закрытой колоде — ничего", () => {
    expect(dragModeFor({ onHand: false, handFocused: false, canDeal: false })).toBe("none");
  });

  it("не-дилер на открытом вееере — только peek (глиссандо/ховер)", () => {
    expect(dragModeFor({ onHand: false, handFocused: false, canDeal: false, deckFanned: true })).toBe("peek");
  });

  it("режим свободы: верхнюю карту со стола тащит ЛЮБОЙ игрок", () => {
    expect(dragModeFor({ onHand: false, handFocused: false, canDeal: false, freeMode: true })).toBe("topCard");
  });

  it("режим свободы: открытый веер колоды не мешает тянуть карту", () => {
    expect(
      dragModeFor({ onHand: false, handFocused: false, canDeal: false, deckFanned: true, freeMode: true }),
    ).toBe("topCard");
  });

  it("режим свободы не трогает свою руку: там по-прежнему перестановка карт", () => {
    expect(dragModeFor({ onHand: true, handFocused: true, freeMode: true })).toBe("card");
  });
});

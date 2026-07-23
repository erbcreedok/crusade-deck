import { describe, it, expect } from "vitest";
import { dragModeFor } from "./dragMode";

describe("dragModeFor — что берёт палец на этой зоне", () => {
  it("рука ВНЕ фокуса: тащится вся колода целиком, карты по одной — нет", () => {
    expect(dragModeFor({ zone: "hand", handFocused: false, draggable: true })).toBe("deck");
  });

  it("рука В фокусе: только отдельные карты, колоду из руки не утащить", () => {
    expect(dragModeFor({ zone: "hand", handFocused: true, draggable: true })).toBe("card");
  });

  it("колоды в других местах тащатся целиком независимо от фокуса руки", () => {
    for (const zone of ["center", "seat"] as const) {
      expect(dragModeFor({ zone, handFocused: true, draggable: true })).toBe("deck");
      expect(dragModeFor({ zone, handFocused: false, draggable: true })).toBe("deck");
    }
  });

  it("нельзя двигать (не дилер / не лобби) — не тащится ничего", () => {
    expect(dragModeFor({ zone: "hand", handFocused: true, draggable: false })).toBe("none");
    expect(dragModeFor({ zone: "center", handFocused: false, draggable: false })).toBe("none");
  });

  it("колоды нет на столе (away) — тащить нечего", () => {
    expect(dragModeFor({ zone: "away", handFocused: false, draggable: true })).toBe("none");
  });

  it("режим раздачи в центре: дилер тащит верхнюю карту, не всю колоду", () => {
    expect(
      dragModeFor({ zone: "center", handFocused: false, draggable: false, dealMode: true, canDeal: true }),
    ).toBe("topCard");
  });

  it("режим раздачи: не-дилер на закрытой колоде — ничего", () => {
    expect(
      dragModeFor({ zone: "center", handFocused: false, draggable: false, dealMode: true, canDeal: false }),
    ).toBe("none");
  });

  it("режим раздачи: не-дилер на открытом веере — только peek (глиссандо/ховер)", () => {
    expect(
      dragModeFor({
        zone: "center",
        handFocused: false,
        draggable: false,
        dealMode: true,
        canDeal: false,
        deckFanned: true,
      }),
    ).toBe("peek");
  });

  it("режим свободы: верхнюю карту со стола тащит ЛЮБОЙ игрок, не только дилер", () => {
    expect(
      dragModeFor({
        zone: "center",
        handFocused: false,
        draggable: false,
        dealMode: true,
        canDeal: false,
        freeMode: true,
      }),
    ).toBe("topCard");
  });

  it("режим свободы: открытый веер колоды не мешает тянуть карту", () => {
    expect(
      dragModeFor({
        zone: "center",
        handFocused: false,
        draggable: false,
        dealMode: true,
        canDeal: false,
        deckFanned: true,
        freeMode: true,
      }),
    ).toBe("topCard");
  });

  it("режим свободы не трогает свою руку: там по-прежнему перестановка карт", () => {
    expect(
      dragModeFor({ zone: "hand", handFocused: true, draggable: true, freeMode: true }),
    ).toBe("card");
  });

  it("режим раздачи: даже если draggable, в центре всё равно topCard", () => {
    expect(
      dragModeFor({ zone: "center", handFocused: false, draggable: true, dealMode: true, canDeal: true }),
    ).toBe("topCard");
  });
});

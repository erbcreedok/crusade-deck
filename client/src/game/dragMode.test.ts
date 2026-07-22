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
    for (const zone of ["center", "safe", "seat"] as const) {
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
});

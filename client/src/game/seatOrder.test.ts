import { describe, it, expect } from "vitest";
import { seatsForViewer, seatOnLeft } from "./seatOrder";

// Дилер, боты, второй человек — как после фикса seatOrder на сервере.
const TABLE = ["mac", "bot-1", "bot-2", "bot-3", "phone"];

describe("seatsForViewer", () => {
  it("у дилера слева первый бот, телефон справа в конце дуги", () => {
    expect(seatsForViewer(TABLE, "mac")).toEqual(["bot-1", "bot-2", "bot-3", "phone"]);
  });

  it("у телефона слева дилер — не зеркало «оба справа»", () => {
    expect(seatsForViewer(TABLE, "phone")).toEqual(["mac", "bot-1", "bot-2", "bot-3"]);
    expect(seatOnLeft(TABLE, "phone")).toBe("mac");
    expect(seatOnLeft(TABLE, "mac")).toBe("bot-1");
  });

  it("не ломается если self нет в списке", () => {
    expect(seatsForViewer(TABLE, "ghost")).toEqual(TABLE);
  });
});

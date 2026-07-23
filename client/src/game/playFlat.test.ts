import { describe, expect, it } from "vitest";
import { flattenPlay } from "./playFlat";

describe("flattenPlay", () => {
  it("разворачивает кучки в один порядок: кучка за кучкой, снизу вверх", () => {
    expect(flattenPlay([["7♣", "8♦"], ["9♥"]]).order).toEqual(["7♣", "8♦", "9♥"]);
  });

  it("на каждую карту — её место: какая кучка, какая по счёту, сколько всего в кучке", () => {
    const { slots } = flattenPlay([["7♣", "8♦"], ["9♥"]]);
    expect(slots).toEqual([
      { stack: 0, within: 0, of: 2 },
      { stack: 0, within: 1, of: 2 },
      { stack: 1, within: 0, of: 1 },
    ]);
  });

  it("пустая зона — пустой порядок", () => {
    expect(flattenPlay([])).toEqual({ order: [], slots: [] });
  });

  // Сервер пустых кучек не присылает (см. playRules), но клиент не имеет права падать на
  // том, чего «не бывает»: одно устаревшее состояние — и стол чёрный.
  it("пустая кучка не сдвигает нумерацию остальных", () => {
    const { slots } = flattenPlay([[], ["9♥"]]);
    expect(slots).toEqual([{ stack: 1, within: 0, of: 1 }]);
  });

  it("верх кучки — последняя карта, как у колоды и сброса", () => {
    const { order, slots } = flattenPlay([["7♣", "8♦"]]);
    const topAt = slots.findIndex((s) => s.within === s.of - 1);
    expect(order[topAt]).toBe("8♦");
  });
});

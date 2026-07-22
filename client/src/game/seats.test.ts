import { describe, it, expect } from "vitest";
import { tableSummary, type Seat } from "./seats";

const seat = (over: Partial<Seat> = {}): Seat => ({
  id: "s1",
  name: "Player",
  isBot: false,
  isReady: false,
  isDealer: false,
  connected: true,
  ...over,
});

describe("tableSummary", () => {
  it("считает всех за столом и отдельно — ботов", () => {
    const s = tableSummary([
      seat({ id: "me", isDealer: true }),
      seat({ id: "bot-1", isBot: true, isReady: true }),
      seat({ id: "bot-2", isBot: true, isReady: true }),
    ]);
    expect(s.total).toBe(3);
    expect(s.bots).toBe(2);
    expect(s.ready).toBe(2);
  });

  it("отключённые не считаются сидящими за столом", () => {
    const s = tableSummary([seat({ id: "me" }), seat({ id: "gone", connected: false, isReady: true })]);
    expect(s.total).toBe(1);
    expect(s.ready).toBe(0);
  });

  it("пустой стол — нули, а не падение", () => {
    expect(tableSummary([])).toEqual({ total: 0, ready: 0, bots: 0 });
  });
});

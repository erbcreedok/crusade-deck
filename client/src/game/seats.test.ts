import { describe, it, expect } from "vitest";
import { seatsSignature, tableSummary, type Seat, type SeatView } from "./seats";

const seat = (over: Partial<Seat> = {}): Seat => ({
  id: "s1",
  name: "Player",
  isBot: false,
  isReady: false,
  isDealer: false,
  connected: true,
  handOpen: false,
  handFanned: false,
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

describe("seatsSignature", () => {
  const seat: SeatView = {
    id: "a",
    name: "Аня",
    isBot: false,
    isReady: false,
    isDealer: false,
    connected: true,
    handOpen: false,
    handFanned: false,
    handCount: 2,
    hand: ["A♠", "K♥"],
  };

  it("одинаковый состав — одинаковая подпись (перерисовки не будет)", () => {
    expect(seatsSignature([seat])).toBe(seatsSignature([{ ...seat }]));
  });

  it("ловит всё, от чего зависит картинка места", () => {
    const base = seatsSignature([seat]);
    expect(seatsSignature([{ ...seat, name: "Оля" }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, handCount: 3 }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, isReady: true }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, isDealer: true }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, connected: false }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, handOpen: true }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, handFanned: true }])).not.toBe(base);
    expect(seatsSignature([{ ...seat, hand: ["K♥", "A♠"] }])).not.toBe(base);
  });

  it("порядок мест за столом важен", () => {
    const other = { ...seat, id: "b" };
    expect(seatsSignature([seat, other])).not.toBe(seatsSignature([other, seat]));
  });

  it("пустой стол — пустая подпись", () => {
    expect(seatsSignature([])).toBe("");
  });
});

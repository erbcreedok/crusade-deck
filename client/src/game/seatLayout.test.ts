import { describe, it, expect } from "vitest";
import { layoutSeats, SEAT_MIN_W, SEAT_TIGHT_W } from "./seatLayout";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const W = 900;
const H = 700;

/** Сколько человек влезает в ряд по комфортной ширине. */
const rowCap = (w: number) => Math.floor(w / SEAT_MIN_W);

describe("layoutSeats — пока влезают, «П» вырождается в ряд", () => {
  it("все сидят в верхней полосе, боковых нет", () => {
    const { seats, insets } = layoutSeats(ids(3), W, H);
    expect(seats.map((s) => s.side)).toEqual(["top", "top", "top"]);
    expect(insets.side).toBe(0);
    expect(insets.top).toBeGreaterThan(0);
  });

  it("полный ряд по краю ёмкости всё ещё сидит одним рядом — углы экрана не пустуют", () => {
    const { seats } = layoutSeats(ids(rowCap(W)), W, H);
    expect(seats.every((s) => s.side === "top")).toBe(true);
  });

  it("ряд делится поровну и не вылезает за экран", () => {
    const { seats } = layoutSeats(ids(4), W, H);
    const widths = seats.map((s) => s.rect.w);
    expect(new Set(widths.map((w) => Math.round(w))).size).toBe(1); // одинаковые
    expect(Math.min(...seats.map((s) => s.rect.cx - s.rect.w / 2))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seats.map((s) => s.rect.cx + s.rect.w / 2))).toBeLessThanOrEqual(W);
  });

  it("места идут слева направо в порядке списка", () => {
    const { seats } = layoutSeats(ids(4), W, H);
    const xs = seats.map((s) => s.rect.cx);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(seats.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3"]);
  });
});

describe("layoutSeats — боковые места это СОСЕДИ, и их всегда двое", () => {
  const many = ids(rowCap(W) + 1);

  it("перестало влезать в ряд — по бокам садятся ровно двое", () => {
    const { seats } = layoutSeats(many, W, H);
    expect(seats.filter((s) => s.side === "left")).toHaveLength(1);
    expect(seats.filter((s) => s.side === "right")).toHaveLength(1);
  });

  it("по бокам сидят именно соседи по кругу — первый и последний в списке", () => {
    const { seats } = layoutSeats(many, W, H);
    expect(seats.find((s) => s.side === "left")!.id).toBe(many[0]);
    expect(seats.find((s) => s.side === "right")!.id).toBe(many[many.length - 1]);
  });

  it("сколько бы народу ни набежало, по бокам всё равно двое — остальные в полосу", () => {
    for (const n of [rowCap(W) + 1, 20, 31]) {
      const { seats } = layoutSeats(ids(n), W, H);
      expect(seats.filter((s) => s.side !== "top")).toHaveLength(2);
      expect(seats).toHaveLength(n);
    }
  });

  it("шестеро на экране, где в ряд влезает пятеро: четверо сверху, двое по бокам", () => {
    const w = SEAT_MIN_W * 5 + 10; // ряд держит ровно пятерых
    const { seats } = layoutSeats(ids(6), w, H);
    expect(seats.filter((s) => s.side === "top")).toHaveLength(4);
    expect(seats.filter((s) => s.side !== "top")).toHaveLength(2);
  });

  it("боковые стоят под полосой, слева и справа, и не наезжают на неё", () => {
    const { seats, insets } = layoutSeats(many, W, H);
    const left = seats.find((s) => s.side === "left")!;
    const right = seats.find((s) => s.side === "right")!;
    expect(left.rect.cx).toBeLessThan(W / 2);
    expect(right.rect.cx).toBeGreaterThan(W / 2);
    for (const s of [left, right]) {
      expect(s.rect.cy - s.rect.h / 2).toBeGreaterThanOrEqual(insets.top - 0.001);
    }
    expect(insets.side).toBeGreaterThan(0);
  });

  // Сосед стоит у края одной колонкой со слотом колоды и слотом сброса — ширина у всех
  // троих общая, и задаёт её колода (см. layout.boardSlotWidth).
  it("место соседа берёт ширину, которую дали снаружи", () => {
    const { seats } = layoutSeats(many, W, H, { sideW: 60 });
    for (const s of seats.filter((x) => x.side !== "top")) {
      expect(s.rect.w).toBeCloseTo(60 - 6); // минус зазор между рамками
    }
  });

  it("оба бока одной ширины и прижаты к краям", () => {
    const { seats } = layoutSeats(many, W, H, { sideW: 60 });
    const left = seats.find((s) => s.side === "left")!;
    const right = seats.find((s) => s.side === "right")!;
    expect(left.rect.w).toBe(right.rect.w);
    expect(left.rect.cx).toBeCloseTo(W - right.rect.cx);
  });

  it("абсурдная ширина снаружи не съедает экран целиком", () => {
    const { seats } = layoutSeats(many, W, H, { sideW: 10_000 });
    const side = seats.find((s) => s.side === "left")!;
    expect(side.rect.w).toBeLessThanOrEqual(W / 3);
  });

  it("двоих в бока не сажаем: полоса не должна опустеть", () => {
    const { seats } = layoutSeats(ids(2), SEAT_MIN_W, H); // в ряд влезает один
    expect(seats.every((s) => s.side === "top")).toBe(true);
  });
});

describe("layoutSeats — прокрутка полосы", () => {
  const w = 375;
  const crowd = ids(15); // комната на 16 человек: я и ещё пятнадцать

  it("пока всё влезает — прокрутки нет", () => {
    expect(layoutSeats(ids(4), W, H).topScrollMax).toBe(0);
  });

  it("толпа на телефоне — полоса длиннее экрана, прокрутка появляется", () => {
    const { topScrollMax } = layoutSeats(crowd, w, H);
    expect(topScrollMax).toBeGreaterThan(0);
  });

  it("места не ужимаются мельче тесной ширины — их всё ещё можно прочитать", () => {
    const { seats } = layoutSeats(crowd, w, H);
    const tops = seats.filter((s) => s.side === "top");
    expect(Math.min(...tops.map((s) => s.rect.w))).toBeGreaterThanOrEqual(SEAT_TIGHT_W - 6 - 0.001);
  });

  it("прокрутка двигает полосу и НЕ трогает соседей по бокам", () => {
    const at0 = layoutSeats(crowd, w, H, { scrollX: 0 });
    const at100 = layoutSeats(crowd, w, H, { scrollX: 100 });
    const topX = (l: typeof at0) => l.seats.filter((s) => s.side === "top").map((s) => s.rect.cx);
    const sideBoxes = (l: typeof at0) => l.seats.filter((s) => s.side !== "top").map((s) => s.rect);

    expect(topX(at100)).toEqual(topX(at0).map((x) => x - 100));
    expect(sideBoxes(at100)).toEqual(sideBoxes(at0)); // соседи закреплены
  });

  it("за края списка полоса не уезжает", () => {
    const l = layoutSeats(crowd, w, H, { scrollX: 99_999 });
    const tops = l.seats.filter((s) => s.side === "top");
    // последнее место докручивается ровно до правого края, дальше — стоп
    expect(Math.max(...tops.map((s) => s.rect.cx + s.rect.w / 2))).toBeLessThanOrEqual(w);
    expect(layoutSeats(crowd, w, H, { scrollX: -500 })).toEqual(layoutSeats(crowd, w, H));
  });
});

describe("layoutSeats — края", () => {
  it("много игроков — все получают место, и все на экране", () => {
    const { seats } = layoutSeats(ids(31), W, H); // максимум комнаты минус я
    expect(seats).toHaveLength(31);
    expect(seats.every((s) => s.rect.h > 0 && s.rect.w > 0)).toBe(true);
    expect(Math.max(...seats.map((s) => s.rect.cy + s.rect.h / 2))).toBeLessThanOrEqual(H);
  });

  it("пустой стол — ни мест, ни отступов", () => {
    const { seats, insets, topScrollMax } = layoutSeats([], W, H);
    expect(seats).toEqual([]);
    expect(insets).toEqual({ top: 0, side: 0 });
    expect(topScrollMax).toBe(0);
  });

  it("узкий экран не ломается: место остаётся положительным", () => {
    const { seats } = layoutSeats(ids(5), 320, 560);
    expect(seats).toHaveLength(5);
    expect(seats.every((s) => s.rect.w > 0 && s.rect.h > 0)).toBe(true);
  });
});

// Топбар комнаты (код/приват/сводка/меню) — это HTML поверх канваса. Места обязаны
// начинаться под ним, иначе имена игроков прячутся за бейджами.
describe("layoutSeats — отступ под топбар", () => {
  it("верхняя полоса опускается ниже отступа", () => {
    const { seats, insets } = layoutSeats(ids(3), W, H, { topOffset: 60 });
    expect(Math.min(...seats.map((s) => s.rect.cy - s.rect.h / 2))).toBeGreaterThanOrEqual(60);
    expect(insets.top).toBeGreaterThan(60);
  });

  it("боковые соседи тоже начинаются под отступом", () => {
    const { seats } = layoutSeats(ids(rowCap(W) + 4), W, H, { topOffset: 60 });
    const sides = seats.filter((s) => s.side !== "top");
    expect(Math.min(...sides.map((s) => s.rect.cy - s.rect.h / 2))).toBeGreaterThanOrEqual(60);
  });

  it("без отступа поведение прежнее", () => {
    expect(layoutSeats(ids(4), W, H)).toEqual(layoutSeats(ids(4), W, H, { topOffset: 0 }));
  });

  it("абсурдный отступ не съедает места целиком", () => {
    const { seats } = layoutSeats(ids(4), W, H, { topOffset: H });
    expect(seats.every((s) => s.rect.h > 0 && s.rect.cy + s.rect.h / 2 <= H)).toBe(true);
  });
});

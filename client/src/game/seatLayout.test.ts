import { describe, it, expect } from "vitest";
import { layoutSeats, SEAT_MIN_W } from "./seatLayout";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const W = 900;
const H = 700;

describe("layoutSeats — посадка буквой «П»", () => {
  it("пока влезают — все сидят в верхней полосе", () => {
    const { seats, insets } = layoutSeats(ids(3), W, H);
    expect(seats.map((s) => s.side)).toEqual(["top", "top", "top"]);
    expect(insets.left).toBe(0);
    expect(insets.right).toBe(0);
    expect(insets.top).toBeGreaterThan(0);
  });

  it("верхняя полоса делится поровну и не вылезает за экран", () => {
    const { seats } = layoutSeats(ids(4), W, H);
    const widths = seats.map((s) => s.rect.w);
    expect(new Set(widths.map((w) => Math.round(w))).size).toBe(1); // одинаковые
    expect(Math.min(...seats.map((s) => s.rect.cx - s.rect.w / 2))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seats.map((s) => s.rect.cx + s.rect.w / 2))).toBeLessThanOrEqual(W);
  });

  it("места идут слева направо в порядке списка", () => {
    const { seats } = layoutSeats(ids(4), W, H);
    const tops = seats.filter((s) => s.side === "top");
    const xs = tops.map((s) => s.rect.cx);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(tops.map((s) => s.id)).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("не влезающие сползают вбок — сначала направо, потом налево", () => {
    const many = ids(Math.floor(W / SEAT_MIN_W) + 2);
    const { seats } = layoutSeats(many, W, H);
    const sides = seats.map((s) => s.side);
    expect(sides.filter((s) => s === "right").length).toBe(1);
    expect(sides.filter((s) => s === "left").length).toBe(1);
    // первый лишний — направо
    expect(seats[seats.length - 2].side).toBe("right");
    expect(seats[seats.length - 1].side).toBe("left");
  });

  it("боковые ужимают центр: появляются левый/правый отступы", () => {
    const many = ids(Math.floor(W / SEAT_MIN_W) + 2);
    const { insets } = layoutSeats(many, W, H);
    expect(insets.right).toBeGreaterThan(0);
    expect(insets.left).toBeGreaterThan(0);
  });

  it("боковые стоят колонками под верхней полосой и не наезжают друг на друга", () => {
    const many = ids(Math.floor(W / SEAT_MIN_W) + 4);
    const { seats, insets } = layoutSeats(many, W, H);
    const right = seats.filter((s) => s.side === "right");
    const left = seats.filter((s) => s.side === "left");
    expect(right.length).toBeGreaterThan(1);

    for (const col of [right, left]) {
      const sorted = [...col].sort((a, b) => a.rect.cy - b.rect.cy);
      for (let i = 1; i < sorted.length; i++) {
        const prevBottom = sorted[i - 1].rect.cy + sorted[i - 1].rect.h / 2;
        expect(sorted[i].rect.cy - sorted[i].rect.h / 2).toBeGreaterThanOrEqual(prevBottom - 0.001);
      }
      // колонка начинается ниже верхней полосы
      if (col.length) expect(col[0].rect.cy - col[0].rect.h / 2).toBeGreaterThanOrEqual(insets.top - 0.001);
    }
    // правая колонка справа, левая — слева
    expect(Math.min(...right.map((s) => s.rect.cx))).toBeGreaterThan(W / 2);
    expect(Math.max(...left.map((s) => s.rect.cx))).toBeLessThan(W / 2);
  });

  it("много игроков — все получают место и никто не уходит за низ", () => {
    const { seats } = layoutSeats(ids(31), W, H); // максимум комнаты минус я
    expect(seats.length).toBe(31);
    expect(seats.every((s) => s.rect.h > 0 && s.rect.w > 0)).toBe(true);
    expect(Math.max(...seats.map((s) => s.rect.cy + s.rect.h / 2))).toBeLessThanOrEqual(H);
  });

  it("пустой стол — ни мест, ни отступов", () => {
    const { seats, insets } = layoutSeats([], W, H);
    expect(seats).toEqual([]);
    expect(insets).toEqual({ top: 0, left: 0, right: 0 });
  });

  it("узкий экран не ломается: место остаётся положительным", () => {
    const { seats } = layoutSeats(ids(5), 320, 560);
    expect(seats.length).toBe(5);
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

  it("боковые колонки тоже начинаются под отступом", () => {
    const many = ids(Math.floor(W / SEAT_MIN_W) + 4);
    const { seats } = layoutSeats(many, W, H, { topOffset: 60 });
    const sides = seats.filter((s) => s.side !== "top");
    expect(Math.min(...sides.map((s) => s.rect.cy - s.rect.h / 2))).toBeGreaterThanOrEqual(60);
  });

  it("без отступа поведение прежнее", () => {
    const a = layoutSeats(ids(4), W, H);
    const b = layoutSeats(ids(4), W, H, { topOffset: 0 });
    expect(a).toEqual(b);
  });

  it("абсурдный отступ не съедает места целиком", () => {
    const { seats } = layoutSeats(ids(4), W, H, { topOffset: H });
    expect(seats.every((s) => s.rect.h > 0 && s.rect.cy + s.rect.h / 2 <= H)).toBe(true);
  });
});

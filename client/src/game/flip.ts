// Перевороты и «тянучка»: чистая математика жестов и трансформаций. Движок только рисует
// по этим числам, поэтому геометрия переворота тестируется без Pixi.

import { anim } from "./anim/config";

export type DeckSwipeAction = "flip" | "stretch" | "none";

export interface DeckSwipe {
  action: DeckSwipeAction;
  angle: number; // угол самого жеста (рад) — по нему идёт анимация
}

// Что делает свайп по СТОПКЕ. Переворот дают только движения вниз и вбок; ЛЮБОЙ увод
// вверх — включая пологие диагонали — переворота не даёт, там лишь резиновая тянучка
// (переворот колоды специально сделан «неудобным»). Небольшой допуск upTolerance нужен,
// чтобы дрожание руки на горизонтальном свайпе не читалось как жест вверх.
export function classifyDeckSwipe(vx: number, vy: number): DeckSwipe {
  const speed = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  if (speed < anim.flip.minSwipeSpeed) return { action: "none", angle };
  const upness = -vy / speed; // >0 — есть составляющая вверх
  if (upness > anim.flip.upTolerance) return { action: "stretch", angle };
  return { action: "flip", angle };
}

// Свайп ВНИЗ по вееру (переворот карты). Сектор тот же, что у запретного «вверх», только
// зеркальный: диагональ вниз-вбок тоже считается, а горизонтальное ведение — нет (это
// глиссандо по вееру).
export function isSwipeDown(vx: number, vy: number): boolean {
  const speed = Math.hypot(vx, vy);
  if (speed < anim.flip.minSwipeSpeed) return false;
  return vy / speed > anim.flip.upSectorCos;
}

// Фактор переворота: 1 → 0 (ребро) → 1. Модуль здесь принципиален: без него карта
// доезжала до -1, то есть оставалась ЗЕРКАЛЬНОЙ. Сторона меняется подменой текстуры ровно
// на ребре (flipShowsOther), а геометрия возвращается в исходную — карта не «вывернута».
export function flipFactor(p: number): number {
  return Math.abs(Math.cos(Math.PI * Math.max(0, Math.min(1, p))));
}

// Живой наклон во время переворота: карта кренится в сторону жеста на середине и сама
// ПЛАВНО возвращается к своему углу к концу. Вертикальный жест наклона не даёт (крутить
// не за что), диагональ — промежуточный, горизонталь — максимум.
export function flipTilt(p: number, swipeAngle: number, amp: number): number {
  const t = Math.max(0, Math.min(1, p));
  return amp * Math.sin(Math.PI * t) * Math.cos(swipeAngle);
}

// Когда подменять текстуру: ровно на ребре, чтобы подмены не было видно.
export function flipShowsOther(p: number): boolean {
  return p >= 0.5;
}

export interface Transform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

// Матрица карты в перевороте. Ось вращения ПЕРПЕНДИКУЛЯРНА жесту: свайп вниз крутит
// карту вокруг горизонтальной оси (высота схлопывается, ширина цела), свайп вбок — вокруг
// вертикальной, диагональ — вокруг диагонали. Это ортографическая проекция поворота в 3D:
// вдоль оси размер сохраняется, поперёк умножается на f. Собственный поворот карты (наклон
// в веере) сохраняется — он применяется ДО схлопывания.
// M = T · R(axis) · diag(1, f) · R(-axis) · R(cardRot) · S(scale), axis = swipe + 90°
export function flipTransform(
  cx: number,
  cy: number,
  cardRot: number,
  scale: number,
  swipeAngle: number,
  f: number,
): Transform2D {
  const axisAngle = swipeAngle + Math.PI / 2;
  const ca = Math.cos(axisAngle);
  const sa = Math.sin(axisAngle);
  // R(axis) · diag(1,f) · R(-axis) — симметричная матрица сжатия поперёк оси
  const s11 = ca * ca + f * sa * sa;
  const s12 = ca * sa * (1 - f);
  const s22 = sa * sa + f * ca * ca;
  // R(cardRot) · S(scale)
  const cr = Math.cos(cardRot) * scale;
  const sr = Math.sin(cardRot) * scale;
  return {
    a: s11 * cr + s12 * sr,
    b: s12 * cr + s22 * sr,
    c: s11 * -sr + s12 * cr,
    d: s12 * -sr + s22 * cr,
    tx: cx,
    ty: cy,
  };
}

// Резиновая тянучка для запрещённого жеста: уходит в сторону жеста и возвращается,
// проскакивая через ноль в обратную сторону — «отдача» резины.
export function stretchOffset(p: number, angle: number, amp: number): { dx: number; dy: number } {
  const t = Math.max(0, Math.min(1, p));
  const e = Math.sin(Math.PI * t) * Math.cos(Math.PI * t * anim.flip.stretchRecoil);
  return { dx: Math.cos(angle) * amp * e, dy: Math.sin(angle) * amp * e };
}

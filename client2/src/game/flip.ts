// Перевороты и «тянучка»: чистая математика жестов и трансформаций. Движок только рисует
// по этим числам, поэтому геометрия переворота тестируется без Pixi.

import { anim } from "./anim/config";

export function spinAngle(p: number, halfTurns: number): number {
  return Math.max(0, Math.min(1, p)) * halfTurns * Math.PI;
}

// Проекция вращения: ширина = |cos|. Модуль обязателен — иначе картинка становится
// зеркальной, а настоящая карта, повернувшись, зеркальной не бывает.
export function spinScale(theta: number): number {
  return Math.abs(Math.cos(theta));
}

// Видна ли сейчас ПРОТИВОПОЛОЖНАЯ сторона (перевалили нечётное число рёбер).
export function spinShowsOther(theta: number): boolean {
  return Math.cos(theta) < 0;
}

// Живой наклон во время разворота: карта кренится в сторону жеста к середине и САМА
// плавно возвращается к своему углу к концу. Вертикальный жест наклона не даёт (крутить
// не за что), диагональ — промежуточный, горизонталь — максимум.
export function flipTilt(p: number, swipeAngle: number, amp: number): number {
  const t = Math.max(0, Math.min(1, p));
  return amp * Math.sin(Math.PI * t) * Math.cos(swipeAngle);
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

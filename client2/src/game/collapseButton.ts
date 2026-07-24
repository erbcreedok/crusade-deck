// Куда и какого размера сажать круглую кнопку «сложить» под веером.
//
// Опорная кромка = верхняя кромка карт + высота карты (фиксированный офсет). Не берём
// провисший низ веера — иначе при 2 картах кнопка уезжает вверх, при 52 — вниз.
// Хит-круг касается этой опоры сверху. Видимый кружок меньше хита (visualRatio).

export interface Point {
  x: number;
  y: number;
}

export interface FittedButton {
  x: number;
  y: number;
  r: number; // радиус ЗОНЫ КАСАНИЯ (видимый кружок рисуется меньше)
}

function minDist(x: number, y: number, points: readonly Point[]): number {
  let best = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < best) best = d;
  }
  return best;
}

/** Самая нижняя точка кромки (max y). Для кнопки не используем — см. collapseAnchorBottom. */
export function cardBottomY(obstacles: readonly Point[], fallbackY: number): number {
  if (obstacles.length === 0) return fallbackY;
  let max = -Infinity;
  for (const p of obstacles) if (p.y > max) max = p.y;
  return max;
}

/** Опора кнопки: верх карт + cardH. Не зависит от числа карт / провиса дуги. */
export function collapseAnchorBottom(topOfCardsY: number, cardH: number): number {
  return topOfCardsY + cardH;
}

export interface FitOptions {
  cx: number; // по горизонтали — центр зоны/колоды
  /** Нижняя кромка карт (или верх колоды + высота карты). Хит-круг касается её сверху. */
  cardBottomY: number;
  minR: number;
  maxR: number;
  obstacles: readonly Point[]; // точки нижней границы карт
}

// Центр = кромка + r → верх хит-радиуса касается карт. При косых краях веера радиус
// чуть сжимаем, чтобы круг не врезался в боковые карты.
export function fitCollapseButton({ cx, cardBottomY, minR, maxR, obstacles }: FitOptions): FittedButton {
  const centerFor = (r: number) => cardBottomY + r;
  const fits = (r: number) => obstacles.length === 0 || minDist(cx, centerFor(r), obstacles) >= r - 1e-6;

  let lo = minR;
  let hi = Math.max(minR, maxR);
  if (fits(hi)) return { x: cx, y: centerFor(hi), r: hi };
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return { x: cx, y: centerFor(lo), r: lo };
}

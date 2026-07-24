// Общая арифметика, которая раньше жила копиями в пяти модулях (clamp в CardBody,
// layout, seatLayout, choreo/*; lerp в RoomEngine, shuffleFlight, cardFlight).
// Держим одну реализацию — и одни тесты на неё.

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Индекс элемента, чья x-координата ближе всего к точке. Пустой список → 0. */
export function nearestIndexByX(xs: readonly number[], x: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i]! - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

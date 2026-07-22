// Куда и какого размера сажать круглую кнопку «сложить руку». Раскладка веера зависит от
// экрана: на широком дуга пологая и карман под ней низкий, на узком — наоборот. Поэтому
// позиция и радиус не задаются константами, а ВПИСЫВАЮТСЯ в свободное место.
//
// Правило: кнопка прижата ко дну зоны, а её зона касания ровно КАСАЕТСЯ карт, не заходя
// на них. Видимый кружок концентричен и меньше, поэтому между ним и картами остаётся
// зазор, равный разнице радиусов.

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

export interface FitOptions {
  cx: number; // по горизонтали кнопка стоит по центру зоны
  bottomY: number; // дно зоны
  margin: number; // отступ от дна
  minR: number;
  maxR: number;
  obstacles: readonly Point[]; // точки нижней границы карт
}

// Наибольший радиус, при котором круг, прижатый ко дну зоны, ещё не залезает на карты.
// Ищем делением пополам: радиус и центр связаны (центр = дно - отступ - радиус), поэтому
// аналитического решения нет, а десяти итераций хватает с запасом.
export function fitCollapseButton({ cx, bottomY, margin, minR, maxR, obstacles }: FitOptions): FittedButton {
  const centerFor = (r: number) => bottomY - margin - r;
  const fits = (r: number) => obstacles.length === 0 || minDist(cx, centerFor(r), obstacles) >= r;

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

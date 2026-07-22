import type { RoundedRect } from "./layout";
import { anim } from "./anim/config";

// Раскладка колод внутри сейфа. Фиксированных «полок» нет: сколько колод положили,
// столько мест и получилось — они сами встают столбиком и центруются в зоне. Сколько
// поместится (две, три, четыре) решает высота сейфа, а не зашитая тройка.
//
// Целиться в конкретный слот при дропе не нужно: бросил в сейф — разложится само.
// Если места уже нет, вызывающий играет отказ («не влезет!»), сюда это не относится:
// здесь только геометрия.

const GAP = 6; // зазор между колодами по вертикали

// Высота одного места: колода в сейфе рисуется уменьшенной (см. anim.deck.safeScale).
function stackHeight(cardH: number): number {
  return cardH * anim.deck.safeScale + GAP;
}

export function safeCapacity(zone: RoundedRect, cardH: number): number {
  const step = stackHeight(cardH);
  // Хотя бы одна колода влезает всегда: сейф без единого места был бы бессмыслицей.
  return Math.max(1, Math.floor((zone.h - GAP) / step));
}

// Влезет ли в сейф ещё одна колода сверх тех, что там уже лежат. Решение отдельной
// функцией, потому что от него зависит поведение («не влезет!» с тряской), а не только
// картинка.
export function canFitAnother(countInSafe: number, zone: RoundedRect, cardH: number): boolean {
  return Math.max(0, countInSafe) < safeCapacity(zone, cardH);
}

// Куда встанут n колод. Группа центрируется по зоне, шаг между колодами одинаковый.
export function safeStackAnchors(n: number, zone: RoundedRect, cardH: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  const step = stackHeight(cardH);
  const top = zone.cy - (step * (n - 1)) / 2;
  return Array.from({ length: n }, (_, i) => ({ x: zone.cx, y: top + step * i }));
}

// Раскладка колоды веером-дугой (в сейф-зоне). Чистая математика — тестируется юнитами,
// движок только рисует по этим числам.

export interface Vec2 {
  x: number;
  y: number;
}

export interface FanCard {
  x: number;
  y: number;
  rot: number; // радианы
}

// Позиция карты i из count в веере. Наклон линейно от -max (левая) до +max (правая),
// крайние ровно ±maxAngleDeg (не круче). Центры лежат на окружности радиуса r (выведен
// из ширины веера и угла): середина выше, края ниже — «почти арка».
export function fanCard(
  i: number,
  count: number,
  anchor: Vec2,
  zoneWidth: number,
  maxAngleDeg: number,
  widthFactor: number,
): FanCard {
  const maxA = (maxAngleDeg * Math.PI) / 180;
  const t = count > 1 ? i / (count - 1) : 0.5; // 0..1
  const angle = (t * 2 - 1) * maxA; // -maxA..+maxA
  const halfW = (zoneWidth * widthFactor) / 2;
  const r = maxA > 0 ? halfW / Math.sin(maxA) : halfW;
  return {
    x: anchor.x + r * Math.sin(angle),
    y: anchor.y + r * (1 - Math.cos(angle)),
    rot: angle,
  };
}

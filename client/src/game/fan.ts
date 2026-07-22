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
// Насколько тесен веер (0 — просторно, 1 — максимально тесно). Горизонтальный шаг между
// картами = ширина веера / (count-1); если он меньше нужного (cardW*gap) — «тесно», и тем
// сильнее, чем меньше. По этой величине включается и масштабируется «червячок».
export function fanCrowd(
  count: number,
  zoneWidth: number,
  cardW: number,
  widthFactor: number,
  gap: number,
  ramp: number,
): number {
  if (count < 2 || cardW <= 0) return 0;
  const step = (zoneWidth * widthFactor) / (count - 1);
  const needed = cardW * gap;
  if (step >= needed) return 0;
  return Math.min(1, (needed - step) / (needed * ramp));
}

// Огибающая «энергии» эффекта: в момент тычка/раскрытия = boost, плавно спадает к 1
// (базовый червячок) за decayTime секунд. Квадрат — быстро в начале, потом медленнее.
export function energyEnvelope(kickT: number, decayTime: number, boost: number): number {
  const d = Math.max(0, Math.min(1, decayTime > 0 ? 1 - kickT / decayTime : 0));
  return 1 + (boost - 1) * d * d;
}

// Огибающая локального «раскрытия» при тыке: быстрый ease-in за inSec, держится hold
// секунд на 1, затем ease-out за outSec к 0. Вне интервала — 0 (поке завершён).
export function pokeEnvelope(t: number, inSec: number, hold: number, outSec: number): number {
  const inn = inSec > 0 ? Math.min(1, t / inSec) : 1;
  const out = t <= hold ? 1 : Math.max(0, 1 - (t - hold) / (outSec > 0 ? outSec : 1));
  return Math.max(0, Math.min(inn, out));
}

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

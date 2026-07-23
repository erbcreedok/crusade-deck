// Раскладка колоды веером-дугой (в зоне руки). Чистая математика — тестируется юнитами,
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
// Потолок угла веера по числу карт: крайние всегда ±angle, но при 2–3 картах полный
// maxAngleDeg даёт нелепый «домик». Шаг между соседями не больше maxStepDeg.
export function fanMaxAngleDeg(count: number, maxAngleDeg: number, maxStepDeg: number): number {
  if (count < 2 || maxAngleDeg <= 0) return 0;
  if (maxStepDeg <= 0) return maxAngleDeg;
  return Math.min(maxAngleDeg, ((count - 1) * maxStepDeg) / 2);
}

// Ширина зоны под веер с потолком на шаг между картами.
// maxStepOfCard — макс. горизонтальный шаг в долях ширины карты (0.75 idle / 0.80 драг):
// при малом count веер не растягивается на всю полосу, а держит плотный шаг.
export function clampFanWidth(
  availableWidth: number,
  count: number,
  cardW: number,
  widthFactor: number,
  maxStepOfCard: number,
): number {
  if (count < 2 || cardW <= 0 || widthFactor <= 0 || maxStepOfCard <= 0) return availableWidth;
  const maxSpan = (count - 1) * cardW * maxStepOfCard;
  return Math.min(availableWidth, maxSpan / widthFactor);
}

// Насколько тесен веер (0 — просторно, 1 — максимально тесно). Горизонтальный шаг между
// картами = ширина веера / (count-1); если он меньше нужного (cardW*gap) — «тесно», и тем
// сильнее, чем меньше. По этой величине включается и масштабируется «червячок».
export function fanStep(count: number, zoneWidth: number, widthFactor: number): number {
  if (count < 2) return Number.POSITIVE_INFINITY;
  return (zoneWidth * widthFactor) / (count - 1);
}

export function fanCrowd(
  count: number,
  zoneWidth: number,
  cardW: number,
  widthFactor: number,
  gap: number,
  ramp: number,
): number {
  if (count < 2 || cardW <= 0) return 0;
  const step = fanStep(count, zoneWidth, widthFactor);
  const needed = cardW * gap;
  if (step >= needed) return 0;
  return Math.min(1, (needed - step) / (needed * ramp));
}

// Насколько нужно локальное раскрытие (ховер/тык): 0 — шаг уже ≥ idle-потолка
// (мало карт, веер просторный — карты почти не двигаем), 1 — теснее порога wiggle.gap.
export function fanRevealScale(
  step: number,
  cardW: number,
  tightGapOfCard: number,
  looseStepOfCard: number,
): number {
  if (cardW <= 0 || !Number.isFinite(step)) return 0;
  const loose = cardW * looseStepOfCard;
  const tight = cardW * tightGapOfCard;
  if (step >= loose) return 0;
  if (step <= tight) return 1;
  if (loose <= tight) return 0;
  return (loose - step) / (loose - tight);
}

// Amp раздвига при драге: на просторном веере (revealScale=0) доп. разъезд не нужен —
// дырки в слоте insertAt уже достаточно; иначе сосед улетает за край (2_31 вместо 213).
export function fanDragSpreadAmp(baseAmp: number, revealScale: number): number {
  if (baseAmp === 0 || revealScale <= 0) return 0;
  return baseAmp * Math.min(1, revealScale);
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

// Локальный «раздвиг» веера вокруг точки center: карта i уезжает вдоль веера (в «слотах»)
// тем сильнее, чем дальше она от центра раскрытия, но не дальше края окна в `cards` карт —
// за окном сдвиг постоянный, то есть окно просто раздвигает остальную колоду в стороны.
// Один и тот же раздвиг используют тык/ховер (раскрытие под пальцем) и драг карты
// (раскрытие вокруг точки вставки, чтобы видеть соседей).
// rightBias — насколько сильнее толкать ПРАВУЮ сторону от точки раскрытия. Правая карта
// лежит выше и накрывает наводимую, поэтому отогнать её вправо сильнее = чётче открыть
// нужную карту; влево толкать так же сильно незачем (левая карта ниже, обзор не мешает), а
// заодно асимметрия подсказывает пальцу, КУДА он целится. При rightBias=1 раздвиг
// симметричен (обратная совместимость).
export function fanSpreadShift(
  i: number,
  center: number,
  cards: number,
  amp: number,
  env: number,
  rightBias = 1,
): number {
  if (env <= 0 || cards <= 0) return 0;
  const half = cards / 2;
  const s = Math.max(-1, Math.min(1, (i - center) / half)); // -1..1 через окно
  const bias = s > 0 ? rightBias : 1; // сильнее толкаем только вправо
  return amp * env * s * 0.5 * bias;
}

// Раздвиг с ПРИБИТЫМИ краями: вокруг точки вставки зазор раскрывается, но крайние карты
// не двигаются, поэтому общая ширина веера остаётся прежней. Это и нужно при драге карты:
// раньше веер заметно распухал, вылезая за свою зону, — теперь он лишь перераспределяет
// расстояния внутри себя (у пивота шире, дальше от него плотнее).
//
// Сдвиг гасится к обоим краям множителями u/u0 и (1-u)/(1-u0), поэтому на концах он
// строго нулевой, а порядок карт сохраняется.
export function fanSpreadPinned(
  i: number,
  count: number,
  center: number,
  cards: number,
  amp: number,
): number {
  if (count < 2 || amp === 0 || cards <= 0) return 0;
  const last = count - 1;
  const u = i / last;
  const u0 = Math.max(0, Math.min(1, center / last));
  const half = cards / 2 / last; // окно раскрытия в долях веера
  if (half <= 0) return 0;
  const d = u - u0;
  const window = Math.max(-1, Math.min(1, d / half)); // -1..1 через окно
  const fade = d >= 0 ? (u0 < 1 ? (1 - u) / (1 - u0) : 0) : u0 > 0 ? u / u0 : 0;
  return amp * 0.5 * window * fade;
}

// Ширина видимой полоски карты i в веере: z растёт слева направо, значит каждую карту
// накрывает соседка СПРАВА (она выше), а левая (ниже) её не трогает. Поэтому меряем ровно
// зазор ВПРАВО — за него карту и «хватают». У самой правой карты соседа справа нет: она
// лежит сверху, видна целиком и тянется свободно (Infinity), без проверки расстояния.
// Считается по ФАКТИЧЕСКИМ координатам спрайтов — с учётом волны и раскрытия под пальцем.
export function visibleSliver(xs: readonly number[], i: number): number {
  if (i < 0 || i >= xs.length) return 0;
  if (i + 1 < xs.length) return Math.abs(xs[i + 1] - xs[i]);
  return Infinity; // верхняя (правая) карта — ничем не накрыта
}

// Обратная к fanCard задача: в какой слот веера (0..count-1) целится точка с координатой x.
// Нужна для драга карты — куда она встанет, если отпустить здесь. Инвертируем геометрию
// дуги: x = anchor.x + r*sin(angle) → angle → доля t → номер слота.
export function fanInsertIndex(
  x: number,
  anchor: Vec2,
  zoneWidth: number,
  count: number,
  maxAngleDeg: number,
  widthFactor: number,
): number {
  if (count <= 1) return 0;
  const maxA = (maxAngleDeg * Math.PI) / 180;
  const halfW = (zoneWidth * widthFactor) / 2;
  const r = maxA > 0 ? halfW / Math.sin(maxA) : halfW;
  if (r <= 0 || maxA <= 0) return 0;
  const s = Math.max(-1, Math.min(1, (x - anchor.x) / r));
  const t = (Math.asin(s) / maxA + 1) / 2; // 0..1 вдоль веера
  const i = Math.round(Math.max(0, Math.min(1, t)) * (count - 1));
  return i;
}

// Точка (x,y) внутри «полосы веера»? Веер — дуга окружности, поэтому его настоящая
// область попадания — кольцевой сектор, а НЕ прямоугольник зоны руки: на широком экране
// дуга проседает вниз далеко за пределы зоны, и края веера оказываются вне прямоугольника
// (тык/ховер по крайним картам не срабатывал). Центр дуги — на r ниже якоря; карты
// повёрнуты вдоль радиуса, значит по радиусу полоса шириной в высоту карты, а по углу —
// ±maxAngleDeg плюс половина ширины карты (в угловой мере). pad — запас под палец.
export function fanBandContains(
  x: number,
  y: number,
  anchor: Vec2,
  zoneWidth: number,
  maxAngleDeg: number,
  widthFactor: number,
  cardW: number,
  cardH: number,
  pad = 0,
): boolean {
  const maxA = (maxAngleDeg * Math.PI) / 180;
  const halfW = (zoneWidth * widthFactor) / 2;
  const r = maxA > 0 ? halfW / Math.sin(maxA) : halfW;
  if (r <= 0) return false;

  const cy = anchor.y + r; // центр окружности дуги
  const dx = x - anchor.x;
  const dy = cy - y;
  const dist = Math.hypot(dx, dy);
  if (Math.abs(dist - r) > cardH / 2 + pad) return false;

  const angle = Math.atan2(dx, dy); // тот же отсчёт, что и у fanCard
  return Math.abs(angle) <= maxA + (cardW / 2 + pad) / r;
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

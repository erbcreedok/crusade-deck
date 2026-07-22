// Правила видимости руки — «Рука 3.0». Чистая логика: кто что видит и как рука разложена.
// Движок и UI только применяют результат.
//
// Три состояния карты в руке:
//   скрыта (по умолчанию) — владелец видит лицо, остальные рубашку;
//   открыта (handOpen)    — остальные видят её так же, как владелец;
//   спрятана (hidden)     — императивный тумблер владельца: чужим не видно вообще.

export type HandLayout = "fan" | "row" | "stack";
export type CardView = "face" | "back" | "none";

// Как разложена рука. Фокус — это «рука взята в работу»: она раскрывается веером у
// владельца и превращается в считаемый ряд для остальных. Вне фокуса своя рука стоит
// шеренгой (видно СКОЛЬКО карт, но не какие), а чужая выглядит просто стопкой — по ней
// нельзя даже сосчитать карты.
export function handLayout(isOwner: boolean, focused: boolean): HandLayout {
  if (isOwner) return focused ? "fan" : "row";
  return focused ? "row" : "stack";
}

export interface CardViewArgs {
  isOwner: boolean;
  handOpen: boolean;
  hidden: boolean;
  focused: boolean;
  index: number;
  count: number;
}

export function cardView({ isOwner, handOpen, hidden, focused, index, count }: CardViewArgs): CardView {
  if (isOwner) return "face"; // свою руку владелец видит всегда, включая спрятанные карты
  if (hidden) return "none"; // спрятанную не видит никто, даже при открытой руке
  if (!handOpen) return "back";
  // Открытая рука вне фокуса показывает только последнюю карту — остальное «в пачке».
  if (!focused) return index === count - 1 ? "face" : "back";
  return "face";
}

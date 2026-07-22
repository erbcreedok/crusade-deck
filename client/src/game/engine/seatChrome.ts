import { dealHandAccent, isDealReady } from "../dealReadyTint";
import { COLORS } from "./constants";

// Как выглядит прямоугольник чужого места: цвет рамки, прозрачность, нужна ли заливка,
// какие метки подписаны рядом с именем. Чистые правила без Pixi — рисование в seatPaint.ts.

export interface SeatChromeInput {
  isDealer: boolean;
  isReady: boolean;
  connected: boolean;
  /** Раздача идёт: место красится по готовности, а не по роли. */
  dealMode: boolean;
}

export interface SeatChrome {
  /** Цвет обводки. */
  border: number;
  /** Общая прозрачность содержимого места (отключённый игрок приглушён). */
  alpha: number;
  /** Прозрачность самой обводки. */
  strokeAlpha: number;
  /** Нужна ли тёмная заливка под содержимым (в раздаче её нет — только рамка). */
  fill: boolean;
  /** Акцент готовности (жёлтый/серый) или null вне раздачи. */
  readyTint: number | null;
  /** Принимает ли этот игрок карты: «Готов» или дилер (он всегда готов). */
  dealReady: boolean;
}

export function seatChrome(seat: SeatChromeInput): SeatChrome {
  // Раздача: готов → жёлтый, не готов → серый. Дилер всегда готов.
  const dealReady = isDealReady(seat.isReady, seat.isDealer);
  const readyTint = seat.dealMode ? dealHandAccent(dealReady) : null;
  // Отключённый игрок («на паузе») — приглушён; дилер — золотая рамка вне раздачи.
  const border =
    readyTint != null
      ? readyTint
      : seat.isDealer
        ? COLORS.dealerBorder
        : seat.connected
          ? COLORS.seatBorder
          : COLORS.seatBorderOff;
  const alpha = seat.connected ? 1 : 0.45;
  return {
    border,
    alpha,
    strokeAlpha: (readyTint != null ? 0.22 : 0.55) * alpha,
    fill: readyTint == null,
    readyTint,
    dealReady,
  };
}

/** Метки у имени: бот, дилер, готовность и режим руки (🔓 открыта / 🔒 закрыта). */
export function seatMarks(seat: {
  isBot: boolean;
  isDealer: boolean;
  isReady: boolean;
  handOpen: boolean;
}): string {
  return [seat.isBot ? "🤖" : "", seat.isDealer ? "♦" : "", seat.isReady ? "✓" : "", seat.handOpen ? "🔓" : "🔒"]
    .filter(Boolean)
    .join(" ");
}

/** Подпись места целиком: имя плюс метки, если они есть. */
export function seatLabel(seat: {
  name: string;
  isBot: boolean;
  isDealer: boolean;
  isReady: boolean;
  handOpen: boolean;
}): string {
  const marks = seatMarks(seat);
  return marks ? `${seat.name} ${marks}` : seat.name;
}

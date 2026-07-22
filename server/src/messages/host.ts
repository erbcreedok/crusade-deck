import type { Room } from "@colyseus/core";
import type { GameState } from "../GameState.js";

// Что обработчикам сообщений нужно от комнаты помимо самой схемы. Интерфейс существует
// ради читаемости: по нему сразу видно, какими рычагами комнаты вообще пользуются
// обработчики — таймеры тасовки, ревизии, круг мест, лимитер эффектов и голосования.

export interface RoomHost {
  /** Принять запись колоды, только если её номер новее текущего (см. deckRev). */
  acceptRev(rev: unknown): boolean;
  /** Продлить «замок» сессии тасовки. */
  armShuffleLock(): void;
  /** Снять замок: сессия закончилась (или тасующий отвалился). */
  clearShuffleLock(): void;
  /** Круг мест по часовой, только те, кто реально в комнате. */
  seatIds(): string[];
  /** Пропустить ли ещё один эффект от этого клиента (антифлуд). */
  allowFx(sessionId: string, now: number): boolean;
  /** Открыть голосование и запустить его таймер. */
  startProposal(kind: "dealer" | "kick", proposerId: string, targetId: string): void;
  /** Пересчитать голоса и закрыть голосование, если исход уже ясен. */
  tallyAndResolve(): void;
  /** Раздать всю колоду по кругу (старт игры). */
  dealAllCards(): void;
}

/** Комната, готовая принимать обработчики сообщений. */
export type MessageRoom = Room<GameState> & RoomHost;

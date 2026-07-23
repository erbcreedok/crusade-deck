import { useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import { FxClock, shouldPlayFx, type DeckFxIncoming } from "../game/deckFxClient";
import { rejectionText } from "../game/rejections";
import { REDEAL_TEXT } from "../game/engine/constants";
import { TAUNT_KINDS, type TauntKind } from "../game/taunt";

// Серверные сообщения-события (не состояние): отказы, чужие эффекты, облёты карт.
// Каждое едет в движок как «сигнал» — объект с растущим seq, чтобы два одинаковых
// события подряд не слились в один эффект React.

export interface CollectSignal {
  order: string[];
  counts?: Record<string, number>;
  seq: number;
}

export interface CardMovedSignal {
  moves: { card: string; from: string; to: string }[];
  seq: number;
}

/** Отказ сервера: надпись поверх стола с причиной. */
export interface NoticeSignal {
  text: string;
  seq: number;
}

/** Клич «ГОУ!»: состояния в нём нет, только «сыграй это» (см. go_shout на сервере). */
export interface ShoutSignal {
  seq: number;
}

/** Кричалка: чья и какая. Состояния в ней нет — см. game/taunt.ts. */
export interface TauntSignal {
  kind: TauntKind;
  from: string;
  seq: number;
}

export interface RoomSignals {
  noticeSignal: NoticeSignal | null;
  incomingFx: DeckFxIncoming | null;
  collectSignal: CollectSignal | null;
  cardMovedSignal: CardMovedSignal | null;
  shoutSignal: ShoutSignal | null;
  tauntSignal: TauntSignal | null;
}

export interface RoomSignalHandlers {
  /** Сервер отказал: накопленную сессию тасовки досылать бессмысленно. */
  onRejected?: () => void;
  /** Карты собраны/колода сброшена: автораздачу и выделение пора погасить. */
  onCollected?: () => void;
}

export function useRoomSignals(room: Room, handlers: RoomSignalHandlers = {}): RoomSignals {
  const [noticeSignal, setNoticeSignal] = useState<NoticeSignal | null>(null);
  const [incomingFx, setIncomingFx] = useState<DeckFxIncoming | null>(null);
  const [collectSignal, setCollectSignal] = useState<CollectSignal | null>(null);
  const [cardMovedSignal, setCardMovedSignal] = useState<CardMovedSignal | null>(null);
  const [shoutSignal, setShoutSignal] = useState<ShoutSignal | null>(null);
  const [tauntSignal, setTauntSignal] = useState<TauntSignal | null>(null);

  // Обработчики меняются на каждый рендер — держим их в ref, чтобы не переподписываться.
  const hRef = useRef(handlers);
  hRef.current = handlers;

  // Отказы сервера. Клиент показывает жест сразу, оптимистично — значит, каждый отказ
  // обязан сказать, почему так нельзя (саму картинку движок возвращает сам).
  useEffect(() => {
    let seq = 0;
    room.onMessage("action_rejected", (msg: { reason?: string }) => {
      hRef.current.onRejected?.();
      setNoticeSignal({ text: rejectionText(String(msg?.reason ?? "")), seq: ++seq });
    });
  }, [room]);

  // Клич «ГОУ!» — украшение без состояния: играем его как есть, у кого он застал вкладку.
  useEffect(() => {
    let seq = 0;
    room.onMessage("go_shout", () => setShoutSignal({ seq: ++seq }));
  }, [room]);

  // Кричалка соседа (или своя — сервер шлёт её всем, включая автора: кричащий должен
  // видеть, что крик прошёл). Вид проверяем и здесь: сервер свой, но движок рисует по
  // виду напрямую, и незнакомый вид ему передавать незачем.
  useEffect(() => {
    let seq = 0;
    room.onMessage("taunt", (msg: { kind?: string; from?: string }) => {
      const kind = msg?.kind as TauntKind;
      if (!TAUNT_KINDS.includes(kind) || typeof msg?.from !== "string") return;
      setTauntSignal({ kind, from: msg.from, seq: ++seq });
    });
  }, [room]);

  // Приём чужих эффектов. Протухшие (пинг скакнул, вкладка была свёрнута) не играем:
  // догонять момент полусекундной давности бессмысленно, а данные всё равно уже пришли
  // схемой — они и есть правда, эффект лишь помогает понять, ЧТО произошло.
  const fxClockRef = useRef(new FxClock());
  useEffect(() => {
    room.onMessage("deck_fx", (fx: DeckFxIncoming) => {
      if (shouldPlayFx(fx, Date.now(), fxClockRef.current)) setIncomingFx({ ...fx });
    });
  }, [room]);

  useEffect(() => {
    let seq = 0;
    const collectPayload = (msg: { order?: string[]; counts?: Record<string, number> }) => {
      const order = Array.isArray(msg?.order) ? msg.order : [];
      const counts =
        msg?.counts && typeof msg.counts === "object" ? (msg.counts as Record<string, number>) : undefined;
      setCollectSignal({ order, counts, seq: ++seq });
      // Сбор карт — событие всего стола, а не одного дилера: остальные видят, как карты
      // улетают, и должны понимать, ПОЧЕМУ. Старту игры своя надпись не нужна — у него
      // есть клич «ГОУ!».
      setNoticeSignal({ text: REDEAL_TEXT, seq: ++seq });
      hRef.current.onCollected?.();
    };
    room.onMessage("hands_collected", collectPayload);
    // Сброс колоды — тот же облёт «с мест в центр», что и сбор.
    room.onMessage("deck_reset", collectPayload);
    room.onMessage("card_moved", (msg: { moves?: { card?: string; from?: string; to?: string }[] }) => {
      const raw = Array.isArray(msg?.moves) ? msg.moves : [];
      const moves = raw.filter(
        (m): m is { card: string; from: string; to: string } =>
          typeof m?.card === "string" && typeof m?.from === "string" && typeof m?.to === "string",
      );
      if (moves.length === 0) return;
      setCardMovedSignal({ moves, seq: ++seq });
    });
  }, [room]);

  return { noticeSignal, incomingFx, collectSignal, cardMovedSignal, shoutSignal, tauntSignal };
}

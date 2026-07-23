import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "colyseus.js";
import { isPermutationOf } from "../game/deckOrder";
import { readRoomState, type ActiveProposal, type RoomPlayer } from "./readState";

// Состояние комнаты: подписка на схему плюс два правила «не дать картинке дёрнуться».
//
// 1. Ревизии. Дилер меняет колоду мгновенно и может успеть прислать несколько изменений
//    подряд; эхо, которое старее уже показанного, игнорируем — иначе картинка откатывалась
//    бы назад и заметно «джиттерила».
// 2. Свой порядок руки. Сортировка/перетаскивание применяются сразу, а эхо приходит позже.
//    Любой ЧУЖОЙ патч между делом (сосед нажал «Готов») перерисовал бы руку серверным —
//    ещё не отсортированным — порядком. Пока состав руки тот же, держим свой порядок;
//    как только состав изменился (карту раздали/забрали), правда сервера важнее.

export interface RoomStateView {
  players: RoomPlayer[];
  seatOrder: string[];
  inviteCode: string;
  isPublic: boolean;
  phase: "lobby" | "playing" | "finished";
  proposal: ActiveProposal | null;
  deck: string[];
  setDeck: (deck: string[]) => void;
  discard: string[];
  facing: Record<string, boolean>;
  myHand: string[];
  /** Применить свой порядок руки локально и запомнить его до подтверждения эхом. */
  applyMyHandOrder: (order: string[]) => void;
  freeMode: boolean;
  deckFanned: boolean;
  setDeckFanned: (open: boolean) => void;
  deckLocation: string;
  /** Номер следующего своего изменения колоды (для rev в сообщениях). */
  nextRev: () => number;
}

export function useRoomState(room: Room): RoomStateView {
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  // Серверный круг мест — один на всех; локально крутим относительно себя.
  const [seatOrder, setSeatOrder] = useState<string[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "playing" | "finished">("lobby");
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const [deck, setDeck] = useState<string[]>([]);
  const [discard, setDiscard] = useState<string[]>([]);
  const [myHand, setMyHand] = useState<string[]>([]);
  const [freeMode, setFreeMode] = useState(false);
  const [deckFanned, setDeckFanned] = useState(false);
  const [deckLocation, setDeckLocation] = useState("center");
  // Сторона каждой карты приходит из состояния — это правда, а не локальный тумблер.
  const [facing, setFacing] = useState<Record<string, boolean>>({});

  const revRef = useRef(0);
  const pendingHandOrderRef = useRef<string[] | null>(null);

  const nextRev = useCallback(() => {
    revRef.current += 1;
    return revRef.current;
  }, []);

  const applyMyHandOrder = useCallback((order: string[]) => {
    pendingHandOrderRef.current = order;
    setMyHand(order);
  }, []);

  useEffect(() => {
    const sync = () => {
      const s = readRoomState(room.state, room.sessionId);
      setPlayers(s.players);
      setSeatOrder(s.seatOrder);
      setInviteCode(s.inviteCode);
      setIsPublic(s.isPublic);
      setPhase(s.phase);
      setProposal(s.proposal);
      setDeckLocation(s.deckLocation);
      setDiscard(s.discard);
      setFreeMode(s.freeMode);
      setDeckFanned(s.deckFanned);

      // Устаревшее эхо собственных действий не принимаем: на экране уже более новое.
      const stale = s.deckRev < revRef.current;
      revRef.current = Math.max(revRef.current, s.deckRev);
      if (!stale) {
        setDeck(s.deck);
        setFacing(s.facing);
      }

      const pending = pendingHandOrderRef.current;
      if (pending && isPermutationOf(pending, s.myHand)) {
        if (pending.join("|") === s.myHand.join("|")) pendingHandOrderRef.current = null;
        setMyHand(pending);
      } else {
        pendingHandOrderRef.current = null;
        setMyHand(s.myHand);
      }
    };

    room.state.players.onAdd = sync;
    room.state.players.onRemove = sync;
    room.onStateChange(sync);
    sync();
  }, [room]);

  return {
    players,
    seatOrder,
    inviteCode,
    isPublic,
    phase,
    proposal,
    deck,
    setDeck,
    discard,
    facing,
    myHand,
    applyMyHandOrder,
    freeMode,
    deckFanned,
    setDeckFanned,
    deckLocation,
    nextRev,
  };
}

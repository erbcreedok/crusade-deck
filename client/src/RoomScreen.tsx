import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import { ProposalBanner } from "./ProposalBanner";
import { ActionBar, type MenuItem } from "./ActionBar";
import { RoomCanvas } from "./game/RoomCanvas";
import type { CardBackId } from "./game/cardBack";
import { deckPlaceFor } from "./game/deckZone";
import { tableSummary, type SeatView } from "./game/seats";
import { EMPTY_SELECTION, selectOnly, clearSelection, type Selection } from "./game/selection";
import { barActionsFor, type BarActionId } from "./game/barActions";
import { DECK_ID } from "./game/RoomEngine";
import { ShuffleSession } from "./game/shuffleSession";
import { FxClock, shouldPlayFx, type DeckFxMessage, type DeckFxIncoming } from "./game/deckFxClient";
import { rejectionText } from "./game/rejections";
import { topCard } from "./game/topCard";
import { moveCard } from "./game/deckOrder";
import { sortBySuit, sortByRank } from "./game/sortHand";
import { dealOrder, autoDealPlan, AUTO_DEAL_INTERVAL_MS } from "./game/dealing";
import { seatsForViewer } from "./game/seatOrder";
import type { AnimationSettings } from "./game/anim/animationSettings";

// Игрок в списке комнаты. Совпадает по форме с Seat (game/seats.ts) — стол дальше
// будет рассаживать ровно этих.
interface RoomPlayer {
  id: string;
  name: string;
  isDealer: boolean;
  isReady: boolean;
  isBot: boolean;
  connected: boolean;
  handCount: number;
  hand: string[]; // порядок карт (лица при открытой руке)
  handOpen: boolean; // открытая — номиналы видны всем
  handFanned: boolean; // веер на месте игрока
}

interface ActiveProposal {
  kind: "dealer" | "kick";
  proposerId: string;
  targetId: string;
  deadline: number;
  votes: Record<string, boolean>;
}

// Экран комнаты без отрисованной сцены (стол/места/рука/колода сняты).
// Осталась рабочая обвязка: топбар, баннер голосования, кнопки лобби.
export function RoomScreen({
  room,
  animation,
  fourColor,
  cardBack,
  onOpenSettings,
  onLeaveRoom,
}: {
  room: Room;
  animation: AnimationSettings;
  fourColor: boolean;
  cardBack: CardBackId;
  onOpenSettings: () => void;
  onLeaveRoom: () => void;
}) {
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  // Серверный круг мест — один на всех; локально крутим относительно себя.
  const [seatOrder, setSeatOrder] = useState<string[]>([]);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "playing" | "finished">("lobby");
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const [deck, setDeck] = useState<string[]>([]);
  const [myHand, setMyHand] = useState<string[]>([]);
  const [dealMode, setDealMode] = useState(true);
  const [deckFanned, setDeckFanned] = useState(false);
  // Где лежит колода по мнению сервера ("center" или id держателя). В зону для движка
  // переводим ниже — для этого нужно знать, кто сейчас сидит за столом.
  const [deckLocation, setDeckLocation] = useState<string>("center");
  const [draggingDeck, setDraggingDeck] = useState(false);
  // Сторона каждой карты приходит из состояния — это правда, а не локальный тумблер.
  const [facing, setFacing] = useState<Record<string, boolean>>({});
  const [handFanOpen, setHandFanOpen] = useState(false);
  const [shuffleSignal, setShuffleSignal] = useState(0);
  const [autoDealing, setAutoDealing] = useState(false);
  const autoDealRef = useRef<{ plan: string[]; i: number } | null>(null);
  const [collectSignal, setCollectSignal] = useState<{
    order: string[];
    counts?: Record<string, number>;
    seq: number;
  } | null>(null);
  const [cardMovedSignal, setCardMovedSignal] = useState<{
    moves: { card: string; from: string; to: string }[];
    seq: number;
  } | null>(null);
  // Номер последней НАШЕЙ записи в колоду. Дилер пишет мгновенно и может успеть прислать
  // несколько изменений подряд — по номеру сервер отбрасывает устаревшие, а мы не
  // принимаем эхо, которое старше того, что уже показали.
  const revRef = useRef(0);
  const nextRev = useCallback(() => {
    revRef.current += 1;
    return revRef.current;
  }, []);
  const [flipSignal, setFlipSignal] = useState(0);
  // Последний пришедший чужой эффект — движок его просто показывает.
  const [incomingFx, setIncomingFx] = useState<DeckFxIncoming | null>(null);
  // Отказ сервера на переворот: карты уже показаны другой стороной, их надо вернуть.
  // seq нужен, чтобы два одинаковых отказа подряд не слились в один эффект React.
  const [rejectedFlip, setRejectedFlip] = useState<{ cards: string[]; text: string; seq: number } | null>(null);

  useEffect(() => {
    const sync = () => {
      const list: RoomPlayer[] = [];
      room.state.players.forEach((p: any, sessionId: string) => {
        list.push({
          id: sessionId,
          name: p.name,
          isDealer: p.isDealer,
          isReady: p.isReady,
          isBot: !!p.isBot,
          connected: p.connected,
          handCount: p.hand?.length ?? 0,
          hand: p.hand ? Array.from(p.hand as Iterable<string>) : [],
          handOpen: !!p.handOpen,
          handFanned: !!p.handFanned,
        });
      });
      setPlayers(list);
      setSeatOrder(room.state.seatOrder ? [...room.state.seatOrder] : list.map((p) => p.id));
      setInviteCode(room.state.inviteCode);
      setIsPublic(room.state.isPublic);
      setPhase(room.state.phase);
      // Устаревшее эхо собственных действий не принимаем: на экране уже показано более
      // новое состояние, и откатывать его назад — тот самый «тупняк».
      const rev = room.state.deckRev ?? 0;
      const stale = rev < revRef.current; // это эхо старее того, что мы уже показали
      revRef.current = Math.max(revRef.current, rev);
      if (!stale) {
        setDeck(room.state.deck ? [...room.state.deck] : []);
        const nextFacing: Record<string, boolean> = {};
        room.state.faceUp?.forEach((up: boolean, card: string) => (nextFacing[card] = up));
        setFacing(nextFacing);
      }
      setDeckLocation(room.state.deckLocation ?? "center");
      setDealMode(room.state.dealMode !== false);
      setDeckFanned(!!room.state.deckFanned);
      const me = room.state.players.get(room.sessionId);
      setMyHand(me?.hand ? [...me.hand] : []);

      // @colyseus/schema всегда отдаёт пустую заглушку для optional nested-schema
      // поля, даже когда оно не установлено на сервере — proposerId остаётся ""
      // до реального старта голосования, это и есть настоящий признак "нет активного".
      const ap = room.state.activeProposal;
      if (!ap || !ap.proposerId) {
        setProposal(null);
      } else {
        const votes: Record<string, boolean> = {};
        ap.votes.forEach((value: boolean, sessionId: string) => {
          votes[sessionId] = value;
        });
        setProposal({ kind: ap.kind, proposerId: ap.proposerId, targetId: ap.targetId, deadline: ap.deadline, votes });
      }
    };

    room.state.players.onAdd = sync;
    room.state.players.onRemove = sync;
    room.onStateChange(sync);
    sync();
  }, [room]);

  const weightOf = (sessionId: string) => {
    const p = players.find((pl) => pl.id === sessionId);
    if (!p || !p.connected) return 0;
    return p.isDealer ? 1.5 : 1;
  };
  const totalWeight = players.reduce((sum, p) => sum + (p.connected ? (p.isDealer ? 1.5 : 1) : 0), 0);
  const yesWeight = proposal
    ? Object.entries(proposal.votes).reduce((s, [id, v]) => (v ? s + weightOf(id) : s), 0)
    : 0;
  const noWeight = proposal
    ? Object.entries(proposal.votes).reduce((s, [id, v]) => (!v ? s + weightOf(id) : s), 0)
    : 0;
  const proposerName = players.find((p) => p.id === proposal?.proposerId)?.name || "?";
  const targetName = players.find((p) => p.id === proposal?.targetId)?.name || "?";
  const myVote = proposal ? proposal.votes[room.sessionId] : undefined;
  const amIDealer = players.find((p) => p.id === room.sessionId)?.isDealer ?? false;
  const summary = tableSummary(players);

  // Выделение элементов стола. Тап выделяет, тап мимо — снимает; правила (что с чем
  // складывается и что чем сбрасывается) живут в selection.ts.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  // Тап по колоде только ВЫДЕЛЯЕТ её и никогда не снимает выделение: рука в фокусе ловит
  // тык и глиссандо, и переключающий тап сворачивал её посреди работы с картами.
  // Свернуть можно явно — стрелкой под веером, свайпом вниз или тапом мимо.
  // Тап по элементу стола. В режиме раздачи колоду в центре НЕ выделяем — только руку.
  const onDeckTap = useCallback((deckId: string) => {
    if (deckId === DECK_ID) return;
    setSelection((sel) => selectOnly(sel, "deck", deckId));
  }, []);
  const onFanCollapse = useCallback(() => setSelection(clearSelection()), []);
  const onEmptyTap = useCallback(() => setSelection(clearSelection()), []);
  const selectedDecks = selection.type === "deck" ? selection.ids : [];
  // Веер своей руки → на сервер: остальные рисуют веер на моём месте.
  const onFanChange = useCallback(
    (fanned: boolean) => {
      setHandFanOpen(fanned);
      room.send("set_hand_fanned", { open: fanned });
    },
    [room],
  );

  // Топбар — HTML поверх канваса, и его высота зависит от контента (бейджи переносятся
  // на узком экране). Меряем её и отдаём движку, иначе места игроков сядут под бейджи.
  const topbarRef = useRef<HTMLDivElement>(null);
  const [topInset, setTopInset] = useState(0);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    // Высота шапки константна (--topbar-h), но её положение зависит от safe-area,
    // поэтому берём НИЖНЮЮ границу: ровно столько сверху занято, столько и отдаём.
    const apply = () => setTopInset(el.getBoundingClientRect().bottom + 8);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Панель действий внизу — тоже HTML поверх канваса, и её высота КОНСТАНТНА (см.
  // --action-btn-h в theme.css). Меряем реальную высоту (плюс safe-area на iOS) и
  // отдаём движку: игровые зоны заканчиваются над панелью, карты под кнопки не уезжают.
  const [bottomInset, setBottomInset] = useState(0);
  useEffect(() => {
    const el = document.querySelector(".action-bar");
    if (!el) return;
    const apply = () => setBottomInset(el.getBoundingClientRect().height + 8);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Чужие за столом: круг seatOrder, начиная с соседа слева от меня. Своё место — рука снизу.
  const tableOrder = seatOrder.length > 0 ? seatOrder : players.map((p) => p.id);
  const byId = new Map(players.map((p) => [p.id, p]));
  const seats: SeatView[] = seatsForViewer(tableOrder, room.sessionId)
    .map((id) => byId.get(id))
    .filter((p): p is RoomPlayer => !!p);
  const seatedIds = new Set(seats.map((s) => s.id));
  const deckZone = deckPlaceFor(deckLocation, room.sessionId, (id: string) => seatedIds.has(id)).zone;
  // Держатель колоды — только если это чужое место; своё — это рука.
  const deckHolder = deckZone === "seat" ? deckLocation : null;
  // Режим МОЕЙ руки: открытая — остальные видят её так же, как я; закрытая — оборотку.
  const handOpen = players.find((p) => p.id === room.sessionId)?.handOpen ?? false;

  const myReady = players.find((p) => p.id === room.sessionId)?.isReady ?? false;
  // В режиме раздачи колоду целиком не двигаем; иначе — дилер в лобби.
  const canMoveDeck = !dealMode && amIDealer && phase === "lobby";
  const canDeal = dealMode && amIDealer;

  const onDeckDrop = useCallback(
    (zone: "center" | "hand") => {
      if (!canMoveDeck) return;
      room.send("move_deck", { zone });
    },
    [canMoveDeck, room],
  );

  const onDeckDropToSeat = useCallback(
    (playerId: string) => {
      if (!canMoveDeck) return;
      room.send("move_deck", { zone: "player", targetId: playerId });
    },
    [canMoveDeck, room],
  );

  const onDealCard = useCallback(
    (card: string, to: string) => {
      if (!canDeal) return;
      room.send("deal_card", { card, to, rev: nextRev() });
    },
    [canDeal, room, nextRev],
  );

  const onDeckFanChange = useCallback(
    (open: boolean) => {
      if (!canDeal) return; // веер колоды на столе меняет только дилер
      setDeckFanned(open); // сразу, не ждём эхо
      room.send("set_deck_fanned", { open });
    },
    [canDeal, room],
  );

  const onCardReorder = useCallback(
    (card: string, to: number) => {
      if (dealMode) {
        // Рука: своя перестановка. Колода на столе: дилер двигает карту в веере.
        const handFrom = myHand.indexOf(card);
        if (handFrom >= 0) {
          const next = moveCard(myHand, card, to);
          room.send("set_hand_order", { order: next });
          setMyHand(next);
          return;
        }
        if (!canDeal) return;
        const deckFrom = deck.indexOf(card);
        if (deckFrom < 0) return;
        const next = moveCard(deck, card, to);
        room.send("set_deck_order", { order: next, rev: nextRev() });
        setDeck(next);
        return;
      }
      if (!canMoveDeck) return;
      room.send("reorder_deck", { card, to });
    },
    [dealMode, myHand, deck, canDeal, canMoveDeck, room, nextRev],
  );

  const onFlipDeck = useCallback(() => {
    if (!canMoveDeck) return;
    room.send("flip_deck", { rev: nextRev() });
  }, [canMoveDeck, room, nextRev]);

  const onFlipCards = useCallback(
    (cards: string[]) => {
      if (!canMoveDeck || cards.length === 0) return;
      room.send("flip_cards", { cards, rev: nextRev() });
    },
    [canMoveDeck, room, nextRev],
  );

  const onDeckFx = useCallback(
    (fx: DeckFxMessage) => {
      if (!canMoveDeck && !canDeal) return;
      room.send("deck_fx", fx);
    },
    [canMoveDeck, canDeal, room],
  );

  const sessionRef = useRef<ShuffleSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ShuffleSession();

  const onShuffleChange = useCallback(
    (order: string[]) => {
      if ((!canMoveDeck && !canDeal) || order.length === 0) return;
      const out = sessionRef.current!.push(order, Date.now());
      if (out.start) room.send("shuffle_start");
      if (out.send) room.send("set_deck_order", { order: out.send, rev: nextRev() });
    },
    [canMoveDeck, canDeal, room, nextRev],
  );

  // Автораздача: с соседа слева по часовой, по две карты каждому, 2 карты/сек,
  // пока колода не пуста или STOP. Берём верх и ждём эхо колоды.
  const pendingDealRef = useRef<string | null>(null);
  // Живой снимок стола для таймера автораздачи. Через ref, а не через зависимости эффекта:
  // колода и игроки меняются на КАЖДЫЙ патч состояния (каждая розданная карта — это патч),
  // и эффект пересоздавал бы интервал по нескольку раз в секунду. Тогда отсчёт всё время
  // начинался заново, и темп раздачи плавал вместе с сетью вместо заявленных 2 карт/с.
  const dealSnapshotRef = useRef({ deck, players, tableOrder });
  dealSnapshotRef.current = { deck, players, tableOrder };

  useEffect(() => {
    if (!autoDealing) {
      autoDealRef.current = null;
      pendingDealRef.current = null;
      return;
    }
    if (!amIDealer || !dealMode) {
      setAutoDealing(false);
      return;
    }

    // Кому раздаём: круг seatOrder, только готовые (+ дилер: он готов всегда).
    const targets = (): string[] => {
      const { players: ps, tableOrder: circle } = dealSnapshotRef.current;
      const ids = circle.filter((id) => {
        const p = ps.find((x) => x.id === id);
        return !!p?.connected && (p.isReady || p.isDealer || id === room.sessionId);
      });
      return dealOrder(ids, room.sessionId);
    };
    const accepts = (id: string): boolean => {
      if (id === room.sessionId) return true;
      const p = dealSnapshotRef.current.players.find((x) => x.id === id);
      return !!p?.isReady || !!p?.isDealer;
    };

    const id = setInterval(() => {
      const st = autoDealRef.current ?? { plan: [] as string[], i: 0 };
      autoDealRef.current = st;
      const live = dealSnapshotRef.current.deck;

      // Ждём, пока предыдущая карта исчезнет из колоды (эхо сервера): иначе следующий
      // тик возьмёт ту же верхнюю карту второй раз.
      if (pendingDealRef.current) {
        if (live.includes(pendingDealRef.current)) return;
        pendingDealRef.current = null;
      }
      if (live.length === 0) {
        setAutoDealing(false);
        return;
      }
      // План кончился, а карты ещё есть — достраиваем ещё круг.
      if (st.i >= st.plan.length) {
        const extra = autoDealPlan(targets(), live.length);
        if (extra.length === 0) {
          setAutoDealing(false);
          return;
        }
        st.plan.push(...extra);
      }
      // Снял «Готов» посреди автораздачи — пропускаем его.
      while (st.i < st.plan.length && !accepts(st.plan[st.i]!)) st.i += 1;
      if (st.i >= st.plan.length) {
        setAutoDealing(false);
        return;
      }
      const card = topCard(live);
      if (!card) {
        setAutoDealing(false);
        return;
      }
      room.send("deal_card", { card, to: st.plan[st.i]!, rev: nextRev() });
      pendingDealRef.current = card;
      st.i += 1;
    }, AUTO_DEAL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoDealing, amIDealer, dealMode, room, nextRev]);

  // Отказы сервера. Клиент показывает переворот сразу, оптимистично — значит, каждый
  // отказ обязан вернуть картинку к правде и сказать, почему так нельзя.
  useEffect(() => {
    let seq = 0;
    room.onMessage("action_rejected", (msg: { cards?: string[]; reason?: string }) => {
      // Сервер отказал — досылать накопленные изменения бессмысленно: они построены
      // поверх состояния, которого нет. Сессию обрываем, дальше правит правда с сервера.
      sessionRef.current?.cancel();
      setRejectedFlip({
        cards: Array.isArray(msg?.cards) ? msg.cards : [],
        text: rejectionText(String(msg?.reason ?? "")),
        seq: ++seq,
      });
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
      setAutoDealing(false);
      setSelection(clearSelection());
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

  // Тик сессии: отпускает накопленный прогресс и закрывает сессию финалом.
  useEffect(() => {
    const id = setInterval(() => {
      const out = sessionRef.current!.tick(Date.now());
      if (out.send) room.send("set_deck_order", { order: out.send, final: out.final, rev: nextRev() });
    }, 100);
    return () => clearInterval(id);
  }, [room]);

  const onDragChange = useCallback((active: boolean) => setDraggingDeck(active), []);

  const deckInCenter = deckZone === "center";
  const showDeckPlaceholder = !dealMode && phase === "lobby" && !deckInCenter && !draggingDeck;
  const showDeckTools = !dealMode && phase === "lobby" && amIDealer && !draggingDeck && (deckZone === "center" || deckZone === "hand");

  const bar = barActionsFor(selection, {
    deckZone,
    canMoveDeck,
    dealMode,
    amIDealer,
    autoDealing,
    myReady,
    myFanOpen: handFanOpen,
  });
  const runAction = useCallback(
    (id: BarActionId) => {
      if (id === "deck_to_hand") room.send("move_deck", { zone: "hand" });
      else if (id === "deck_to_center") room.send("move_deck", { zone: "center" });
      else if (id === "ready" || id === "unready") room.send("ready");
      else if (id === "shuffle") setShuffleSignal((v) => v + 1);
      else if (id === "auto_deal") setAutoDealing(true);
      else if (id === "auto_deal_stop") setAutoDealing(false);
    },
    [room],
  );
  const mainAction = bar.main ? { label: bar.main.label, onClick: () => runAction(bar.main!.id) } : undefined;
  const secondaryAction = bar.secondary
    ? {
        label: bar.secondary.label,
        onClick: () => runAction(bar.secondary!.id),
        disabled: bar.secondary.id === "wait",
      }
    : undefined;

  const menuItems: MenuItem[] = [];
  if (dealMode && amIDealer) {
    menuItems.push({ label: "Собрать все карты", onClick: () => room.send("collect_hands") });
    menuItems.push({
      label: "Сбросить колоду",
      onClick: () => {
        room.send("reset_deck");
      },
    });
  }
  if (handFanOpen && myHand.length > 1) {
    menuItems.push({
      label: "Сортировать по масти",
      onClick: () => {
        const order = sortBySuit(myHand);
        room.send("set_hand_order", { order });
        setMyHand(order);
      },
    });
    menuItems.push({
      label: "Сортировать по номиналу",
      onClick: () => {
        const order = sortByRank(myHand);
        room.send("set_hand_order", { order });
        setMyHand(order);
      },
    });
  }
  if (showDeckPlaceholder && amIDealer) {
    menuItems.push({ label: "↩ Вернуть колоду в центр", onClick: () => room.send("move_deck", { zone: "center" }) });
  }
  if (phase === "lobby") {
    menuItems.push({
      label: handOpen ? "🔓 Рука открыта" : "🔒 Рука закрыта",
      onClick: () => room.send("toggle_hand"),
    });
  }
  if (showDeckTools) {
    menuItems.push({ label: "Растасовать", onClick: () => setShuffleSignal((v) => v + 1) });
    if (!handFanOpen) {
      menuItems.push({ label: "🎴 Перевернуть колоду", onClick: () => setFlipSignal((v) => v + 1) });
    }
  }
  menuItems.push({ label: "🚪 Выйти в меню", onClick: onLeaveRoom });
  menuItems.push({ label: "⚙ Настройки", onClick: onOpenSettings });

  return (
    <div className="table-screen">
      <div className="table-topbar" ref={topbarRef}>
        {inviteCode && (
          <div className="table-badge">
            код: <span className="pixel-invite-code">{inviteCode}</span>
          </div>
        )}
        <div className="table-badge">{isPublic ? "🌐 паблик" : "🔒 приват"}</div>
        {/* Пока стол не нарисован, это единственный признак, что за ним кто-то есть. */}
        <div className="table-badge">
          за столом: {summary.total} · готовы: {summary.ready}
          {summary.bots > 0 && ` · 🤖 ${summary.bots}`}
        </div>
      </div>

      {proposal && (
        <ProposalBanner
          kind={proposal.kind}
          proposerName={proposerName}
          targetName={targetName}
          yesWeight={yesWeight}
          noWeight={noWeight}
          totalWeight={totalWeight}
          deadline={proposal.deadline}
          myVote={myVote}
          onVote={(value) => room.send("vote", { value })}
        />
      )}

      <RoomCanvas
        deck={deck}
        hand={myHand}
        seats={seats}
        deckHolder={deckHolder}
        onDeckDropToSeat={onDeckDropToSeat}
        selectedDecks={selectedDecks}
        onDeckTap={onDeckTap}
        onFanCollapse={onFanCollapse}
        onEmptyTap={onEmptyTap}
        topInset={topInset}
        bottomInset={bottomInset}
        deckZone={deckZone}
        deckDraggable={canMoveDeck}
        dealMode={dealMode}
        deckFanned={deckFanned}
        canDeal={canDeal}
        selfId={room.sessionId}
        selfReady={myReady}
        selfIsDealer={amIDealer}
        fourColor={fourColor}
        cardBack={cardBack}
        facing={facing}
        onFanChange={onFanChange}
        onFlipDeck={onFlipDeck}
        onFlipCards={onFlipCards}
        onDeckFx={onDeckFx}
        shuffleSignal={shuffleSignal}
        flipSignal={flipSignal}
        incomingFx={incomingFx}
        rejectedFlip={rejectedFlip}
        onDeckDrop={onDeckDrop}
        onDealCard={onDealCard}
        onDeckFanChange={onDeckFanChange}
        collectSignal={collectSignal}
        cardMovedSignal={cardMovedSignal}
        onCardReorder={onCardReorder}
        onShuffleChange={onShuffleChange}
        onDragChange={onDragChange}
        animation={animation}
      />

      {/* Панель действий: постоянный каркас из трёх слотов. Главный и второстепенный
          пока НЕ назначены — что в них появится, решится позже. Всё, что уже работает,
          живёт в слайд-ап меню гамбургера, чтобы ничего не потерять. */}
      <ActionBar main={mainAction} secondary={secondaryAction} menuItems={menuItems} />
    </div>
  );
}

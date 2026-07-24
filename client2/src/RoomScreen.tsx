import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import { ProposalBanner } from "./ProposalBanner";
import { ActionBar, type MenuItem } from "./ActionBar";
import { RoomCanvas } from "./game/RoomCanvas";
import type { CardBackId } from "./game/cardBack";
import type { FaceStyle } from "./game/engine/cardTextures";
import { tableSummary, type SeatView } from "./game/seats";
import { EMPTY_SELECTION, selectOnly, clearSelection, type Selection } from "./game/selection";
import { barActionsFor, type BarActionId } from "./game/barActions";
import { DECK_ID } from "./game/engine/constants";
import { ShuffleSession } from "./game/shuffleSession";
import type { DeckFxMessage } from "./game/deckFxClient";
import { moveCard } from "./game/deckOrder";
import { sortBySuit, sortByRank } from "./game/sortHand";
import { seatsForViewer } from "./game/seatOrder";
import { tallyVotes } from "./game/voteWeight";
import type { AnimationSettings } from "./game/anim/animationSettings";
import type { BoardPile } from "./game/engine/types";
import { playPileIndex } from "./game/engine/boardPile";
import type { RoomPlayer } from "./room/readState";
import { useRoomState } from "./room/useRoomState";
import { useRoomSignals } from "./room/useRoomSignals";
import { useInsets } from "./room/useInsets";
import { useAutoDeal } from "./room/useAutoDeal";
import { roomMenu, type MenuActionId } from "./room/roomMenu";

// Экран комнаты: собирает состояние (useRoomState), события (useRoomSignals), отступы
// HTML-панелей (useInsets) и автораздачу (useAutoDeal) и раздаёт всё это движку стола.
// Здесь остаются только решения «кто что может» и отправка сообщений на сервер.
export function RoomScreen({
  room,
  animation,
  fourColor,
  cardBack,
  faceStyle,
  onOpenSettings,
  onLeaveRoom,
}: {
  room: Room;
  animation: AnimationSettings;
  fourColor: boolean;
  cardBack: CardBackId;
  faceStyle: FaceStyle;
  onOpenSettings: () => void;
  onLeaveRoom: () => void;
}) {
  const state = useRoomState(room);
  const {
    players,
    seatOrder,
    inviteCode,
    isPublic,
    phase,
    proposal,
    deck,
    setDeck,
    discard,
    play,
    facing,
    myHand,
    applyMyHandOrder,
    freeMode,
    deckFanned,
    setDeckFanned,
    deckLocation,
    nextRev,
  } = state;

  const [draggingDeck, setDraggingDeck] = useState(false);
  const [handFanOpen, setHandFanOpen] = useState(false);
  // Веер доски в ИГРЕ — личный: его видит только тот, кто открыл, поэтому он живёт здесь,
  // а не в схеме. Стопка одна на доску: раскрывая сброс, сворачиваешь колоду и наоборот.
  // В раздаче веер общий, дилерский, и приходит с сервера (deckFanned).
  const [myBoardFan, setMyBoardFan] = useState<BoardPile | null>(null);
  const [shuffleSignal, setShuffleSignal] = useState(0);
  const [autoDealing, setAutoDealing] = useState(false);
  // Полный ремоунт канваса: сменой key React рушит старый движок (destroy) и поднимает
  // свежий, который заливает текущее состояние. Лечит редкие залипания движка/дропзон
  // без перезагрузки страницы (в PWA её и нет).
  const [canvasKey, setCanvasKey] = useState(0);
  // Выделение элементов стола. Тап выделяет, тап мимо — снимает; правила (что с чем
  // складывается и что чем сбрасывается) живут в selection.ts.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

  const sessionRef = useRef<ShuffleSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ShuffleSession();

  const stopAutoDeal = useCallback(() => setAutoDealing(false), []);
  const { noticeSignal, incomingFx, collectSignal, cardMovedSignal, shoutSignal, tauntSignal } = useRoomSignals(room, {
    // Сервер отказал — досылать накопленные изменения бессмысленно: они построены поверх
    // состояния, которого нет. Сессию обрываем, дальше правит правда с сервера.
    onRejected: () => sessionRef.current?.cancel(),
    onCollected: () => {
      stopAutoDeal();
      setSelection(clearSelection());
    },
  });

  const { topbarRef, topInset, bottomInset } = useInsets();

  const me = players.find((p) => p.id === room.sessionId);
  const amIDealer = me?.isDealer ?? false;
  const myReady = me?.isReady ?? false;
  // Режим МОЕЙ руки: открытая — остальные видят её так же, как я; закрытая — оборотку.
  const handOpen = me?.handOpen ?? false;
  const summary = tableSummary(players);

  // Расклад голосования показываем ТЕМИ ЖЕ весами, что считает сервер (см. voteWeight.ts).
  const tally = tallyVotes(players, proposal?.votes ?? {});
  const proposerName = players.find((p) => p.id === proposal?.proposerId)?.name || "?";
  const targetName = players.find((p) => p.id === proposal?.targetId)?.name || "?";
  const myVote = proposal ? proposal.votes[room.sessionId] : undefined;

  // Чужие за столом: круг seatOrder, начиная с соседа слева от меня. Своё место — рука снизу.
  const tableOrder = seatOrder.length > 0 ? seatOrder : players.map((p) => p.id);
  const byId = new Map(players.map((p) => [p.id, p]));
  const seats: SeatView[] = seatsForViewer(tableOrder, room.sessionId)
    .map((id) => byId.get(id))
    .filter((p): p is RoomPlayer => !!p);
  // Колода всегда лежит в центре стола: раздаёт её дилер по одной карте, а в свободе
  // игроки тянут себе сами. Переносить её целиком по зонам больше некому.
  //
  // Какой веер доски показывать: в игре — свой личный, в раздаче — общий дилерский.
  const boardFan: BoardPile | null = freeMode ? myBoardFan : deckFanned ? "deck" : null;

  // Личный веер живёт, только пока есть что держать веером: смена режима стола, пустая
  // стопка или унесённая со стола колода — и он сворачивается сам.
  const deckOnTable = deckLocation === "center";
  const fannedPlay = playPileIndex(myBoardFan);
  const fannedCount =
    fannedPlay !== null
      ? (play[fannedPlay]?.length ?? 0)
      : myBoardFan === "discard"
        ? discard.length
        : deck.length;
  // «Колода на столе» — условие только для веера КОЛОДЫ: кучки зоны и сброс живут своей
  // жизнью, и унесённая колода не повод сворачивать их.
  const fanNeedsDeck = myBoardFan === "deck";
  useEffect(() => {
    if (!freeMode || fannedCount === 0 || (fanNeedsDeck && !deckOnTable)) setMyBoardFan(null);
  }, [freeMode, fannedCount, deckOnTable, fanNeedsDeck]);

  // В свободе дилер перестаёт быть раздающим: вместе с раздачей у него пропадают тасовка,
  // веер колоды и всё остальное, что завязано на canDeal.
  const canDeal = amIDealer && !freeMode;

  useAutoDeal({
    room,
    active: autoDealing,
    stop: stopAutoDeal,
    amIDealer,
    freeMode,
    deck,
    players,
    tableOrder,
    nextRev,
  });

  // Тик сессии тасовки: отпускает накопленный прогресс и закрывает сессию финалом.
  useEffect(() => {
    const id = setInterval(() => {
      const out = sessionRef.current!.tick(Date.now());
      if (out.send) room.send("set_deck_order", { order: out.send, final: out.final, rev: nextRev() });
    }, 100);
    return () => clearInterval(id);
  }, [room, nextRev]);

  // ——— жесты стола → сервер ———

  // Тап по колоде только ВЫДЕЛЯЕТ её и никогда не снимает выделение: рука в фокусе ловит
  // тык и глиссандо, и переключающий тап сворачивал её посреди работы с картами.
  // Свернуть можно явно — стрелкой под веером, свайпом вниз или тапом мимо.
  // В режиме раздачи колоду в центре не выделяем вовсе — только руку.
  const onDeckTap = useCallback((deckId: string) => {
    if (deckId === DECK_ID) return;
    setSelection((sel) => selectOnly(sel, "deck", deckId));
  }, []);
  const onFanCollapse = useCallback(() => setSelection(clearSelection()), []);
  // Тап мимо всего — снять выделение и свернуть свой веер колоды: это явное «убери».
  const onEmptyTap = useCallback(() => {
    setSelection(clearSelection());
    setMyBoardFan(null);
  }, []);
  const selectedDecks = selection.type === "deck" ? selection.ids : [];

  // Веер своей руки → на сервер: остальные рисуют веер на моём месте.
  const onFanChange = useCallback(
    (fanned: boolean) => {
      setHandFanOpen(fanned);
      room.send("set_hand_fanned", { open: fanned });
    },
    [room],
  );

  const onDealCard = useCallback(
    (card: string, to: string) => {
      if (freeMode) {
        // Со стопки берут верхнюю (сервер решает сам), из раскрытого веера — карту с той
        // позиции, где её взял палец. Позицию считаем здесь: серверу идентификатор карты
        // не отправляем, хозяин позиции — он.
        if (to !== room.sessionId) return;
        const at = deck.indexOf(card);
        room.send("take_card", myBoardFan === "deck" && at >= 0 ? { index: at } : {});
        return;
      }
      if (!canDeal) return;
      room.send("deal_card", { card, to, rev: nextRev() });
    },
    [freeMode, canDeal, room, nextRev, deck, myBoardFan],
  );

  // Скинуть свою карту в сброс — можно только в игре (в раздаче слота нет).
  const onDiscardCard = useCallback(
    (card: string) => {
      if (!freeMode) return;
      room.send("discard_card", { card });
    },
    [freeMode, room],
  );

  const onDeckFanChange = useCallback(
    (open: boolean) => {
      // В раздаче веер общий, и менять его может только дилер (сервер проверяет сам).
      if (freeMode) return; // в игре веером доски заведует onBoardFanChange
      if (!canDeal) return;
      setDeckFanned(open); // сразу, не ждём эхо
      room.send("set_deck_fanned", { open });
    },
    [freeMode, canDeal, room, setDeckFanned],
  );

  // Выложить свою карту в игральную зону. stack === null — новой кучкой (карту уронили
  // мимо лежащих). Только в игре: в раздаче зоны на столе нет.
  const onPlayCard = useCallback(
    (card: string, stack: number | null) => {
      if (!freeMode) return;
      room.send("play_card", stack === null ? { card } : { card, stack });
    },
    [freeMode, room],
  );

  // Забрать карту из зоны себе в руку. По имени карты: зона открыта, игрок берёт то, что видит.
  const onTakePlay = useCallback(
    (card: string) => {
      if (!freeMode) return;
      room.send("take_play", { card });
    },
    [freeMode, room],
  );

  // «В СБРОС»: вся зона уезжает в сброс. Кнопка вшита в бокс зоны и доступна каждому.
  const onClearPlay = useCallback(() => {
    if (!freeMode) return;
    room.send("clear_play");
  }, [freeMode, room]);

  // Единое перемещение карты между боксами (drag-n-drop куда угодно). Сервер сам проверит
  // правила (в колоду/чужую руку нельзя), клиент только шлёт намерение.
  const onMoveCard = useCallback(
    (card: string, from: "deck" | "discard" | "play" | "hand", to: "discard" | "play" | "hand", toStack?: number) => {
      if (!freeMode) return;
      room.send("move_card", toStack === undefined ? { card, from, to } : { card, from, to, toStack });
    },
    [freeMode, room],
  );

  // Раскрыть/свернуть свою стопку на доске. Наружу ничего не шлём: веер личный.
  const onBoardFanChange = useCallback((pile: BoardPile | null) => setMyBoardFan(pile), []);

  // Забрать карту из сброса себе в руку. Сброс лежит лицом вверх — позиция честная.
  const onTakeDiscard = useCallback(
    (card: string) => {
      if (!freeMode) return;
      const at = discard.indexOf(card);
      room.send("take_discard", at >= 0 ? { index: at } : {});
    },
    [freeMode, discard, room],
  );

  const sendHandOrder = useCallback(
    (order: string[]) => {
      room.send("set_hand_order", { order });
      applyMyHandOrder(order);
    },
    [room, applyMyHandOrder],
  );

  // Рука: своя перестановка. Колода на столе: дилер двигает карту в раскрытом вееере.
  const onCardReorder = useCallback(
    (card: string, to: number) => {
      if (myHand.includes(card)) {
        sendHandOrder(moveCard(myHand, card, to));
        return;
      }
      if (!canDeal || !deck.includes(card)) return;
      const next = moveCard(deck, card, to);
      room.send("set_deck_order", { order: next, rev: nextRev() });
      setDeck(next);
    },
    [myHand, deck, canDeal, room, nextRev, setDeck, sendHandOrder],
  );

  const onDeckFx = useCallback(
    (fx: DeckFxMessage) => {
      if (!canDeal) return;
      room.send("deck_fx", fx);
    },
    [canDeal, room],
  );

  const onShuffleChange = useCallback(
    (order: string[]) => {
      if (!canDeal || order.length === 0) return;
      const out = sessionRef.current!.push(order, Date.now());
      if (out.start) room.send("shuffle_start");
      if (out.send) room.send("set_deck_order", { order: out.send, rev: nextRev() });
    },
    [canDeal, room, nextRev],
  );

  const onDragChange = useCallback((active: boolean) => setDraggingDeck(active), []);

  // ——— панель действий и меню ———

  const bar = barActionsFor(selection, {
    freeMode,
    deckCount: deck.length,
    amIDealer,
    myReady,
    myFanOpen: handFanOpen,
  });
  const runBarAction = useCallback(
    (id: BarActionId) => {
      if (id === "ready" || id === "unready") room.send("ready");
      else if (id === "shuffle") setShuffleSignal((v) => v + 1);
      else if (id === "go") room.send("go", {});
      // Кричалки — не действие над картами, а голос: сервер их только раздаёт (см.
      // server/src/taunt.ts), поэтому ни ревизии, ни оптимистичного показа тут нет —
      // свою кричалку автор увидит тем же путём, что и остальные, из ответа сервера.
      else if (id === "taunt_gkh") room.send("taunt", { kind: "gkh" });
      else if (id === "taunt_suck") room.send("taunt", { kind: "suck" });
    },
    [room],
  );
  const mainAction = bar.main ? { label: bar.main.label, onClick: () => runBarAction(bar.main!.id) } : undefined;
  const secondaryAction = bar.secondary
    ? {
        label: bar.secondary.label,
        onClick: () => runBarAction(bar.secondary!.id),
        disabled: bar.secondary.id === "wait",
      }
    : undefined;

  const runMenuAction = (id: MenuActionId) => {
    if (id === "redeal" || id === "collect_hands") room.send("collect_hands");
    else if (id === "reset_deck") room.send("reset_deck");
    else if (id === "auto_deal") setAutoDealing(true);
    else if (id === "auto_deal_stop") setAutoDealing(false);
    else if (id === "sort_suit") sendHandOrder(sortBySuit(myHand));
    else if (id === "sort_rank") sendHandOrder(sortByRank(myHand));
    else if (id === "toggle_hand") room.send("toggle_hand");
    else if (id === "leave") onLeaveRoom();
    else if (id === "settings") onOpenSettings();
  };
  const menuItems: MenuItem[] = roomMenu({
    freeMode,
    amIDealer,
    autoDealing,
    phase,
    handFanOpen,
    handSize: myHand.length,
    handOpen,
  }).map((entry) => ({ label: entry.label, onClick: () => runMenuAction(entry.id) }));

  return (
    <div className="table-screen">
      <div className="table-topbar" ref={topbarRef}>
        {inviteCode && (
          <div className="table-badge">
            код: <span className="pixel-invite-code">{inviteCode}</span>
          </div>
        )}
        <div className="table-badge">{isPublic ? "🌐 паблик" : "🔒 приват"}</div>
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
          yesWeight={tally.yes}
          noWeight={tally.no}
          totalWeight={tally.total}
          deadline={proposal.deadline}
          myVote={myVote}
          onVote={(value) => room.send("vote", { value })}
        />
      )}

      {/* Неприметная кнопка «пересобрать стол» — всегда в углу поверх канваса. */}
      <button
        className="canvas-reload"
        onClick={() => setCanvasKey((k) => k + 1)}
        aria-label="Пересобрать стол"
        title="Пересобрать стол"
      >
        ⟳
      </button>

      <RoomCanvas
        // Смена ЛЮБОЙ настройки графики пересобирает канвас целиком (как кнопка ⟳): свежий
        // движок применяет настройку с чистого листа, без риска залипшего состояния. Плюс
        // ручной счётчик canvasKey от кнопки ремоунта.
        key={`${canvasKey}|${animation.level}|${animation.speed}|${animation.shadows}|${fourColor}|${cardBack}|${faceStyle}`}
        deck={deck}
        hand={myHand}
        discard={discard}
        play={play}
        seats={seats}
        selectedDecks={selectedDecks}
        onDeckTap={onDeckTap}
        onFanCollapse={onFanCollapse}
        onEmptyTap={onEmptyTap}
        topInset={topInset}
        bottomInset={bottomInset}
        freeMode={freeMode}
        boardFan={boardFan}
        canDeal={canDeal}
        selfId={room.sessionId}
        selfReady={myReady}
        selfIsDealer={amIDealer}
        fourColor={fourColor}
        cardBack={cardBack}
        faceStyle={faceStyle}
        facing={facing}
        onFanChange={onFanChange}
        onDeckFx={onDeckFx}
        shuffleSignal={shuffleSignal}
        incomingFx={incomingFx}
        noticeSignal={noticeSignal}
        shoutSignal={shoutSignal}
        tauntSignal={tauntSignal}
        onDealCard={onDealCard}
        onDiscardCard={onDiscardCard}
        onTakeDiscard={onTakeDiscard}
        onPlayCard={onPlayCard}
        onTakePlay={onTakePlay}
        onClearPlay={onClearPlay}
        onMoveCard={onMoveCard}
        onBoardFanChange={onBoardFanChange}
        onDeckFanChange={onDeckFanChange}
        collectSignal={collectSignal}
        cardMovedSignal={cardMovedSignal}
        onCardReorder={onCardReorder}
        onShuffleChange={onShuffleChange}
        onDragChange={onDragChange}
        animation={animation}
      />

      {/* Панель действий: постоянный каркас из трёх слотов — главное действие,
          второстепенное и гамбургер с остальным (см. roomMenu.ts). */}
      <ActionBar main={mainAction} secondary={secondaryAction} menuItems={menuItems} />
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import { ProposalBanner } from "./ProposalBanner";
import { ActionBar, type MenuItem } from "./ActionBar";
import { RoomCanvas } from "./game/RoomCanvas";
import type { CardBackId } from "./game/cardBack";
import { deckPlaceFor } from "./game/deckZone";
import { tableSummary, type SeatView } from "./game/seats";
import { EMPTY_SELECTION, toggleSelection, clearSelection, type Selection } from "./game/selection";
import { barActionsFor, type BarActionId } from "./game/barActions";
import { DECK_ID } from "./game/RoomEngine";
import { ShuffleSession } from "./game/shuffleSession";
import { FxClock, shouldPlayFx, type DeckFxMessage, type DeckFxIncoming } from "./game/deckFxClient";
import { rejectionText } from "./game/rejections";
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
  handOpen: boolean; // рука открыта — остальные видят её так же, как сам игрок
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
  const [inviteCode, setInviteCode] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "playing" | "finished">("lobby");
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const [deck, setDeck] = useState<string[]>([]);
  // Где лежит колода по мнению сервера ("center" или id держателя). В зону для движка
  // переводим ниже — для этого нужно знать, кто сейчас сидит за столом.
  const [deckLocation, setDeckLocation] = useState<string>("center");
  // Где именно у держателя: "hand" или "safe0..2" (см. deckZone.ts).
  const [deckSlot, setDeckSlot] = useState<string>("");
  const [draggingDeck, setDraggingDeck] = useState(false);
  // Сторона каждой карты приходит из состояния — это правда, а не локальный тумблер.
  const [facing, setFacing] = useState<Record<string, boolean>>({});
  const [fanned, setFanned] = useState(false); // веер раскрыт (кнопки переворота тогда нет)
  const [shuffleSignal, setShuffleSignal] = useState(0);
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
          handOpen: !!p.handOpen,
        });
      });
      setPlayers(list);
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
      setDeckSlot(room.state.deckSlot ?? "");

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
  const onDeckTap = useCallback((deckId: string) => {
    setSelection((sel) => toggleSelection(sel, "deck", deckId));
  }, []);
  const onEmptyTap = useCallback(() => setSelection(clearSelection()), []);
  const selectedDecks = selection.type === "deck" ? selection.ids : [];

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

  // Чужие игроки — те, кого рисуем за столом (посадка «П»). Своё место не рисуем:
  // низ экрана — мои сейф-зона и рука.
  const seats: SeatView[] = players.filter((p) => p.id !== room.sessionId);
  const seatedIds = new Set(seats.map((s) => s.id));
  const deckZone = deckPlaceFor(deckLocation, deckSlot, room.sessionId, (id: string) => seatedIds.has(id)).zone;
  // Держатель колоды — только если это чужое место; своё — это рука или сейф.
  const deckHolder = deckZone === "seat" ? deckLocation : null;
  // Режим МОЕЙ руки: открытая — остальные видят её так же, как я; закрытая — оборотку.
  const handOpen = players.find((p) => p.id === room.sessionId)?.handOpen ?? false;

  // Колоду двигает только дилер и только в лобби (во время раздачи).
  const canMoveDeck = amIDealer && phase === "lobby";

  // Драг-н-дроп: колода брошена в дроп-зону — шлём её на сервер (там валидируется).
  const onDeckDrop = useCallback(
    (zone: "center" | "hand" | "safe") => {
      if (!canMoveDeck) return;
      // Целиться в конкретное место сейфа не нужно: колоды раскладываются там сами.
      room.send("move_deck", { zone });
    },
    [canMoveDeck, room],
  );

  // Колоду бросили на место игрока (его зона — прямоугольная дроп-зона): отдаём колоду ему.
  const onDeckDropToSeat = useCallback(
    (playerId: string) => {
      if (!canMoveDeck) return;
      room.send("move_deck", { zone: "player", targetId: playerId });
    },
    [canMoveDeck, room],
  );

  // Карту перетащили внутри раскрытого веера — новый порядок колоды на сервер.
  const onCardReorder = useCallback(
    (card: string, to: number) => {
      if (!canMoveDeck) return;
      room.send("reorder_deck", { card, to });
    },
    [canMoveDeck, room],
  );

  // Перевороты: на сервер уходит только РЕЗУЛЬТАТ (что перевернулось), анимации живут
  // на клиенте. Состояние вернётся схемой и перекроет любую местную оптимистичность.
  const onFlipDeck = useCallback(() => {
    if (!canMoveDeck) return;
    room.send("flip_deck", { rev: nextRev() });
  }, [canMoveDeck, room]);

  const onFlipCards = useCallback(
    (cards: string[]) => {
      if (!canMoveDeck || cards.length === 0) return;
      room.send("flip_cards", { cards, rev: nextRev() });
    },
    [canMoveDeck, room],
  );

  // Эффект для остальных игроков — украшение. Сервер раздаст его с длительностью, которую
  // видел дилер, чтобы у всех жест выглядел одинаково независимо от пинга.
  const onDeckFx = useCallback(
    (fx: DeckFxMessage) => {
      if (!canMoveDeck) return;
      room.send("deck_fx", fx);
    },
    [canMoveDeck, room],
  );

  // Сетевой протокол ЛЮБОЙ тасовки (кнопка, свайп, будущие жесты). Порядок считает и
  // анимирует клиент, а сюда он приходит готовым: открываем сессию (shuffle_start),
  // шлём прогресс не чаще пары раз в секунду и обязательный финал по затишью — им же
  // на сервере снимается «замок» колоды. Логика сессии — в ShuffleSession (тестируется).
  const sessionRef = useRef<ShuffleSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ShuffleSession();

  const onShuffleChange = useCallback(
    (order: string[]) => {
      if (!canMoveDeck || order.length === 0) return;
      const out = sessionRef.current!.push(order, Date.now());
      if (out.start) room.send("shuffle_start");
      if (out.send) room.send("set_deck_order", { order: out.send, rev: nextRev() });
    },
    [canMoveDeck, room],
  );

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

  // Тик сессии: отпускает накопленный прогресс и закрывает сессию финалом.
  useEffect(() => {
    const id = setInterval(() => {
      const out = sessionRef.current!.tick(Date.now());
      if (out.send) room.send("set_deck_order", { order: out.send, final: out.final, rev: nextRev() });
    }, 100);
    return () => clearInterval(id);
  }, [room]);

  const onDragChange = useCallback((active: boolean) => setDraggingDeck(active), []);

  // «Готов/Раздать» — только когда колода в центре и не идёт драг. Вне центра — плейсхолдер.
  const deckInCenter = deckZone === "center";
  const showCenterActions = phase === "lobby" && deckInCenter && !draggingDeck;
  const showDeckPlaceholder = phase === "lobby" && !deckInCenter && !draggingDeck;
  // Инструменты колоды (Растасовать/Перевернуть) — доступны дилеру, ПОКА КОЛОДА У МЕНЯ
  // (стол, рука или сейф), не во время драга.
  const deckIsMine = deckZone === "center" || deckZone === "hand" || deckZone === "safe";
  const showDeckTools = phase === "lobby" && amIDealer && !draggingDeck && deckIsMine;

  // Кнопки панели перестраиваются под выделенное (см. barActions.ts). Панель ничего
  // не знает про колоды — она показывает то, что ей дали.
  const bar = barActionsFor(selection, { deckZone, canMoveDeck });
  const runAction = useCallback(
    (id: BarActionId) => {
      if (id === "deck_to_hand") room.send("move_deck", { zone: "hand" });
      else if (id === "deck_to_safe") room.send("move_deck", { zone: "safe" });
      else if (id === "deck_to_center") room.send("move_deck", { zone: "center" });
    },
    [room],
  );
  const mainAction = bar.main ? { label: bar.main.label, onClick: () => runAction(bar.main!.id) } : undefined;
  const secondaryAction = bar.secondary
    ? { label: bar.secondary.label, onClick: () => runAction(bar.secondary!.id) }
    : undefined;

  // Пункты слайд-ап меню. Здесь же будут настройки и выход — пока то, что уже умеет
  // комната. Список собирается по состоянию: недоступное просто не показываем.
  const menuItems: MenuItem[] = [];
  if (showCenterActions) {
    menuItems.push({ label: "Готов", onClick: () => room.send("ready") });
    if (amIDealer) menuItems.push({ label: "Раздать", onClick: () => room.send("start_game") });
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
    if (!fanned) {
      menuItems.push({ label: "🎴 Перевернуть колоду", onClick: () => setFlipSignal((v) => v + 1) });
    }
  }
  // Веер растёт вверх, поэтому последние в списке — самые верхние пункты.
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
        seats={seats}
        deckHolder={deckHolder}
        onDeckDropToSeat={onDeckDropToSeat}
        selectedDecks={selectedDecks}
        onDeckTap={onDeckTap}
        onEmptyTap={onEmptyTap}
        topInset={topInset}
        bottomInset={bottomInset}
        deckZone={deckZone}
        deckDraggable={canMoveDeck}
        fourColor={fourColor}
        cardBack={cardBack}
        facing={facing}
        onFanChange={setFanned}
        onFlipDeck={onFlipDeck}
        onFlipCards={onFlipCards}
        onDeckFx={onDeckFx}
        shuffleSignal={shuffleSignal}
        flipSignal={flipSignal}
        incomingFx={incomingFx}
        rejectedFlip={rejectedFlip}
        onDeckDrop={onDeckDrop}
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

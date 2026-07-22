import { useCallback, useEffect, useRef, useState } from "react";
import { Room } from "colyseus.js";
import { ProposalBanner } from "./ProposalBanner";
import { RoomCanvas } from "./game/RoomCanvas";
import type { CardBackId } from "./game/cardBack";
import { deckZoneFor, type DeckZone } from "./game/deckZone";
import { ShuffleSession } from "./game/shuffleSession";
import { FxClock, shouldPlayFx, type DeckFxMessage, type DeckFxIncoming } from "./game/deckFxClient";
import { rejectionText } from "./game/rejections";
import type { AnimationSettings } from "./game/anim/animationSettings";

interface RoomPlayer {
  id: string;
  name: string;
  isDealer: boolean;
  connected: boolean;
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
}: {
  room: Room;
  animation: AnimationSettings;
  fourColor: boolean;
  cardBack: CardBackId;
}) {
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [inviteCode, setInviteCode] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [phase, setPhase] = useState<"lobby" | "playing" | "finished">("lobby");
  const [proposal, setProposal] = useState<ActiveProposal | null>(null);
  const [deck, setDeck] = useState<string[]>([]);
  const [deckZone, setDeckZone] = useState<DeckZone>("center");
  const [draggingDeck, setDraggingDeck] = useState(false);
  // Сторона каждой карты приходит из состояния — это правда, а не локальный тумблер.
  const [facing, setFacing] = useState<Record<string, boolean>>({});
  const [fanned, setFanned] = useState(false); // веер раскрыт (кнопки переворота тогда нет)
  const [shuffleSignal, setShuffleSignal] = useState(0);
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
          connected: p.connected,
        });
      });
      setPlayers(list);
      setInviteCode(room.state.inviteCode);
      setIsPublic(room.state.isPublic);
      setPhase(room.state.phase);
      setDeck(room.state.deck ? [...room.state.deck] : []);
      const nextFacing: Record<string, boolean> = {};
      room.state.faceUp?.forEach((up: boolean, card: string) => (nextFacing[card] = up));
      setFacing(nextFacing);
      setDeckZone(deckZoneFor(room.state.deckLocation ?? "center", room.sessionId));

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

  // Колоду двигает только дилер и только в лобби (во время раздачи).
  const canMoveDeck = amIDealer && phase === "lobby";

  // Дабл-клик по колоде: быстрый тоггл центр ⇄ своя сейф-зона.
  const onDeckDoubleClick = useCallback(() => {
    if (!canMoveDeck) return;
    room.send("move_deck", { zone: deckZone === "safe" ? "center" : "safe" });
  }, [canMoveDeck, deckZone, room]);

  // Драг-н-дроп: колода брошена в дроп-зону — шлём её на сервер (там валидируется).
  const onDeckDrop = useCallback(
    (zone: "center" | "safe") => {
      if (!canMoveDeck) return;
      room.send("move_deck", { zone });
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
    room.send("flip_deck");
  }, [canMoveDeck, room]);

  const onFlipCards = useCallback(
    (cards: string[]) => {
      if (!canMoveDeck || cards.length === 0) return;
      room.send("flip_cards", { cards });
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
      if (out.send) room.send("set_deck_order", { order: out.send });
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
      if (out.send) room.send("set_deck_order", { order: out.send, final: out.final });
    }, 100);
    return () => clearInterval(id);
  }, [room]);

  const onDragChange = useCallback((active: boolean) => setDraggingDeck(active), []);

  // «Готов/Раздать» — только когда колода в центре и не идёт драг. Вне центра — плейсхолдер.
  const deckInCenter = deckZone === "center";
  const showCenterActions = phase === "lobby" && deckInCenter && !draggingDeck;
  const showDeckPlaceholder = phase === "lobby" && !deckInCenter && !draggingDeck;
  // Инструменты колоды (Растасовать/Перевернуть) — доступны дилеру, ПОКА ЕСТЬ КОЛОДА
  // (центр или своя сейф-зона), не во время драга. Позже так же — для сброса/второй колоды.
  const deckIsMine = deckZone === "center" || deckZone === "safe";
  const showDeckTools = phase === "lobby" && amIDealer && !draggingDeck && deckIsMine;

  return (
    <div className="table-screen">
      <div className="table-topbar">
        {inviteCode && (
          <div className="table-badge">
            код: <span className="pixel-invite-code">{inviteCode}</span>
          </div>
        )}
        <div className="table-badge">{isPublic ? "🌐 паблик" : "🔒 приват"}</div>
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
        onDeckDoubleClick={onDeckDoubleClick}
        onDeckDrop={onDeckDrop}
        onCardReorder={onCardReorder}
        onShuffleChange={onShuffleChange}
        onDragChange={onDragChange}
        animation={animation}
      />

      <div className="table-bottombar">
        {showCenterActions && (
          <>
            <button className="pixel-btn" onClick={() => room.send("ready")}>
              Готов
            </button>
            {amIDealer && (
              <button className="pixel-btn pixel-btn-secondary" onClick={() => room.send("start_game")}>
                Раздать
              </button>
            )}
          </>
        )}

        {/* Колода вне центра — тут будут свои кнопки зоны; пока плейсхолдер-возврат. */}
        {showDeckPlaceholder && amIDealer && (
          <button className="pixel-btn pixel-btn-secondary" onClick={() => room.send("move_deck", { zone: "center" })}>
            ↩ Вернуть колоду в центр
          </button>
        )}

        {/* Инструменты колоды — доступны, пока есть колода (центр/сейф). */}
        {showDeckTools && (
          <>
            <button
              className="pixel-btn pixel-btn-secondary"
              // Тасует движок (порядок + анимация), сеть узнаёт через onShuffleChange.
              onClick={() => setShuffleSignal((s) => s + 1)}
            >
              Растасовать
            </button>
            {/* Переворот кнопкой — только пока колода НЕ раскрыта веером: в вее­ре карты
                переворачиваются жестами, и это осознанно сложнее. */}
            {!fanned && (
              <button className="pixel-btn pixel-btn-secondary" onClick={() => setFlipSignal((v) => v + 1)}>
                🎴 Перевернуть колоду
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

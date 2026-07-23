import { useEffect, useRef } from "react";
import { RoomEngine } from "./RoomEngine";
import { resolveProfile } from "./anim/animationSettings";
import { seatsSignature } from "./seats";
import { applyAllToEngine, type EngineProps } from "./engineProps";
import { useEngineEffect } from "./useEngineEffect";

// Тонкий React-хост движка стола: монтирует его один раз и потом только пересылает
// пропсы сеттерами. Своей логики и своего состояния здесь нет — вся картинка живёт в
// RoomEngine (см. CLAUDE.md, «Table architecture»).
export function RoomCanvas(props: EngineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<RoomEngine | null>(null);

  // Свежие пропсы для монтирования: пока идёт await init, они успевают уехать.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const engine = new RoomEngine();
    engineRef.current = engine;
    const rect = wrap.getBoundingClientRect();
    void engine.mount(wrap, rect.width, rect.height).then(() => {
      // Нас успели размонтировать (StrictMode монтирует эффект дважды) — сцены уже нет.
      if (engineRef.current !== engine) return;
      applyAllToEngine(engine, latest.current);
    });

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      engine.resize(cr.width, cr.height);
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // ——— состояние стола ———
  // Списки карт и мест сравниваем по подписи: RoomScreen пересобирает эти массивы на
  // каждый патч состояния, и сравнение по ссылке дёргало бы движок вхолостую.
  const e = engineRef;
  useEngineEffect(e, (en) => en.setDeck(props.deck), [props.deck.join(",")]);
  useEngineEffect(e, (en) => en.setHand(props.hand), [props.hand.join(",")]);
  useEngineEffect(e, (en) => en.setSeats(props.seats), [seatsSignature(props.seats)]);
  useEngineEffect(e, (en) => en.setSelectedDecks(props.selectedDecks), [props.selectedDecks.join(",")]);
  useEngineEffect(e, (en) => en.setDeckZone(props.deckZone), [props.deckZone]);
  useEngineEffect(e, (en) => en.setDeckHolder(props.deckHolder), [props.deckHolder]);
  useEngineEffect(e, (en) => en.setDealMode(props.dealMode), [props.dealMode]);
  useEngineEffect(e, (en) => en.setFreeMode(props.freeMode), [props.freeMode]);
  useEngineEffect(e, (en) => en.setDeckFanned(props.deckFanned), [props.deckFanned]);
  useEngineEffect(e, (en) => en.setCanDeal(props.canDeal), [props.canDeal]);
  useEngineEffect(e, (en) => en.setSelfId(props.selfId), [props.selfId]);
  useEngineEffect(
    e,
    (en) => en.setSelfDealState(props.selfReady, props.selfIsDealer),
    [props.selfReady, props.selfIsDealer],
  );
  useEngineEffect(e, (en) => en.setTopInset(props.topInset), [props.topInset]);
  useEngineEffect(e, (en) => en.setBottomInset(props.bottomInset), [props.bottomInset]);
  useEngineEffect(e, (en) => en.setFourColor(props.fourColor), [props.fourColor]);
  useEngineEffect(e, (en) => en.setCardBack(props.cardBack), [props.cardBack]);
  useEngineEffect(e, (en) => en.setCardFacing(props.facing), [props.facing]);
  // Право менять колоду локально и быть источником правды — одно и то же условие.
  useEngineEffect(
    e,
    (en) => {
      en.setDeckDraggable(props.deckDraggable);
      en.setAuthoritative(props.deckDraggable || props.canDeal);
    },
    [props.deckDraggable, props.canDeal],
  );
  useEngineEffect(
    e,
    (en) => en.setAnimationProfile(resolveProfile(props.animation)),
    [props.animation.level, props.animation.speed, props.animation.shadows],
  );

  // ——— жесты стола наверх ———
  useEngineEffect(e, (en) => en.setOnDeckTap(props.onDeckTap), [props.onDeckTap]);
  useEngineEffect(e, (en) => en.setOnEmptyTap(props.onEmptyTap), [props.onEmptyTap]);
  useEngineEffect(e, (en) => en.setOnDeckDrop(props.onDeckDrop), [props.onDeckDrop]);
  useEngineEffect(e, (en) => en.setOnDeckDropToSeat(props.onDeckDropToSeat), [props.onDeckDropToSeat]);
  useEngineEffect(e, (en) => en.setOnDealCard(props.onDealCard), [props.onDealCard]);
  useEngineEffect(e, (en) => en.setOnDeckFanChange(props.onDeckFanChange), [props.onDeckFanChange]);
  useEngineEffect(e, (en) => en.setOnCardReorder(props.onCardReorder), [props.onCardReorder]);
  useEngineEffect(e, (en) => en.setOnShuffleChange(props.onShuffleChange), [props.onShuffleChange]);
  useEngineEffect(e, (en) => en.setOnFanChange(props.onFanChange), [props.onFanChange]);
  useEngineEffect(e, (en) => en.setOnFanCollapse(props.onFanCollapse), [props.onFanCollapse]);
  useEngineEffect(e, (en) => en.setOnFlipDeck(props.onFlipDeck), [props.onFlipDeck]);
  useEngineEffect(e, (en) => en.setOnFlipCards(props.onFlipCards), [props.onFlipCards]);
  useEngineEffect(e, (en) => en.setOnDeckFx(props.onDeckFx), [props.onDeckFx]);
  useEngineEffect(e, (en) => en.setOnDragChange(props.onDragChange), [props.onDragChange]);

  // ——— разовые события: «сыграй это» ———
  useEngineEffect(e, (en) => props.shuffleSignal > 0 && en.shuffleAll(), [props.shuffleSignal]);
  useEngineEffect(e, (en) => props.flipSignal > 0 && en.flipDeckByButton(), [props.flipSignal]);
  useEngineEffect(
    e,
    (en) => props.rejectedFlip && en.rejectFlip(props.rejectedFlip.cards, props.rejectedFlip.text),
    [props.rejectedFlip],
  );
  useEngineEffect(
    e,
    (en) => props.noticeSignal && en.showRejectNotice(props.noticeSignal.text),
    [props.noticeSignal],
  );
  useEngineEffect(e, (en) => props.shoutSignal && en.playShout(), [props.shoutSignal]);
  useEngineEffect(e, (en) => props.incomingFx && en.playFx(props.incomingFx), [props.incomingFx]);
  useEngineEffect(
    e,
    (en) => props.collectSignal && en.playCollectAnim(props.collectSignal.order, props.collectSignal.counts),
    [props.collectSignal],
  );
  useEngineEffect(
    e,
    (en) => props.cardMovedSignal && en.playCardMoved(props.cardMovedSignal.moves),
    [props.cardMovedSignal],
  );

  return <div className="room-canvas" ref={wrapRef} />;
}

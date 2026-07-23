import { isPermutationOf } from "../deckOrder.js";
import {
  collectHands,
  collectOrder,
  dealCardTo,
  discardCard,
  putCardToDeck,
  takeAllCards,
  takeCardAt,
  takeTopCard,
} from "../handRules.js";
import { playCards } from "../playRules.js";
import {
  clearAllHands,
  handsSnapshot,
  playStacks,
  writeDeck,
  writeDiscard,
  writeFacing,
  writeHand,
  writePlay,
} from "../stateWrite.js";
import type { MessageRoom } from "./host.js";

// Сообщения про РУКИ: раздача карты, свой порядок, открыть/закрыть, веер, спрятать
// карту, сбор всех карт обратно в колоду.

export function registerHandMessages(room: MessageRoom): void {
  const state = room.state;

  // Раздача одной карты (DnD верхней с центра / автораздача). Только дилер. Карта
  // уходит из колоды в руку игрока; получатель сразу видит номинал (см. handView.ts —
  // свою руку владелец видит всегда).
  room.onMessage("deal_card", (client, message: { card?: string; to?: string; rev?: number }) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer) return;
    // Режим свободы: карты берут сами (take_card), в чужие руки не кладёт никто, включая
    // дилера. Отвечаем отказом, а не молчанием: карта уже летит с пальца, и игрок должен
    // увидеть, ПОЧЕМУ она отскочила.
    if (state.freeMode) {
      client.send("action_rejected", { action: "deal_card", reason: "free_mode", cards: [] });
      return;
    }
    const card = message?.card;
    const to = message?.to;
    if (typeof card !== "string" || typeof to !== "string") return;
    const target = state.players.get(to);
    if (!target) return;
    // Дроп-зона — кнопкой «Готов»; дилер всегда готов (и себе, и как цель).
    if (!target.isReady && !target.isDealer) return;
    const out = dealCardTo(state.deck.toArray(), card);
    if (!out) return;
    if (!room.acceptRev(message?.rev)) return;
    writeDeck(state, out.deck);
    state.faceUp.delete(card);
    target.hand.push(card);
    if (state.deck.length === 0) state.deckFanned = false; // раздали всё — веера нет
    // Всем клиентам — анимация полёта (дилер, уже летящий с пальца, пропустит дубль).
    room.broadcast("card_moved", { moves: [{ card, from: "deck", to }] });
  });

  // Режим свободы: игрок сам тянет карту со стола. Разрешено ЛЮБОМУ за столом — ролей тут
  // нет, дилер такой же игрок.
  //
  // Без index — верхняя карта (драг по закрытой колоде). С index — карта на этой позиции:
  // так тянут из раскрытого веера. Позиция, а не идентификатор карты: хозяин того, что
  // лежит на позиции, — сервер.
  //
  // ЧЕСТНО про «вслепую»: state.deck едет клиентам ЦЕЛИКОМ, поэтому слепота здесь —
  // свойство интерфейса, а не защита. Клиент технически знает порядок колоды и может
  // выбрать позицию с нужной картой. Настоящее сокрытие потребует слать наружу только
  // длину колоды и обезличенные позиции — это отдельная большая работа, и она не сделана.
  //
  // Конфликт двух одновременных «тянучек» решается порядком прихода сообщений: Colyseus
  // обрабатывает их последовательно, поэтому первый снимает свою карту, второй — из уже
  // изменившейся колоды (или не получает ничего на опустевшей). Никакой очереди и никаких
  // блокировок для этого не нужно — только не заводить здесь асинхронности.
  room.onMessage("take_card", (client, message: { index?: number }) => {
    const player = state.players.get(client.sessionId);
    if (!player || !state.freeMode) return;
    if (state.deckLocation !== "center") return; // колода унесена со стола — тянуть неоткуда
    const deck = state.deck.toArray();
    const out = message?.index === undefined ? takeTopCard(deck) : takeCardAt(deck, message.index);
    if (!out) return;
    writeDeck(state, out.deck);
    state.faceUp.delete(out.card);
    player.hand.push(out.card);
    if (state.deck.length === 0) state.deckFanned = false; // разобрали всё — веера нет
    // Ревизию двигаем: иначе клиент, чей номер уже выше, счёл бы это эхо устаревшим и
    // не показал бы, что карты в колоде убавилось.
    state.deckRev += 1;
    room.broadcast("card_moved", { moves: [{ card: out.card, from: "deck", to: client.sessionId }] });
  });

  // «Забрать все»: игрок сгребает со стола всю оставшуюся колоду. Права те же, что у
  // take_card — в свободе стол общий, и грести с него может любой.
  room.onMessage("take_all", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player || !state.freeMode) return;
    if (state.deckLocation !== "center") return;
    const out = takeAllCards(state.deck.toArray());
    if (!out) return;
    writeDeck(state, out.deck);
    for (const card of out.cards) {
      state.faceUp.delete(card);
      player.hand.push(card);
    }
    state.deckFanned = false; // со стола унесли всё — веера нет
    state.deckRev += 1;
    room.broadcast("card_moved", {
      moves: out.cards.map((card) => ({ card, from: "deck", to: client.sessionId })),
    });
  });

  // Скинуть карту из руки в сброс. Только своя карта и только в игре: в раздаче скидывать
  // некуда — стол ещё не размечен. Сброшенная карта ложится ЛИЦОМ ВВЕРХ: её уже сыграли.
  room.onMessage("discard_card", (client, message: { card?: string }) => {
    const player = state.players.get(client.sessionId);
    const card = message?.card;
    if (!player || !state.freeMode || typeof card !== "string") return;
    const out = discardCard(player.hand.toArray(), state.discard.toArray(), card);
    if (!out) return;
    writeHand(player, out.hand);
    writeDiscard(state, out.discard);
    state.faceUp.set(card, true);
    room.broadcast("card_moved", { moves: [{ card, from: client.sessionId, to: "discard" }] });
  });

  // Забрать карту ИЗ СБРОСА себе в руку. Сброс лежит лицом вверх и виден всем, поэтому
  // тут никакой слепоты нет — игрок берёт ровно то, что видит. Позиция считается так же,
  // как у колоды: без index — верхняя карта сброса.
  room.onMessage("take_discard", (client, message: { index?: number }) => {
    const player = state.players.get(client.sessionId);
    if (!player || !state.freeMode) return;
    const pile = state.discard.toArray();
    const out = message?.index === undefined ? takeTopCard(pile) : takeCardAt(pile, message.index);
    if (!out) return;
    writeDiscard(state, out.deck);
    state.faceUp.delete(out.card); // карта ушла в руку — сторона решается рукой
    player.hand.push(out.card);
    room.broadcast("card_moved", { moves: [{ card: out.card, from: "discard", to: client.sessionId }] });
  });

  // Положить карту из руки обратно в колоду. Разрешено ВСЕМ, но только в раздаче: там
  // колода — общий инвентарь стола, из неё раздают и в неё возвращают лишнее. В игре
  // колода закрыта: карты из неё только берут, иначе игрок мог бы прятать сыгранное
  // обратно в стопку. Правило пока зашито; станет настройкой вместе с правилами игры.
  room.onMessage("put_card_to_deck", (client, message: { card?: string }) => {
    const player = state.players.get(client.sessionId);
    const card = message?.card;
    if (!player || state.freeMode || typeof card !== "string") return;
    const out = putCardToDeck(player.hand.toArray(), state.deck.toArray(), card);
    if (!out) return;
    writeHand(player, out.hand);
    writeDeck(state, out.deck);
    state.faceUp.set(card, false); // в колоде всё лежит рубашкой вверх
    state.deckRev += 1;
    room.broadcast("card_moved", { moves: [{ card, from: client.sessionId, to: "deck" }] });
  });

  // Свой порядок руки (сортировка/перестановка на клиенте). Принимается только
  // перестановка СВОЕЙ руки — состав не изменить.
  room.onMessage("set_hand_order", (client, message: { order?: string[] }) => {
    const player = state.players.get(client.sessionId);
    const order = message?.order;
    if (!player || !Array.isArray(order) || !order.every((c) => typeof c === "string")) return;
    if (!isPermutationOf(order, player.hand.toArray())) return;
    writeHand(player, order);
  });

  // Рука открыта/закрыта. Личное дело каждого игрока — дилерство тут ни при чём.
  room.onMessage("toggle_hand", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player) return;
    player.handOpen = !player.handOpen;
  });

  // Веер СВОЕЙ руки: каждый раскрывает/складывает сам. Видят все за столом.
  // handOpen тут ни при чём — веер рубашек при закрытой руке тоже ок.
  room.onMessage("set_hand_fanned", (client, message: { open?: boolean }) => {
    const player = state.players.get(client.sessionId);
    if (!player) return;
    player.handFanned = message?.open === true;
  });

  // Карта в руке прячется/показывается императивно самим владельцем. Спрятанную не
  // видит никто, кроме него, даже при открытой руке.
  room.onMessage("toggle_card_hidden", (client, message: { card?: string }) => {
    const player = state.players.get(client.sessionId);
    const card = message?.card;
    if (!player || typeof card !== "string") return;
    if (!player.hand.includes(card)) return; // прятать можно только своё
    if (player.handHidden.get(card)) player.handHidden.delete(card);
    else player.handHidden.set(card, true);
  });

  // «Перераздача»: дилер забирает карты из всех рук в колоду, руки закрывает; колода
  // остаётся в центре, клиентам уходит порядок для анимации сбора. Он же — единственный
  // выход из режима свободы: стол возвращается в лобби, к раздаче.
  room.onMessage("collect_hands", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer) return;
    const { hands, counts } = handsSnapshot(state);
    const seatIds = room.seatIds();
    // Сброс и игральная зона возвращаются в колоду вместе с руками — иначе сыгранные и
    // выложенные карты пропали бы. Ключи с «__» не sessionId, а псевдоместа стола:
    // collectHands перебирает значения и до имён ему дела нет.
    const out = collectHands(state.deck.toArray(), {
      ...hands,
      __discard: state.discard.toArray(),
      __play: playCards(playStacks(state)),
    });
    writeDiscard(state, []);
    writePlay(state, []);
    writeDeck(state, out.deck);
    writeFacing(state, out.faceUp);
    clearAllHands(state);
    state.freeMode = false; // сбор выводит из свободы: колода снова дилерская
    state.phase = "lobby";
    state.deckFanned = false;
    state.deckLocation = "center";
    state.deckRev += 1;
    // Порядок облёта: по часовой от дилера + сколько карт с каждого места.
    room.broadcast("hands_collected", { order: collectOrder(seatIds, client.sessionId), counts });
  });
}

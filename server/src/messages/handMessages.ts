import { isPermutationOf } from "../deckOrder.js";
import { collectHands, collectOrder, dealCardTo, takeTopCard } from "../handRules.js";
import { clearAllHands, handsSnapshot, writeDeck, writeFacing, writeHand } from "../stateWrite.js";
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

  // Режим свободы: игрок сам тянет верхнюю карту со стола. Разрешено ЛЮБОМУ за столом —
  // ролей тут нет, дилер такой же игрок.
  //
  // Конфликт двух одновременных «тянучек» решается порядком прихода сообщений: Colyseus
  // обрабатывает их последовательно, поэтому первый снимает верхнюю карту, второй —
  // следующую (или не получает ничего на опустевшей колоде). Никакой очереди и никаких
  // блокировок для этого не нужно — только не заводить здесь асинхронности.
  room.onMessage("take_card", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player || !state.freeMode) return;
    if (state.deckLocation !== "center") return; // колода унесена со стола — тянуть неоткуда
    const out = takeTopCard(state.deck.toArray());
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

  // «Перераздача»: дилер забирает карты из всех рук в колоду, руки закрывает. В режиме
  // раздачи колода остаётся в центре; клиентам — порядок для анимации сбора.
  // Он же — единственный выход из режима свободы: стол возвращается в лобби, к раздаче.
  room.onMessage("collect_hands", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer) return;
    const { hands, counts } = handsSnapshot(state);
    const seatIds = room.seatIds();
    const out = collectHands(state.deck.toArray(), hands);
    writeDeck(state, out.deck);
    writeFacing(state, out.faceUp);
    clearAllHands(state);
    state.dealMode = true; // сбор возвращает комнату в раздачу
    state.freeMode = false; // …и выводит из свободы: колода снова дилерская
    state.phase = "lobby";
    state.deckFanned = false;
    state.deckLocation = "center";
    state.deckRev += 1;
    // Порядок облёта: по часовой от дилера + сколько карт с каждого места.
    room.broadcast("hands_collected", { order: collectOrder(seatIds, client.sessionId), counts });
  });
}

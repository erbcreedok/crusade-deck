import { clearPlay, playCard, takeFromPlay } from "../playRules.js";
import { playStacks, writeDiscard, writeHand, writePlay } from "../stateWrite.js";
import type { MessageRoom } from "./host.js";

// Сообщения ИГРАЛЬНОЙ ЗОНЫ — среднего бокса стола: выложить карту из руки, забрать
// карту обратно, смахнуть всю зону в сброс.
//
// Права: зона ОБЩАЯ. Класть и забирать может любой игрок за столом, включая чужие карты
// и чужие кучки — ролей и очерёдности на этом слое нет. Так и задумано: пока правил
// игры нет, зона это просто стол, на который все дотягиваются руками. Очерёдность
// (queue lock) появится отдельно, поверх, когда правила станут конфигами.
//
// Единственное общее условие — комната В ИГРЕ (freeMode). В раздаче стол не размечен на
// боксы, игральной зоны на экране нет, и класть буквально некуда.

export function registerPlayMessages(room: MessageRoom): void {
  const state = room.state;

  // Выложить карту из руки в зону. `stack` — индекс кучки, куда доливать (дроп на карту);
  // без него карта ложится новой кучкой (дроп в пустое место сетки). Устаревший индекс не
  // ошибка — правило само превратит его в новую кучку, см. playRules.playCard.
  room.onMessage("play_card", (client, message: { card?: string; stack?: number }) => {
    const player = state.players.get(client.sessionId);
    const card = message?.card;
    if (!player || !state.freeMode || typeof card !== "string") return;
    const stack = typeof message?.stack === "number" ? message.stack : undefined;
    const out = playCard(player.hand.toArray(), playStacks(state), card, stack);
    if (!out) return;
    writeHand(player, out.hand);
    writePlay(state, out.stacks);
    state.faceUp.set(card, true); // на общем столе карта лежит открытой
    room.broadcast("card_moved", { moves: [{ card, from: client.sessionId, to: "play" }] });
  });

  // Забрать карту из зоны себе в руку. По ИМЕНИ карты, а не по позиции: зона открыта и
  // видна всем, игрок берёт ровно то, на что смотрит (у колоды позиция нужна ради
  // слепоты, здесь скрывать нечего).
  room.onMessage("take_play", (client, message: { card?: string }) => {
    const player = state.players.get(client.sessionId);
    const card = message?.card;
    if (!player || !state.freeMode || typeof card !== "string") return;
    const out = takeFromPlay(playStacks(state), card);
    if (!out) return;
    writePlay(state, out.stacks);
    state.faceUp.delete(card); // ушла в руку — сторону решает рука
    player.hand.push(card);
    room.broadcast("card_moved", { moves: [{ card, from: "play", to: client.sessionId }] });
  });

  // «В СБРОС»: вся зона уезжает в сброс одним движением — так стол чистят между
  // розыгрышами. Кнопка вшита в бокс зоны и доступна каждому: зона общая, а значит и
  // уборка общая.
  room.onMessage("clear_play", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player || !state.freeMode) return;
    const stacks = playStacks(state);
    if (stacks.length === 0) return;
    writeDiscard(state, clearPlay(stacks, state.discard.toArray()));
    writePlay(state, []);
    // Карты остаются лицом вверх: сброс тоже открыт, переворачивать нечего.
    room.broadcast("card_moved", {
      moves: stacks.flat().map((card) => ({ card, from: "play", to: "discard" })),
    });
  });
}

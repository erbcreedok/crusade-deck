import { clearPlay, playCard, takeFromPlay } from "../playRules.js";
import { resolveMove, type MoveDest, type PileName } from "../moveRules.js";
import {
  playStacks,
  writeDeck,
  writeDiscard,
  writeHand,
  writePlay,
} from "../stateWrite.js";
import type { MessageRoom } from "./host.js";

const SOURCES: readonly PileName[] = ["deck", "discard", "play", "hand"];
const DESTS: readonly MoveDest[] = ["discard", "play", "hand"];

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

  // ЕДИНОЕ перемещение карты между боксами стола: колода/сброс/зона/рука → сброс/зона/рука.
  // Один обработчик на все пары (drag-n-drop куда угодно), чтобы правило жило в одном месте.
  //
  // Исключения зашиты здесь: в КОЛОДУ класть нельзя (в свободе она закрыта на вход), а в
  // ЧУЖУЮ руку — вовсе (dest "hand" всегда своя). Всё остальное разрешено: стек→стек,
  // колода→сброс, сброс→зона и т.д. Реордер внутри одного бокса — это тот же move с
  // from === to (см. resolveMove: карта снимается, потом кладётся).
  room.onMessage(
    "move_card",
    (client, message: { card?: string; from?: string; to?: string; toStack?: number }) => {
      const player = state.players.get(client.sessionId);
      const { card, from, to } = message ?? {};
      if (!player || !state.freeMode) return;
      if (typeof card !== "string") return;
      if (!SOURCES.includes(from as PileName) || !DESTS.includes(to as MoveDest)) return;

      const out = resolveMove(
        {
          deck: state.deck.toArray(),
          discard: state.discard.toArray(),
          play: playStacks(state),
          hand: player.hand.toArray(),
        },
        { card, from: from as PileName, to: to as MoveDest, toStack: message.toStack },
      );
      if (!out) return; // карты нет в источнике

      writeDeck(state, out.piles.deck);
      writeDiscard(state, out.piles.discard);
      writePlay(state, out.piles.play);
      writeHand(player, out.piles.hand);
      // Сторона в назначении: сброс/зона — лицом; рука прячет карту (её не видит стол).
      if (to === "hand") state.faceUp.delete(card);
      else state.faceUp.set(card, out.faceUp);
      // Ревизию двигаем, если колода менялась — иначе устаревшее эхо откатит её у соседа.
      if (from === "deck") state.deckRev += 1;
      if (state.deck.length === 0) state.deckFanned = false; // разобрали колоду — веера нет

      const fromLabel = from === "hand" ? client.sessionId : from;
      const toLabel = to === "hand" ? client.sessionId : to;
      room.broadcast("card_moved", { moves: [{ card, from: fromLabel, to: toLabel }] });
    },
  );
}

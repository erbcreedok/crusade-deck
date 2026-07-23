import { removePublicRoom, setPublicRoom } from "../publicRooms.js";
import type { MessageRoom } from "./host.js";

// Сообщения про КОМНАТУ и её людей: готовность, режим раздачи, старт игры,
// паблик/приват и голосования (сменить дилера, выгнать игрока).

export function registerRoomMessages(room: MessageRoom): void {
  const state = room.state;

  room.onMessage("ready", (client) => {
    const player = state.players.get(client.sessionId);
    // Дилер всегда готов — тумблер ему не нужен и не сбрасывает дроп-зону.
    if (!player || player.isDealer) return;
    player.isReady = !player.isReady;
  });

  // Режим раздачи (дилер). Выключение раскрывает колоду (бывший revealMode) и делает
  // руки приватными; включение прячет колоду обратно.
  room.onMessage("toggle_deal_mode", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer) return;
    state.dealMode = !state.dealMode;
    state.deck.forEach((card) => state.faceUp.set(card, !state.dealMode));
    if (!state.dealMode) {
      state.players.forEach((p) => {
        p.handOpen = false;
        p.handFanned = false;
      });
    }
  });

  // «ГОУ!» — дилер объявляет начало: стол переходит в режим свободы, где карты со стола
  // игроки берут сами (см. take_card). Колоду при этом НЕ раздаём — в отличие от
  // start_game, она остаётся лежать в центре; и dealMode не трогаем: номиналов
  // по-прежнему не видит никто, карты тянут вслепую.
  //
  // Смена фазы на "playing" заодно снимает с дилера власть над колодой: тасовка,
  // перевороты, move_deck и reset_deck закрыты условием phase === "lobby" (deckMessages).
  // Это и есть нужное поведение — игра началась, колоду больше не крутят.
  room.onMessage("go", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer) return;
    state.freeMode = true;
    state.phase = "playing";
    // Клич — чистое украшение: состояния в нём нет (правда едет схемой). Поэтому повторное
    // нажатие при уже включённой свободе просто подгоняет стол ещё раз.
    room.broadcast("go_shout", {});
  });

  room.onMessage("start_game", (client) => {
    const player = state.players.get(client.sessionId);
    if (player?.isDealer && state.phase === "lobby") {
      room.dealAllCards();
      state.phase = "playing";
    }
  });

  room.onMessage("toggle_public", (client) => {
    // Паблик/приват может переключить любой игрок в комнате.
    if (!state.players.has(client.sessionId)) return;
    state.isPublic = !state.isPublic;
    if (state.isPublic) {
      setPublicRoom(room.roomId, {
        roomId: room.roomId,
        deckType: state.deckType,
        playerCount: state.players.size,
      });
    } else {
      removePublicRoom(room.roomId);
    }
  });

  room.onMessage("propose_dealer", (client) => {
    if (state.activeProposal) return;
    const player = state.players.get(client.sessionId);
    if (!player || player.isDealer) return;
    room.startProposal("dealer", client.sessionId, client.sessionId);
  });

  room.onMessage("propose_kick", (client, message: { targetSessionId?: string }) => {
    if (state.activeProposal) return;
    const targetSessionId = message?.targetSessionId;
    if (!targetSessionId || targetSessionId === client.sessionId || !state.players.has(targetSessionId)) return;
    room.startProposal("kick", client.sessionId, targetSessionId);
  });

  room.onMessage("vote", (client, message: { value?: boolean }) => {
    const proposal = state.activeProposal;
    if (!proposal || typeof message?.value !== "boolean") return;
    if (!state.players.has(client.sessionId)) return;
    proposal.votes.set(client.sessionId, message.value);
    room.tallyAndResolve();
  });
}

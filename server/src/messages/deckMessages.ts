import { buildDeck } from "../deckBuild.js";
import { sanitizeDeckFx } from "../deckFx.js";
import { isPermutationOf } from "../deckOrder.js";
import { collectOrder } from "../handRules.js";
import { clearAllHands, handsSnapshot, writeDeck, writeFreshDeck } from "../stateWrite.js";
import type { MessageRoom } from "./host.js";

// Сообщения про КОЛОДУ: тасовка, порядок, эффекты, веер, сброс. Все они, кроме сброса,
// доступны только дилеру и только в лобби.
//
// Переворотов колоды здесь больше НЕТ: номиналы карт на столе не видит никто, включая
// дилера, — карту узнают, только взяв её в руку. Раньше это включалось тумблером «режим
// раздачи», и вместе с ним существовала вторая механика стола (колода как один предмет,
// который таскают по зонам, с переворотами и веером в руке). Тумблер убран, вторая
// механика вместе с ним — см. историю коммитов, если она когда-нибудь понадобится.

export function registerDeckMessages(room: MessageRoom): void {
  const state = room.state;

  // Начало СЕССИИ тасовки (любой: кнопка, свайп по вееру, будущие жесты). Порядок
  // считает клиент — он же и анимирует, — а сервер держит «замок»: пока сессия открыта,
  // все видят, кто тасует. Замок снимается финальным set_deck_order, уходом игрока или
  // сторожевым таймером (клиент мог закрыть вкладку посреди жеста).
  room.onMessage("shuffle_start", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer || state.phase !== "lobby") return;
    state.shufflingBy = client.sessionId;
    room.armShuffleLock();
  });

  // Эффекты колоды (перевороты/тянучка/рассыпание) — чистое украшение: сервер их не
  // интерпретирует, а лишь чистит, ставит своё время и раздаёт остальным, чтобы у них
  // анимация длилась столько же, сколько у дилера. Состояние приходит отдельно, схемой,
  // и всегда главнее: эффект может опоздать или потеряться — данные от этого не страдают.
  room.onMessage("deck_fx", (client, message: unknown) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer || state.phase !== "lobby") return;
    if (!room.allowFx(client.sessionId, Date.now())) return;
    const fx = sanitizeDeckFx(message, Date.now());
    if (!fx) return;
    room.broadcast("deck_fx", fx, { except: client });
  });

  // Готовый порядок колоды от клиента (свайп по вееру: карты выплёскиваются и врезаются
  // обратно). Тасует КЛИЕНТ — так его анимация точна и не ждёт сети; сервер принимает
  // результат, но проверяет, что это именно перестановка текущей колоды.
  room.onMessage("set_deck_order", (client, message: { order?: string[]; final?: boolean; rev?: number }) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer || state.phase !== "lobby") return;
    // Чужую сессию не перебиваем: пока колода «в руках» у другого игрока, его порядок
    // главный (замок держится сервером и снимается сам, если тот отвалился).
    if (state.shufflingBy && state.shufflingBy !== client.sessionId) return;
    const order = message?.order;
    if (!Array.isArray(order) || !order.every((c) => typeof c === "string")) return;
    if (!isPermutationOf(order, state.deck.toArray())) return;
    if (!room.acceptRev(message?.rev)) return;
    writeDeck(state, order);
    if (message?.final) room.clearShuffleLock();
    else room.armShuffleLock(); // промежуточный прогресс продлевает сессию
  });

  // Веер колоды на столе: раскрыть/собрать может только дилер и только пока колода
  // в центре. Состояние комнатное — веер видят все.
  room.onMessage("set_deck_fanned", (client, message: { open?: boolean }) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer || state.deckLocation !== "center") return;
    state.deckFanned = message?.open === true;
  });

  // Сбросить колоду: уничтожить текущую (и руки), выдать новую неперемешанную.
  room.onMessage("reset_deck", (client) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer) return;
    const { counts } = handsSnapshot(state);
    const seatIds = room.seatIds();
    writeFreshDeck(state, buildDeck(state.deckType));
    clearAllHands(state);
    state.deckFanned = false;
    state.deckLocation = "center";
    state.deckRev += 1;
    room.clearShuffleLock();
    // Анимация «карты с мест в центр», как при сборе (новая колода уже в схеме).
    room.broadcast("deck_reset", { order: collectOrder(seatIds, client.sessionId), counts });
  });
}

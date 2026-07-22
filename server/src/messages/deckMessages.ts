import { buildDeck } from "../deckBuild.js";
import { flippedFacing, flipWholeDeck } from "../deckFacing.js";
import { sanitizeDeckFx } from "../deckFx.js";
import { isPermutationOf, moveCard } from "../deckOrder.js";
import { collectOrder } from "../handRules.js";
import { flipRejectReason } from "../rejections.js";
import { clearAllHands, facingRecord, handsSnapshot, writeDeck, writeFacing, writeFreshDeck } from "../stateWrite.js";
import type { MessageRoom } from "./host.js";

// Сообщения про КОЛОДУ: тасовка, порядок, перевороты, эффекты, перенос, веер, сброс.
// Все они, кроме сброса, доступны только дилеру и только в лобби.

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

  // Дилер перетащил одну карту в раскрытом веере на новое место — порядок колоды
  // меняется и СОХРАНЯЕТСЯ (эхо разойдётся всем). Только дилер и только в лобби.
  room.onMessage("reorder_deck", (client, message: { card?: string; to?: number }) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer || state.phase !== "lobby") return;
    const card = message?.card;
    const to = message?.to;
    if (typeof card !== "string" || typeof to !== "number" || !Number.isFinite(to)) return;
    writeDeck(state, moveCard(state.deck.toArray(), card, to));
  });

  // Переворот колоды целиком: кнопкой (когда колода НЕ в вее­ре) или свайпом по стопке.
  // Порядок реверсится, каждая карта меняет сторону — как у настоящей стопки в руке.
  room.onMessage("flip_deck", (client, message: { rev?: number }) => {
    const player = state.players.get(client.sessionId);
    const reason = flipRejectReason(player, state.phase, state.deck.toArray(), [], state.dealMode);
    if (reason) {
      // Клиент уже показал карты другой стороной — молчать нельзя, иначе он останется
      // с неверной картинкой. Отвечаем отказом, он вернёт колоду и объяснит почему.
      client.send("action_rejected", { action: "flip_deck", reason, cards: [] });
      return;
    }
    if (!room.acceptRev(message?.rev)) return; // устаревшее/повторное — молча пропускаем
    const out = flipWholeDeck(state.deck.toArray(), facingRecord(state));
    writeDeck(state, out.order);
    writeFacing(state, out.facing);
  });

  // Переворот отдельных карт на месте (жесты по вееру: свайп вниз по карте, случайные
  // перевороты при сильной тасовке). Порядок колоды не трогается.
  room.onMessage("flip_cards", (client, message: { cards?: string[]; rev?: number }) => {
    const player = state.players.get(client.sessionId);
    const raw = message?.cards;
    const cards = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
    if (cards.length === 0) return; // пустой запрос — нечего ни делать, ни откатывать
    const reason = flipRejectReason(player, state.phase, state.deck.toArray(), cards, state.dealMode);
    if (reason) {
      client.send("action_rejected", { action: "flip_cards", reason, cards });
      return;
    }
    if (!room.acceptRev(message?.rev)) return;
    writeFacing(state, flippedFacing(facingRecord(state), cards));
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

  // Дилер притягивает колоду в свою руку (zone "hand") или возвращает в центр
  // (zone "center"). Карты не раздаются — колода целиком меняет зону, рубашкой вверх.
  room.onMessage("move_deck", (client, message: { zone?: "center" | "hand" | "player"; targetId?: string }) => {
    const player = state.players.get(client.sessionId);
    if (!player?.isDealer || state.phase !== "lobby") return;
    // В режиме раздачи колода живёт только в центре: раздают рогаткой и веером,
    // а не переносом колоды.
    if (state.dealMode) return;
    const zone = message?.zone;
    if (zone === "center") {
      state.deckLocation = "center";
    } else if (zone === "hand") {
      // Рука — единственная личная зона: там колода лежит веером.
      state.deckLocation = client.sessionId;
    } else if (zone === "player") {
      // Колоду бросили на место другого игрока — она переходит к нему.
      const targetId = message?.targetId;
      if (typeof targetId !== "string" || !state.players.has(targetId)) return;
      state.deckLocation = targetId;
    }
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
    state.dealMode = true;
    state.deckRev += 1;
    room.clearShuffleLock();
    // Анимация «карты с мест в центр», как при сборе (новая колода уже в схеме).
    room.broadcast("deck_reset", { order: collectOrder(seatIds, client.sessionId), counts });
  });
}

import { Player } from "./GameState.js";

// «Призрачные» игроки тестовой комнаты: живут только в state, без клиента и сокета.
// Смысл — чтобы за столом кто-то сидел, пока делается посадка/вёрстка/дроп-зоны, и не
// приходилось собирать живых людей. Базовый минимум: сидят и готовы, ничего не решают.
// Дальше они получат те же входы/выходы, что и человек (те же onMessage-хендлеры), —
// поэтому это обычные Player в общей карте игроков, а не отдельная сущность сбоку.

export const BOT_COUNT = 3;

// Ключ в state.players у человека — это sessionId. У бота его нет, поэтому берём
// собственный префикс: по нему бот отличим везде, где раньше был только sessionId.
const BOT_ID_PREFIX = "bot-";

const BOT_NAMES = ["Бот Кир", "Бот Ася", "Бот Лют"];

export function botSessionId(index: number): string {
  return `${BOT_ID_PREFIX}${index + 1}`;
}

export function isBotId(id: string): boolean {
  return id.startsWith(BOT_ID_PREFIX);
}

export function makeBot(index: number): Player {
  const bot = new Player();
  bot.id = botSessionId(index);
  bot.name = BOT_NAMES[index % BOT_NAMES.length];
  bot.isBot = true;
  bot.connected = true; // за столом, а не «на паузе»
  bot.isReady = true; // ждать от них нажатия «Готов» бессмысленно
  bot.isDealer = false; // дилер — всегда живой игрок
  return bot;
}

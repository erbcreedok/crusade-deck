import { CardRoom } from "./CardRoom.js";
import { makeBot, botSessionId, BOT_COUNT } from "./bots.js";

interface TestRoomOptions {
  deckType?: "36" | "52";
  name?: string;
  accountId?: string;
}

// Тестовая комната: обычная CardRoom, за столом которой сразу сидят боты.
// Всё поведение (раздача, тасовка, голосования) наследуется как есть — отличие ровно
// одно: игроки-боты уже в state на момент создания. Всегда приватная, чтобы у комнаты
// был код: по нему в неё возвращаются после перезагрузки и заходят со второго устройства.
export class TestRoom extends CardRoom {
  onCreate(options: TestRoomOptions) {
    super.onCreate({ ...options, isPrivate: true });
    for (let i = 0; i < BOT_COUNT; i++) {
      this.state.players.set(botSessionId(i), makeBot(i));
    }
  }
}

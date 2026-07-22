import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "Player";
  @type("boolean") isDealer: boolean = false;
  @type("boolean") isReady: boolean = false;
  @type("boolean") connected: boolean = true;
  // Карты в руке, напр. "10♠", "A♥". Синкается всем игрокам (см. заметку
  // про упрощение видимости в project_accounts_dealer_voting.md) — клиент
  // сам решает, чью руку рисовать в открытую, а чью рубашкой вниз.
  @type({ array: "string" }) hand = new ArraySchema<string>();
}

// Голосование: предложить себя/другого в дилеры, или предложить кого-то кикнуть.
// У дилера вес голоса 1.5, у остальных — 1 (считается в CardRoom).
export class Proposal extends Schema {
  @type("string") kind: "dealer" | "kick" = "dealer";
  @type("string") proposerId: string = ""; // sessionId
  @type("string") targetId: string = ""; // sessionId
  // Unix-время (мс), когда голосование форсированно закроется — см. VOTE_TIMEOUT_MS
  // в CardRoom.ts. Кто не успел проголосовать, просто не учитывается в подсчёте.
  @type("number") deadline: number = 0;
  @type({ map: "boolean" }) votes = new MapSchema<boolean>();
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") deckType: "36" | "52" = "36";
  @type("string") phase: "lobby" | "playing" | "finished" = "lobby";
  @type("string") inviteCode: string = "";
  @type("boolean") isPublic: boolean = false;
  @type(Proposal) activeProposal?: Proposal;
  @type({ array: "string" }) deck = new ArraySchema<string>();
  // Где сейчас лежит колода: "center" — общий центр стола, иначе sessionId
  // игрока, в чью личную сейф-зону её притянули (рубашкой вверх). Двигать может
  // только дилер (см. move_deck в CardRoom). Клиент по своему sessionId решает,
  // рисовать колоду в своей сейф-зоне или она просто пропала из центра.
  @type("string") deckLocation: string = "center";
  // sessionId игрока, который прямо сейчас тасует колоду (жестом или кнопкой), иначе "".
  // Пока идёт сессия, порядок колоды считает ЕГО клиент и присылает готовым; остальные
  // видят по этому полю, что колода «в работе», и не мешают. Снимается финальным
  // сообщением, уходом игрока или сторожевым таймером (см. SHUFFLE_LOCK_MS в CardRoom).
  @type("string") shufflingBy: string = "";
}

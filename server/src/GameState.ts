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
  // Сторона КАЖДОЙ карты: карта → лежит ли лицом вверх. Ключ — сама карта ("10♠"), а не
  // индекс: направление принадлежит карте и переживает тасовку/перестановку. Возможны
  // смешанные состояния (с обеих сторон колоды рубашки либо лица) — так и задумано.
  @type({ map: "boolean" }) faceUp = new MapSchema<boolean>();
  // Ревизия колоды. Пишет её только дилер — он источник правды для порядка и сторон:
  // что у него на устройстве, то и у всех. Ревизия нужна, чтобы его же УСТАРЕВШЕЕ эхо
  // не откатывало картинку назад (last-write-wins по номеру, а не по времени прихода).
  @type("number") deckRev: number = 0;
  // sessionId игрока, который прямо сейчас тасует колоду (жестом или кнопкой), иначе "".
  // Пока идёт сессия, порядок колоды считает ЕГО клиент и присылает готовым; остальные
  // видят по этому полю, что колода «в работе», и не мешают. Снимается финальным
  // сообщением, уходом игрока или сторожевым таймером (см. SHUFFLE_LOCK_MS в CardRoom).
  @type("string") shufflingBy: string = "";
}

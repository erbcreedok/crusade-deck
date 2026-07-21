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
}

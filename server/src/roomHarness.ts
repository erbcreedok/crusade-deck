import { afterAll, beforeAll, beforeEach } from "vitest";
import { ColyseusTestServer } from "@colyseus/testing";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CardRoom } from "./CardRoom.js";
import { TestRoom } from "./TestRoom.js";

// Общая обвязка тестов комнаты: поднять сервер, поделить его на все случаи одного файла,
// прибрать между тестами. Вынесено из CardRoom.test.ts, который вырос до тысячи строк и
// был разрезан по темам — обвязка у всех кусков одна и та же.
//
// vi.mock("./accounts.js") сюда переехать НЕ может: он хойстится в рамках файла теста,
// поэтому остаётся в каждом файле (четыре строки).

// Короткие таймауты — тесты не ждут реальные секунды. Комната читает их «лениво»
// (при каждом обращении, см. roomConfig.ts), ровно ради тестируемости.
process.env.VOTE_TIMEOUT_MS = "150";
process.env.EMPTY_ROOM_TTL_MS = "300"; // сколько живёт опустевшая (все на паузе) комната
process.env.SHUFFLE_LOCK_MS = "300"; // сторож сессии тасовки, если клиент отвалился

/** По порту на файл тестов: параллельные воркеры vitest не должны делить сокет. */
export const TEST_PORTS = {
  lifecycle: 2661,
  votes: 2662,
  deck: 2663,
  facing: 2664,
  hands: 2665,
  bots: 2666,
  free: 2667,
  play: 2668,
} as const;

export function createGameServer() {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define("card_room", CardRoom);
  server.define("test_room", TestRoom);
  return server;
}

/**
 * Поднимает тестовый сервер на файл и чистит комнаты между тестами.
 * Возвращает геттер, потому что сам сервер появляется только в beforeAll.
 *
 * Порт обязателен и у каждого файла свой: vitest гоняет файлы параллельно, и на общем
 * порту они дерутся за него (EADDRINUSE). Список портов — TEST_PORTS ниже, чтобы номера
 * не расползлись по файлам и не начали совпадать.
 */
export function useTestServer(port: number): () => ColyseusTestServer {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    // Не boot(server, port): при передаче готового Server библиотека игнорирует порт и
    // всегда слушает свой 2568 (см. @colyseus/testing/build/index.js). Поднимаем сами —
    // ровно то же самое, что делает boot, но на нужном порту.
    const gameServer = createGameServer();
    await gameServer.listen(port);
    colyseus = new ColyseusTestServer(gameServer);
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  beforeEach(async () => {
    await colyseus.cleanup();
  });

  return () => colyseus;
}

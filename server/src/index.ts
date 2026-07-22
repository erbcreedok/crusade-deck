import express from "express";
import { createServer } from "http";
// Именованный импорт из "colyseus" не отдаёт Server под нативным Node ESM
// (пакет ре-экспортирует @colyseus/core динамически, cjs-module-lexer это не видит).
import colyseusPkg from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CardRoom } from "./CardRoom.js";
import { TestRoom } from "./TestRoom.js";
import { resolveInviteCode } from "./inviteCodes.js";
import { createAccount, findAccountByRecoveryHash, renameAccount, regenerateRecoveryHash } from "./accounts.js";
import { listPublicRooms } from "./publicRooms.js";
import { getLastRoom } from "./lastRooms.js";

const { Server } = colyseusPkg;

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

gameServer.define("card_room", CardRoom);
// Тестовая комната с ботами за столом — площадка для посадки/вёрстки/дроп-зон.
gameServer.define("test_room", TestRoom);

// Найти roomId по 6-значному коду — используется клиентом для join по коду
app.get("/rooms/by-code/:code", (req, res) => {
  const roomId = resolveInviteCode(req.params.code);
  if (!roomId) return res.status(404).json({ error: "not_found" });
  res.json({ roomId });
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Свои аккаунты (без Firebase): сервер выдаёт accountId + recoveryHash,
// клиент хранит их локально. recoveryHash позволяет восстановить того же
// пользователя с другого устройства/браузера.
app.post("/accounts", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : undefined;
  res.json(createAccount(name));
});

app.post("/accounts/restore", (req, res) => {
  const hash = req.body?.recoveryHash;
  if (typeof hash !== "string") return res.status(400).json({ error: "bad_request" });
  const account = findAccountByRecoveryHash(hash);
  if (!account) return res.status(404).json({ error: "not_found" });
  res.json(account);
});

app.patch("/accounts/:id", (req, res) => {
  const { name, recoveryHash } = req.body || {};
  if (typeof name !== "string" || typeof recoveryHash !== "string") {
    return res.status(400).json({ error: "bad_request" });
  }
  const account = renameAccount(req.params.id, recoveryHash, name);
  if (!account) return res.status(403).json({ error: "forbidden" });
  res.json(account);
});

app.post("/accounts/:id/regenerate-code", (req, res) => {
  const { recoveryHash } = req.body || {};
  if (typeof recoveryHash !== "string") return res.status(400).json({ error: "bad_request" });
  const account = regenerateRecoveryHash(req.params.id, recoveryHash);
  if (!account) return res.status(403).json({ error: "forbidden" });
  res.json(account);
});

app.get("/rooms/public", (_req, res) => {
  res.json(listPublicRooms());
});

// Последняя посещённая аккаунтом комната (для кнопки «вернуться в игру» в лобби).
// Запись существует, только пока комната ещё жива (чистится на её диспоузе).
app.get("/accounts/:id/last-room", (req, res) => {
  const last = getLastRoom(req.params.id);
  if (!last) return res.status(404).json({ error: "not_found" });
  res.json(last);
});

const PORT = Number(process.env.PORT) || 2567;
httpServer.listen(PORT, () => {
  console.log(`Crusade Deck server listening on :${PORT}`);
});

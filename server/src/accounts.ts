import { randomUUID, randomInt } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export interface Account {
  id: string;
  name: string;
  recoveryHash: string;
  createdAt: number;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "accounts.json");

const accounts = new Map<string, Account>();
const byHash = new Map<string, string>(); // normalized recoveryHash -> accountId

function normalizeHash(hash: string): string {
  return hash.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function load() {
  if (!existsSync(DATA_FILE)) return;
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as Account[];
    for (const account of raw) {
      accounts.set(account.id, account);
      byHash.set(account.recoveryHash, account.id);
    }
  } catch {
    // повреждённый/пустой файл — начинаем с чистого листа
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify([...accounts.values()], null, 2));
  }, 200);
}

// Короткий код вида "согласная-гласная-согласная-согласная-гласная-согласная"
// (напр. "BOVAKI") — короче hex-строки и легче произносится/вводится вручную.
const CONSONANTS = "BCDFGHJKLMNPRSTVWZ";
const VOWELS = "AEIOU";
const PATTERN = ["C", "V", "C", "C", "V", "C"] as const;

function generateRecoveryHash(): string {
  return PATTERN.map((kind) => {
    const set = kind === "C" ? CONSONANTS : VOWELS;
    return set[randomInt(set.length)];
  }).join("");
}

export function createAccount(name?: string): Account {
  const id = randomUUID();
  let recoveryHash = generateRecoveryHash();
  while (byHash.has(recoveryHash)) recoveryHash = generateRecoveryHash();

  const account: Account = {
    id,
    name: name?.trim().slice(0, 24) || "Player",
    recoveryHash,
    createdAt: Date.now(),
  };
  accounts.set(id, account);
  byHash.set(recoveryHash, id);
  scheduleSave();
  return account;
}

export function findAccountById(id: string): Account | undefined {
  return accounts.get(id);
}

export function findAccountByRecoveryHash(hash: string): Account | undefined {
  const id = byHash.get(normalizeHash(hash));
  return id ? accounts.get(id) : undefined;
}

export function renameAccount(id: string, recoveryHash: string, name: string): Account | undefined {
  const account = accounts.get(id);
  if (!account || account.recoveryHash !== normalizeHash(recoveryHash)) return undefined;
  const trimmed = name.trim().slice(0, 24);
  if (trimmed) account.name = trimmed;
  scheduleSave();
  return account;
}

export function regenerateRecoveryHash(id: string, recoveryHash: string): Account | undefined {
  const account = accounts.get(id);
  if (!account || account.recoveryHash !== normalizeHash(recoveryHash)) return undefined;

  byHash.delete(account.recoveryHash);
  let next = generateRecoveryHash();
  while (byHash.has(next)) next = generateRecoveryHash();

  account.recoveryHash = next;
  byHash.set(next, id);
  scheduleSave();
  return account;
}

load();

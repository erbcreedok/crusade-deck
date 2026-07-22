# Crusade Deck

Мультиплеерная карточная игра для мобильных браузеров. Монорепо из двух частей на Node:

- `server/` — игровой сервер на Colyseus (Express + WebSocket, порт **2567**).
- `client/` — React + Vite + Pixi.js, собирается в статику (`client/dist`), без SSR.

Требования: **Node 20+** (проверено на 22 LTS), npm, git.

Подробности архитектуры и игровых механик — в `CLAUDE.md`.

## Локальный запуск

```bash
git clone <repo-url> crusade-deck
cd crusade-deck

cd server && npm ci && npm run dev    # :2567, авто-рестарт на изменениях
```

Во втором терминале:

```bash
cd client && npm ci && npm run dev    # :5173
```

Открыть `http://localhost:5173`. Клиент по умолчанию стучится на
`ws://localhost:2567` — для локальной разработки ничего донастраивать не нужно.

**Проверка с телефона по той же Wi-Fi:** клиент должен стучаться на LAN-IP машины,
а не на `localhost`. Создать `client/.env.local` (в `.gitignore`, не коммитится):

```bash
cat > client/.env.local <<'EOF'
VITE_HTTP_URL=http://192.168.1.66:2567
VITE_SERVER_URL=ws://192.168.1.66:2567
EOF
```

подставив реальный IP машины, и открыть `http://192.168.1.66:5173` с телефона.

### Тесты

```bash
cd server && npm test && npx tsc --noEmit   # 139 тестов
cd client && npm test && npx tsc --noEmit   # 449 тестов
```

## Запуск в продакшене

Клиент — статика, адрес сервера **зашивается в бандл на этапе сборки**
(`VITE_SERVER_URL`/`VITE_HTTP_URL`), поэтому собирать нужно уже зная итоговый домен.
Данные аккаунтов лежат в `server/data/accounts.json` — единственное, что переживает
рестарт; комнаты и партии живут только в памяти процесса.

### Вариант А — свой Linux-сервер, напрямую

Без туннеля: сервер слушает публичный IP/домен напрямую, порты 80/443 открыты наружу,
TLS — сам (Let's Encrypt) или через обратный прокси.

```bash
git clone <repo-url> ~/crusade-deck
cd ~/crusade-deck/server && npm ci && npm run build

cd ~/crusade-deck/client
cat > .env.production <<'EOF'
VITE_SERVER_URL=wss://api.example.com
VITE_HTTP_URL=https://api.example.com
EOF
npm ci && npm run build
```

Игровой сервер:

```bash
cd ~/crusade-deck/server && PORT=2567 NODE_ENV=production node dist/index.js
```

Статика (нужен SPA-фоллбэк на `index.html` — ссылки-приглашения вида `/r/КОД` дадут
404 при прямой загрузке без него):

```bash
npx serve -s ~/crusade-deck/client/dist -l 8080
```

Дальше — любой обратный прокси с TLS перед этими двумя портами (nginx, Caddy):
статика на `example.com` → `127.0.0.1:8080`, API и WebSocket на `api.example.com` →
`127.0.0.1:2567`. CORS на сервере уже открыт (`Access-Control-Allow-Origin: *`), так
что разные хосты для клиента и API — рабочая конфигурация.

Для systemd-автозапуска и обновления версии — см. разделы 4 и 6 в `DEPLOY.md`, они
не привязаны к конкретному способу выхода наружу.

### Вариант Б — Cloudflare Tunnel (без открытых портов)

Сервер держит исходящее соединение с Cloudflare, порты 80/443 на машине трогать не
нужно вообще, TLS и домен — на стороне Cloudflare. Полная пошаговая инструкция
(создание туннеля, `config.yml`, DNS, systemd-юниты, бэкап аккаунтов) — в
**`DEPLOY.md`**.

### Проверка после деплоя

```bash
curl https://api.example.com/health   # {"status":"ok"}
```

Открыть `https://example.com` в браузере — должен создаться профиль. В DevTools →
Network должен быть апгрейд `101 Switching Protocols` на `wss://api.example.com/...`.
Если страница открывается, а игра не подключается — почти всегда неверный адрес
зашит в бандл (проверить `.env.production`, убедиться что рядом нет забытого
`client/.env.local` — он перебивает `.env.production` даже в проде).

## Известные мелочи

- Recovery-код копируется через `navigator.clipboard` — работает только в secure
  context (HTTPS/localhost). По «голому» HTTP на внешнем IP кнопка копирования
  отвалится.
- Firebase в зависимостях есть, но не используется и не настроен — вход работает на
  своих аккаунтах с recovery-кодом.
- Единственная обязательная переменная окружения у сервера — `PORT` (по умолчанию
  2567).

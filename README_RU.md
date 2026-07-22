# Crusade Deck

Мультиплеерная карточная игра для мобильных браузеров. Монорепо из двух частей на Node:

- `server/` — игровой сервер на Colyseus (Express + WebSocket, порт **2567**).
- `client/` — React + Vite + Pixi.js, собирается в статику (`client/dist`), без SSR.

Требования: **Node 20+** (проверено на 22 LTS), npm, git.

Подробности архитектуры и игровых механик — в `CLAUDE_RU.md`.

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

Для systemd-автозапуска и обновления версии — см. разделы 4 и 6 в `DEPLOY_RU.md`, они
не привязаны к конкретному способу выхода наружу.

### Вариант Б — Cloudflare Tunnel (без открытых портов)

Сервер держит исходящее соединение с Cloudflare, порты 80/443 на машине трогать не
нужно вообще, TLS и домен — на стороне Cloudflare. Полная пошаговая инструкция
(создание туннеля, `config.yml`, DNS, systemd-юниты, бэкап аккаунтов) — в
**`DEPLOY_RU.md`**.

### Вариант В — Docker / `docker compose`

`docker-compose.yml` в корне репозитория собирает и запускает оба сервиса: `server`
(порт 2567, том `server-data`, чтобы аккаунты переживали пересоздание контейнера) и
`client` (nginx отдаёт статическую сборку с SPA-фоллбэком, порт 8080).

```bash
docker compose up -d --build
```

По умолчанию бандл клиента собирается на `ws://localhost:2567` — годится для
локальной проверки. Для прода адрес сервера нужно задать **до первой сборки** (он
зашивается в бандл, как и везде в этом проекте): создать `.env` рядом с
`docker-compose.yml`:

```bash
cat > .env <<'EOF'
CRUSADE_SERVER_URL=wss://api.example.com
CRUSADE_HTTP_URL=https://api.example.com
EOF
docker compose up -d --build
```

Обратный прокси с TLS перед портами 2567 и 8080 нужен тот же, что и в варианте А —
Docker здесь заменяет только «поставить Node и запустить два процесса руками», а не
слой роутинга/TLS. Пересобирать образ `client` (`docker compose build client`) нужно
при каждой смене адреса сервера; одна правка `.env` уже собранный образ не
перепрошивает.

> Эти Dockerfile/compose — первый черновой набросок: выглядят разумно, но ещё не
> проверены живьём через `docker build`. Прогони локально перед тем, как полагаться
> на них в реальном деплое.

### Вариант Г — Fly.io (сейчас развёрнуто так)

`server/fly.toml` и `client/fly.toml` уже готовы, по одному приложению Fly на каждый
Dockerfile.

```bash
cd server && fly deploy    # игровой сервер, persistent volume под accounts.json
cd client && fly deploy    # статика; VITE_* зашиваются через build.args
```

Учти, что у Fly **нет бесплатного тарифа для новых аккаунтов** — только оплата по
факту. С `min_machines_running = 0` (текущая настройка) машины спят, пока никто не
играет, и просыпаются за 1–2 секунды: выходит примерно $0.20–1 в месяц. Держать оба
сервиса всегда включёнными — около $4 в месяц.

Из-за засыпания **первое** подключение после простоя падает: HTTP-матчмейкинг будит
машину и проходит, а WebSocket сразу за ним упирается в ещё загружающуюся машину и
получает `socket hang up`. Это лечится в `client/src/retryJoin.ts` — все входы в
комнату повторяются несколько раз, поэтому холодный старт просто занимает ~10 секунд
вместо ошибки. Если хочется совсем без этого — поставь `min_machines_running = 1` в
`server/fly.toml`.

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

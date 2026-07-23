# Деплой Crusade Deck через Cloudflare Tunnel

Инструкция для того, кто разворачивает проект на своём сервере. Наружу ничего
открывать не нужно: сервер держит исходящее соединение с Cloudflare, порты
80/443 на машине можно не трогать вообще, TLS и домен — на стороне Cloudflare.

## Что за проект

Монорепо из двух частей, обе на Node:

- `server/` — игровой сервер на Colyseus (Express + WebSocket), слушает **:2567**.
  HTTP-эндпоинты (`/accounts*`, `/rooms*`, `/health`, `/matchmake*`) и игровой
  сокет живут на одном и том же порту.
- `client/` — React + Vite, собирается в статику (`client/dist`), никакого SSR.
  Адрес сервера **зашивается в бандл на этапе сборки**, поэтому клиент нужно
  собирать уже зная итоговые домены.

Требования: **Node 20+** (проверено на 22 LTS), git. Больше ничего — ни базы,
ни Redis. Данные аккаунтов лежат в JSON-файле `server/data/accounts.json`.

## Схема

Два публичных хоста на один сервер — так проще всего с туннелем, потому что
сокет Colyseus живёт в корне (`/{processId}/{roomId}`) и по пути его от статики
не отличить:

```
браузер ──https──> Cloudflare ──tunnel──> cloudflared ─┬─ 127.0.0.1:8080  статика client/dist
             wss                                       └─ 127.0.0.1:2567  Colyseus (API + сокет)
```

- `crusade.ПРИМЕР.com` → статика клиента
- `api.crusade.ПРИМЕР.com` → игровой сервер

CORS уже разрешён на сервере (`Access-Control-Allow-Origin: *`), так что
разные хосты для клиента и API — рабочая конфигурация, править код не надо.

Имена хостов любые, ниже они встречаются в трёх местах: в `.env.production`
клиента, в `config.yml` туннеля и в DNS-записях Cloudflare.

## 1. Собрать проект

```bash
git clone <repo-url> ~/crusade-deck
cd ~/crusade-deck/server && npm ci && npm run build
```

Клиент — только после того, как определились с доменами. Обязательно `wss://`
и `https://`: страница по HTTPS не откроет незащищённый сокет.

```bash
cd ~/crusade-deck/client
cat > .env.production <<'EOF'
VITE_SERVER_URL=wss://api.crusade.ПРИМЕР.com
VITE_HTTP_URL=https://api.crusade.ПРИМЕР.com
EOF
npm ci && npm run build
```

Проверить, что домен реально уехал в бандл:

```bash
grep -c "api.crusade.ПРИМЕР.com" dist/assets/index-*.js
```

> ⚠️ Если рядом окажется `client/.env.local`, он перебьёт `.env.production` даже
> в прод-сборке. В git он не коммитится, на сервере его быть не должно.

## 2. Поднять два локальных процесса

**Игровой сервер:**

```bash
cd ~/crusade-deck/server && PORT=2567 NODE_ENV=production node dist/index.js
```

**Статика клиента** (нужен SPA-фоллбэк — ссылка-приглашение имеет вид `/r/КОД`,
без фоллбэка при перезагрузке будет 404):

```bash
npx serve -s ~/crusade-deck/client/dist -l 8080
```

Годится любой статик-сервер с фоллбэком на `index.html` — nginx, Caddy, что
привычнее. Порт 8080 фигурирует дальше только в конфиге туннеля.

Проверка до туннеля:

```bash
curl http://127.0.0.1:2567/health   # {"status":"ok"}
curl -I http://127.0.0.1:8080/      # 200
```

## 3. Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create crusade-deck
cloudflared tunnel route dns crusade-deck crusade.ПРИМЕР.com
cloudflared tunnel route dns crusade-deck api.crusade.ПРИМЕР.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: crusade-deck
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: api.crusade.ПРИМЕР.com
    service: http://127.0.0.1:2567
  - hostname: crusade.ПРИМЕР.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

WebSocket через туннель работает из коробки, отдельных флагов не нужно.
Прокси Cloudflare (оранжевое облако) на обеих записях должен быть включён —
`tunnel route dns` так и создаёт.

```bash
cloudflared tunnel run crusade-deck
```

## 4. Автозапуск

Три сервиса: `cloudflared`, игровой сервер, статика. Для cloudflared есть
штатное `cloudflared service install`. Для остальных двух — обычные unit-файлы
systemd, например `/etc/systemd/system/crusade-deck.service`:

```ini
[Unit]
Description=Crusade Deck game server (Colyseus)
After=network.target

[Service]
Type=simple
User=ПОЛЬЗОВАТЕЛЬ
WorkingDirectory=/home/ПОЛЬЗОВАТЕЛЬ/crusade-deck/server
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production
Environment=PORT=2567
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Аналогичный unit для статики с `ExecStart=/usr/bin/npx serve -s /home/ПОЛЬЗОВАТЕЛЬ/crusade-deck/client/dist -l 8080`
(или отдать её nginx/Caddy, если они на машине уже есть).

```bash
systemctl daemon-reload && systemctl enable --now crusade-deck
```

Логи: `journalctl -u crusade-deck -f`, `journalctl -u cloudflared -f`.

## 5. Проверка

```bash
curl https://api.crusade.ПРИМЕР.com/health
```

Ожидается `{"status":"ok"}`. Дальше открыть `https://crusade.ПРИМЕР.com` в
браузере: создаётся профиль, в DevTools → Network должен быть апгрейд
`101 Switching Protocols` на `wss://api.crusade.ПРИМЕР.com/...`.

Если страница открывается, а игра не подключается — почти всегда в бандле
остался неверный адрес (шаг 1) или сокет упёрся в хост без прокси Cloudflare.

## 6. Обновление версии

```bash
cd ~/crusade-deck && git pull
cd server && npm ci && npm run build
cd ../client && npm ci && npm run build
sudo systemctl restart crusade-deck
```

Статику перезапускать не нужно — `serve` отдаёт файлы с диска. Клиенту, скорее
всего, понадобится hard-reload.

> ⚠️ Комнаты, инвайт-коды и руки игроков живут **только в памяти** — рестарт
> сервера выкидывает всех из партии. Не обновлять посреди игры. Аккаунты
> (`server/data/accounts.json`) на диске и рестарт переживают.

## 7. Бэкап аккаунтов

`server/data/` в `.gitignore`, `git pull` его не трогает. Раз в сутки в `crontab -e`:

```
0 4 * * * mkdir -p ~/backups && cp ~/crusade-deck/server/data/accounts.json ~/backups/accounts-$(date +\%F).json
```

## Известные мелочи

- Firebase в зависимостях есть, но не используется и не настроен — ключи не
  нужны, вход работает на своих аккаунтах с recovery-кодом.
- Никаких обязательных переменных окружения у сервера нет, кроме `PORT`
  (по умолчанию 2567).
- Recovery-код копируется через `navigator.clipboard` — работает только в
  secure context, то есть по HTTPS. Через туннель это выполняется само собой,
  а вот по «голому» IP кнопка копирования отвалится.

## Fly.io (текущий прод)

Две аппы, конфиги лежат в самих пакетах (`server/fly.toml`, `client/fly.toml`):
`crusade-deck-server` и `crusade-deck-client`, регион `fra`.

Выкатывать скриптом, а не голым `fly deploy`:

```bash
scripts/deploy.sh          # обе аппы
scripts/deploy.sh server   # только одну
```

Он делает две вещи, которых голый `fly deploy` не умеет. Держит ПОРЯДОК (сервер первым —
клиент вшивает его адрес в бандл на этапе сборки) и передаёт НОМЕР СБОРКИ build-аргументом.
В контекст образа `.git` не попадает, поэтому обычный деплой соберёт образ с подписью
«dev», и по проду нельзя будет понять, что на нём крутится.

Версия видна в трёх местах: внизу экрана лобби, в меню настроек (полная — с коммитом и
временем сборки) и в `/health` сервера. Разъехавшаяся пара клиент/сервер — первое, что
стоит проверить, когда у одного игрока работает, а у другого нет.

Машины спят между визитами (`min_machines_running = 0`), поэтому первый запрос после паузы
будит сервер несколько секунд. Так и задумано: комнаты живут только в памяти, и рестарт
всё равно всех выкидывает.

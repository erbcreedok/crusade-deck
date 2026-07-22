# Деплой Crusade Deck

VPS: hoster.kz Cloud 1-2-50 (1 vCPU / 2 ГБ / 50 ГБ NVMe), ДЦ Алматы, Ubuntu 24.04 LTS.
Домен: `.com` через hoster.kz. Клиент и сервер на одной машине за Caddy — один origin,
TLS от Let's Encrypt, без CORS.

```
браузер ──https/wss──> Caddy :443 ─┬─ статика client/dist
                                   └─ reverse_proxy 127.0.0.1:2567 (Colyseus)
```

## 0. DNS — до всего остального

В панели hoster.kz две A-записи на IP сервера: `@` и `www`.
Проверить, что разошлось, **до** запуска Caddy — Let's Encrypt проверяет владение
доменом по HTTP-01, до резолва сертификат не выпустится:

```bash
dig +short ВАШ-ДОМЕН.com
```

## 1. Базовая настройка сервера (от root)

```bash
apt update && apt upgrade -y
adduser --disabled-password --gecos "" deploy && usermod -aG sudo deploy
```

Node 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs git
```

Caddy из официального репозитория:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Файрвол. Порт 80 нужен даже при редиректе на HTTPS — по нему идёт ACME-челлендж.
Порт 2567 наружу **не открывать**: Colyseus слушает только `127.0.0.1`.

```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

SSH: залить свой публичный ключ в `/home/deploy/.ssh/authorized_keys`, затем
в `/etc/ssh/sshd_config` выставить `PasswordAuthentication no` и `systemctl restart ssh`.

## 2. Собрать проект (от пользователя deploy)

```bash
git clone <repo-url> /home/deploy/crusade-deck
cd /home/deploy/crusade-deck/server && npm ci && npm run build
```

Клиент читает адрес сервера из переменных сборки (`client/src/colyseus.ts`,
`client/src/account.ts`). Перед сборкой создать `client/.env.production`
с реальным доменом — обязательно `wss://` и `https://`, иначе страница по HTTPS
не сможет открыть незащищённый сокет:

```bash
cd /home/deploy/crusade-deck/client
cat > .env.production <<'EOF'
VITE_SERVER_URL=wss://ВАШ-ДОМЕН.com
VITE_HTTP_URL=https://ВАШ-ДОМЕН.com
EOF
npm ci && npm run build
```

⚠️ `.env.local` подхватывается и прод-сборкой тоже, причём с приоритетом выше
`.env.production`. В git он не попадает, так что на сервере его быть не должно —
но если появится, в бандл уедет адрес из него. Проверить после сборки:

```bash
grep -c "ВАШ-ДОМЕН.com" dist/assets/index-*.js
```

Смена домена требует пересборки клиента: поправить `.env.production` и повторить
`npm run build`.

## 3. Запустить (от root)

```bash
cp /home/deploy/crusade-deck/deploy/crusade-deck.service /etc/systemd/system/
cp /home/deploy/crusade-deck/deploy/Caddyfile /etc/caddy/Caddyfile
```

В обоих файлах заменить `EXAMPLE.COM` на реальный домен, затем:

```bash
systemctl daemon-reload && systemctl enable --now crusade-deck && systemctl reload caddy
```

## 4. Проверка

```bash
curl https://ВАШ-ДОМЕН.com/health
curl -I http://ВАШ-ДОМЕН.com/
```

Ожидается `{"status":"ok"}` без `-k` и `308` редирект на HTTPS.
Дальше — открыть сайт в браузере: в DevTools → Network должен быть апгрейд
`101 Switching Protocols` на `wss://`.

Логи:

```bash
journalctl -u crusade-deck -f
journalctl -u caddy -f
```

## 5. Обновление версии

```bash
cd /home/deploy/crusade-deck && git pull
cd server && npm ci && npm run build
cd ../client && npm ci && npm run build
sudo systemctl restart crusade-deck
```

⚠️ Комнаты, инвайт-коды и руки игроков живут **только в памяти** — рестарт выкидывает
всех из партии. Аккаунты (`server/data/accounts.json`) на диске и переживают рестарт.
Не обновлять посреди игры.

## 6. Бэкап аккаунтов

`server/data/` в `.gitignore`, `git pull` его не трогает. Раз в сутки в `crontab -e`
пользователя `deploy`:

```
0 4 * * * mkdir -p ~/backups && cp ~/crusade-deck/server/data/accounts.json ~/backups/accounts-$(date +\%F).json
```

# Deploying Crusade Deck via Cloudflare Tunnel

Instructions for setting the project up on your own server. Nothing needs to be
exposed to the outside: the server keeps an outbound connection to Cloudflare, ports
80/443 on the machine can be left untouched, and TLS + the domain live on
Cloudflare's side.

## What the project is

A monorepo of two Node parts:

- `server/` — the game server on Colyseus (Express + WebSocket), listens on **:2567**.
  HTTP endpoints (`/accounts*`, `/rooms*`, `/health`, `/matchmake*`) and the game
  socket live on the same port.
- `client/` — React + Vite, built into static files (`client/dist`), no SSR. The
  server address is **baked into the bundle at build time**, so the client must be
  built once the final domains are known.

Requirements: **Node 20+** (tested on 22 LTS), git. Nothing else — no database, no
Redis. Account data lives in the JSON file `server/data/accounts.json`.

## Layout

Two public hosts on one server — the simplest setup for a tunnel, because the
Colyseus socket lives at the root (`/{processId}/{roomId}`) and can't be told apart
from static assets by path alone:

```
browser ──https──> Cloudflare ──tunnel──> cloudflared ─┬─ 127.0.0.1:8080  static client/dist
             wss                                       └─ 127.0.0.1:2567  Colyseus (API + socket)
```

- `crusade.EXAMPLE.com` → client static files
- `api.crusade.EXAMPLE.com` → game server

CORS is already open on the server (`Access-Control-Allow-Origin: *`), so different
hosts for the client and the API is a working configuration — no code changes needed.

Hostnames can be anything; below they show up in three places: the client's
`.env.production`, the tunnel's `config.yml`, and Cloudflare's DNS records.

## 1. Build the project

```bash
git clone <repo-url> ~/crusade-deck
cd ~/crusade-deck/server && npm ci && npm run build
```

Build the client only after the domains are decided. Use `wss://` and `https://`
without exception: an HTTPS page won't open an insecure socket.

```bash
cd ~/crusade-deck/client
cat > .env.production <<'EOF'
VITE_SERVER_URL=wss://api.crusade.EXAMPLE.com
VITE_HTTP_URL=https://api.crusade.EXAMPLE.com
EOF
npm ci && npm run build
```

Confirm the domain actually made it into the bundle:

```bash
grep -c "api.crusade.EXAMPLE.com" dist/assets/index-*.js
```

> ⚠️ If a `client/.env.local` happens to be sitting nearby, it overrides
> `.env.production` even in a production build. It's not committed to git and
> shouldn't exist on the server.

## 2. Start two local processes

**Game server:**

```bash
cd ~/crusade-deck/server && PORT=2567 NODE_ENV=production node dist/index.js
```

**Client static files** (needs an SPA fallback — invite links look like `/r/CODE`,
and without a fallback a reload gives a 404):

```bash
npx serve -s ~/crusade-deck/client/dist -l 8080
```

Any static server with an `index.html` fallback works — nginx, Caddy, whatever
you're used to. Port 8080 only matters for the tunnel config from here on.

Check before wiring up the tunnel:

```bash
curl http://127.0.0.1:2567/health   # {"status":"ok"}
curl -I http://127.0.0.1:8080/      # 200
```

## 3. Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create crusade-deck
cloudflared tunnel route dns crusade-deck crusade.EXAMPLE.com
cloudflared tunnel route dns crusade-deck api.crusade.EXAMPLE.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: crusade-deck
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: api.crusade.EXAMPLE.com
    service: http://127.0.0.1:2567
  - hostname: crusade.EXAMPLE.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

WebSocket works through the tunnel out of the box, no extra flags needed. The
Cloudflare proxy (orange cloud) must be enabled on both records — `tunnel route dns`
sets that up automatically.

```bash
cloudflared tunnel run crusade-deck
```

## 4. Auto-start on boot

Three services: `cloudflared`, the game server, the static files. `cloudflared` has
the built-in `cloudflared service install`. For the other two — plain systemd unit
files, e.g. `/etc/systemd/system/crusade-deck.service`:

```ini
[Unit]
Description=Crusade Deck game server (Colyseus)
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/crusade-deck/server
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production
Environment=PORT=2567
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

A similar unit for the static files with
`ExecStart=/usr/bin/npx serve -s /home/YOUR_USER/crusade-deck/client/dist -l 8080`
(or hand it off to nginx/Caddy if either is already on the machine).

```bash
systemctl daemon-reload && systemctl enable --now crusade-deck
```

Logs: `journalctl -u crusade-deck -f`, `journalctl -u cloudflared -f`.

## 5. Verify

```bash
curl https://api.crusade.EXAMPLE.com/health
```

Expect `{"status":"ok"}`. Then open `https://crusade.EXAMPLE.com` in a browser: a
profile gets created, and in DevTools → Network there should be a
`101 Switching Protocols` upgrade to `wss://api.crusade.EXAMPLE.com/...`.

If the page loads but the game won't connect — it's almost always a wrong address
baked into the bundle (step 1), or the socket hitting a host without the Cloudflare
proxy.

## 6. Updating

```bash
cd ~/crusade-deck && git pull
cd server && npm ci && npm run build
cd ../client && npm ci && npm run build
sudo systemctl restart crusade-deck
```

No need to restart the static server — `serve` reads files straight off disk. The
client will most likely need a hard reload.

> ⚠️ Rooms, invite codes, and player hands live **in memory only** — restarting the
> server kicks everyone out of their game. Don't update mid-session. Accounts
> (`server/data/accounts.json`) are on disk and survive a restart.

## 7. Backing up accounts

`server/data/` is in `.gitignore`, `git pull` won't touch it. Once a day via
`crontab -e`:

```
0 4 * * * mkdir -p ~/backups && cp ~/crusade-deck/server/data/accounts.json ~/backups/accounts-$(date +\%F).json
```

## Known quirks

- Firebase is in the dependencies but unused and unconfigured — no keys needed,
  sign-in works through custom accounts with a recovery code.
- The server has no required environment variables besides `PORT` (defaults to 2567).
- The recovery code is copied via `navigator.clipboard` — works only in a secure
  context, i.e. over HTTPS. That's automatic through the tunnel, but the copy button
  will break over a "bare" IP.

## Fly.io (current production)

Two apps, configs live in the packages themselves (`server/fly.toml`, `client/fly.toml`):
`crusade-deck-server` and `crusade-deck-client`, region `fra`.

Deploy with the script, not with a bare `fly deploy`:

```bash
scripts/deploy.sh          # both apps
scripts/deploy.sh server   # one of them
```

It does two things a bare `fly deploy` can't. It keeps the ORDER (the server goes first —
the client bakes the server's address into its bundle at build time), and it passes the
BUILD NUMBER in as a build arg. `.git` isn't part of the image context, so a bare deploy
produces a build labelled "dev" and you can't tell what's actually running in production.

The version shows up in three places: at the bottom of the lobby screen, in the settings
menu (full form, with commit and build time), and in the server's `/health`. If the client
and the server disagree, that's the first thing to check when something works for one
player and not another.

Machines sleep between visits (`min_machines_running = 0`), so the first request after a
pause takes a few seconds to wake the server. That's expected — rooms live in memory only,
and a restart already kicks everyone out anyway.

### CI

`.github/workflows/ci.yml` runs the tests of both packages on every push, and on `main`
deploys via the same `scripts/deploy.sh` — the deploy order and the build number live in
one place rather than in two that drift apart.

Two things the workflow has to get right, and both are easy to miss:

- `fetch-depth: 0` on checkout. The build number is the commit count; the default shallow
  clone would make it a permanent "1".
- `cancel-in-progress: false`. A flyctl cancelled halfway leaves the app in a partial
  state, so runs queue instead of superseding each other.

The deploy needs a `FLY_API_TOKEN` secret in the repository (Settings → Secrets and
variables → Actions). Create one with `fly tokens create deploy`.

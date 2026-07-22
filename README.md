# Crusade Deck

A multiplayer card game for mobile browsers. A monorepo of two Node parts:

- `server/` — the game server on Colyseus (Express + WebSocket, port **2567**).
- `client/` — React + Vite + Pixi.js, built into static files (`client/dist`), no SSR.

Requirements: **Node 20+** (tested on 22 LTS), npm, git.

For architecture and game-mechanics details, see `CLAUDE.md`.

## Local development

```bash
git clone <repo-url> crusade-deck
cd crusade-deck

cd server && npm ci && npm run dev    # :2567, auto-restarts on changes
```

In a second terminal:

```bash
cd client && npm ci && npm run dev    # :5173
```

Open `http://localhost:5173`. By default the client talks to
`ws://localhost:2567` — nothing else needs configuring for local development.

**Testing from a phone on the same Wi-Fi:** the client needs to talk to the machine's
LAN IP, not `localhost`. Create `client/.env.local` (in `.gitignore`, not committed):

```bash
cat > client/.env.local <<'EOF'
VITE_HTTP_URL=http://192.168.1.66:2567
VITE_SERVER_URL=ws://192.168.1.66:2567
EOF
```

with the machine's actual IP, then open `http://192.168.1.66:5173` on the phone.

### Tests

```bash
cd server && npm test && npx tsc --noEmit   # 139 tests
cd client && npm test && npx tsc --noEmit   # 449 tests
```

## Running in production

The client is static; the server address is **baked into the bundle at build time**
(`VITE_SERVER_URL`/`VITE_HTTP_URL`), so it must be built once the final domain is
known. Account data lives in `server/data/accounts.json` — the only thing that
survives a restart; rooms and games only live in the process's memory.

### Option A — a plain Linux server, directly

No tunnel: the server listens on a public IP/domain directly, ports 80/443 are open
to the outside, TLS is your own (Let's Encrypt) or via a reverse proxy.

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

Game server:

```bash
cd ~/crusade-deck/server && PORT=2567 NODE_ENV=production node dist/index.js
```

Static files (needs an SPA fallback to `index.html` — invite links like `/r/CODE`
will 404 on a direct load without one):

```bash
npx serve -s ~/crusade-deck/client/dist -l 8080
```

Then put any reverse proxy with TLS in front of these two ports (nginx, Caddy):
static files on `example.com` → `127.0.0.1:8080`, API and WebSocket on
`api.example.com` → `127.0.0.1:2567`. CORS on the server is already open
(`Access-Control-Allow-Origin: *`), so separate hosts for the client and the API is a
working configuration.

For systemd auto-start and updating, see sections 4 and 6 in `DEPLOY.md` — they're not
tied to any particular way of exposing the app to the internet.

### Option B — Cloudflare Tunnel (no open ports)

The server keeps an outbound connection to Cloudflare; ports 80/443 on the machine
don't need to be touched at all, and TLS + the domain live on Cloudflare's side. The
full step-by-step guide (creating the tunnel, `config.yml`, DNS, systemd units,
backing up accounts) is in **`DEPLOY.md`**.

### Option C — Docker / `docker compose`

`docker-compose.yml` at the repo root builds and runs both services: `server`
(port 2567, `server-data` volume so accounts survive container recreation) and
`client` (nginx serving the static build with an SPA fallback, port 8080).

```bash
docker compose up -d --build
```

By default the client bundle is built pointing at `ws://localhost:2567` — fine for a
local check. For production, the server address must be set **before the first
build** (it's baked into the bundle, same as everywhere else in this project): create
a `.env` next to `docker-compose.yml`:

```bash
cat > .env <<'EOF'
CRUSADE_SERVER_URL=wss://api.example.com
CRUSADE_HTTP_URL=https://api.example.com
EOF
docker compose up -d --build
```

Put a reverse proxy with TLS in front of ports 2567 and 8080 the same way as in
Option A — Docker here only replaces "install Node and run two processes", not the
routing/TLS layer. Rebuild the `client` image (`docker compose build client`)
whenever the server address changes; changing `.env` alone doesn't re-bake an
already-built image.

> These Dockerfiles/compose file are a first pass — reasonable but not yet verified
> end-to-end with a real `docker build`. Sanity-check locally before relying on them
> for a real deploy.

### Verifying after deploy

```bash
curl https://api.example.com/health   # {"status":"ok"}
```

Open `https://example.com` in a browser — a profile should get created. In DevTools →
Network there should be a `101 Switching Protocols` upgrade to
`wss://api.example.com/...`. If the page loads but the game won't connect, it's
almost always a wrong address baked into the bundle (check `.env.production`, and
make sure there's no stray `client/.env.local` lying around — it overrides
`.env.production` even in production).

## Known quirks

- The recovery code is copied via `navigator.clipboard` — works only in a secure
  context (HTTPS/localhost). Over "bare" HTTP on an external IP, the copy button
  won't work.
- Firebase is in the dependencies but unused and unconfigured — sign-in works through
  custom accounts with a recovery code.
- The server's only required environment variable is `PORT` (defaults to 2567).

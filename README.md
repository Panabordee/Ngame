# NGAME / CipherDeck

NGAME is a browser-based, server-authoritative card deduction game. It supports solo play with bots, 3–6 seat Quick Match and six-digit private rooms, host moderation and ready checks, four selectable visual themes, English/Thai UI, a deduction notebook, guess feed, Daily Cipher, achievements, seasonal leaderboard, replay/share results, friends/party invites, safe preset emotes, and privacy-safe spectators. Redis coordinates multi-instance room discovery and queues match results while the API is unavailable.

Operators can configure `ADMIN_EMAILS` to manage validated deck-theme metadata and assets through the protected `/admin/decks` API. Every mutation is recorded in `admin_audit_logs`.

The game table is landscape-first on mobile, with safe-area support, compact opponent racks, a fixed action dock, and a viewport-safe guess picker. Portrait phones receive a rotate prompt.

## Quick links

- [Documentation language index](docs/README.md) · [คู่มือภาษาไทย](README_TH.md)
- [Game rules](docs/GAME_RULES.md)
- [Local development](docs/LOCAL_DEVELOPMENT.md)
- [Docker, build, and deployment](docs/BUILD_AND_DEPLOY.md)
- [Ports](docs/PORTS.md)
- [Environment variables](docs/ENVIRONMENT.md)
- [Realtime protocol](docs/REALTIME_PROTOCOL.md)
- [Project structure](docs/PROJECT_STRUCTURE.md)
- [Authentication architecture](docs/architecture/AUTHENTICATION.md)
- [Proxmox deployment architecture](docs/architecture/DEPLOYMENT.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Product backlog](docs/ROADMAP.md)

## Fast verification

```bash
npm ci
npm run typecheck
npm test
npm run test:mobile --workspace @ngame/client
python -m pip install -e 'backend[dev]'
python -m pytest backend/tests
npm run build --workspace @ngame/client
```

With local API and realtime services running, execute `npm run smoke:local --workspace @ngame/server` for a three-player signed-JWT, host/ready, starting-selection, privacy, action, and room-code smoke test. Backend and realtime tests also cover Google authentication, Guest JWTs, one-match Guest binding, profile updates, and refresh sessions.

Run `npm run soak:bots --workspace @ngame/server` to exercise repeated complete bot matches and look for stuck phases or invalid transitions.

Node.js 24.18 or newer and Python 3.12 or newer are required. The production target is an Ubuntu Server 24.04 LTS VM on Proxmox with Docker Compose and an external Nginx reverse proxy.

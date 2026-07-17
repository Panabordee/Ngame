# NGAME / CipherDeck

NGAME is a browser-based, server-authoritative card deduction game. The MVP uses Google-only sign-in with editable player profiles, 3–6 player Quick Match and six-digit code rooms, host/ready start, Classic or private Custom deck settings, six-card starting-player selection, authoritative turn timers, viewer-safe state, and reconnect/forfeit handling.

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
python -m pip install -e 'backend[dev]'
python -m pytest backend/tests
npm run build --workspace @ngame/client
```

With local API and realtime services running, execute `npm run smoke:local --workspace @ngame/server` for a three-player signed-JWT, host/ready, starting-selection, privacy, action, and room-code smoke test. Backend tests cover Google authentication, profile updates, and refresh sessions.

Node.js 24.18 or newer and Python 3.12 or newer are required. The production target is an Ubuntu Server 24.04 LTS VM on Proxmox with Docker Compose and an external Nginx reverse proxy.

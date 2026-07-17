# Project structure

| Path | Responsibility |
| --- | --- |
| `client/` | React/Vite card-table client, auth controls, room actions, original art, and viewer-safe debug JSON |
| `server/` | Colyseus matchmaking, JWT verification, authoritative room, reconnect/forfeit handling |
| `shared/` | Pure game engine, shared types/protocol, privacy projection, serialization, and engine tests |
| `backend/` | FastAPI authentication API, SQLAlchemy models, Alembic migrations, and backend tests |
| `docs/` | Rules, protocol, operations, architecture, and limitation documents |
| `infra/nginx/` | External Nginx reverse-proxy example for the three public hostnames |
| `docker-compose.yml` | Frontend, API, realtime, PostgreSQL, Redis, and optional Mailpit orchestration |
| `.env.example` | Documented development/Compose configuration template with placeholders only |
| `secrets/` | Local JWT keys; ignored by Git and mounted as Docker secrets |
| `GAME_DESIGN.md` | Canonical detailed game design |
| `AGENTS.md` | Repository working and safety instructions |

## Important source files

- `shared/src/deck.ts`: standard deck creation, Joker count, secure-shuffle-compatible helpers.
- `shared/src/rack.ts`: rank/color comparison and Joker-tolerant insertion validation.
- `shared/src/game.ts`: deal, turn phases, guesses, penalties, elimination, winner, and forfeit transitions.
- `shared/src/view.ts`: per-player privacy projection.
- `shared/src/snapshot.ts`: authoritative state serialization for reconnect/persistence boundaries.
- `shared/src/protocol.ts`: message and state-envelope contracts shared by browser and realtime server.
- `server/src/CipherDeckRoom.ts`: authenticated room lifecycle and network-to-engine adapter.
- `server/src/auth.ts`: RS256 access-token verification.
- `backend/src/ngame_api/routers/auth.py`: browser authentication endpoints.
- `backend/src/ngame_api/services.py`: password, Google identity, access token, and refresh-session logic.
- `client/src/App.tsx`: authenticated lobby, match controls, and debug-state shell.
- `client/src/GameTable.tsx`: visual opponent seats, draw zone, rack insertion, card targeting, and penalty selection.
- `client/src/CardView.tsx`: hidden, standard, Joker, selected, and revealed card presentation.

Keep all rule transitions in `shared`; networking and UI may call those transitions but must not duplicate or decide game outcomes.

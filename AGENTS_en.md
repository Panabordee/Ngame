# AGENTS.md — Cipher Deck Project

## Project Context
Building a real-time multiplayer card deduction/bluffing game (full ruleset in `GAME_DESIGN.md`).
Short-term goal: a playable web multiplayer prototype (3–6 browsers, real game).
Long-term goal: a desktop build for Steam.

## Stack
- Frontend: React + TypeScript + Vite
- Realtime server: Node.js + Colyseus (authoritative state)
- Secondary backend (auth/leaderboard): FastAPI + PostgreSQL
- Containers: Docker / docker-compose for the dev environment

## Rules for Codex in This Project
1. **Explain before editing**: before touching anything that affects core game logic (cards/turns/win-loss), give a short summary of what will change and why, before making the edit.
2. **Never change core rules unilaterally** — if `GAME_DESIGN.md` and the code disagree, ask which one is authoritative before deciding.
3. **The server is always the source of truth**: the client must never decide win/loss or reveal cards on its own. Everything must be validated server-side in Colyseus to prevent cheating.
4. **Test before declaring done**: run `npm test` (frontend/server) and `pytest` (if FastAPI was touched) before summarizing work.
5. **Commit messages in English, short**, following conventional commits (feat:, fix:, refactor:, chore:).
6. **Never push directly to main** — work on a branch and let me review before merging.

## Expected Directory Structure
```
/client        React + Vite frontend
/server        Colyseus realtime server (TypeScript)
/backend       FastAPI (auth, leaderboard, match history)
/shared        types/schema shared between frontend and server
docker-compose.yml
GAME_DESIGN.md
```

## Out of Scope for Phase 1
- Do not start Steamworks integration until the web prototype has a fully playable loop.
- Do not implement any payment/monetization system yet.

# Kickoff Prompt for Codex
# (Place AGENTS.md, SKILL.md, and GAME_DESIGN.md at the project root first, then run this.)

Read GAME_DESIGN.md and AGENTS.md in this project fully before starting. Then survey the existing project before changing files and continue the feature as follows:

1. Inspect the existing /client, /server, /backend, and /shared structure and explain where each part of CipherDeck belongs before creating or changing files.
2. Set up /server as a bare Colyseus + TypeScript project that actually runs (npm run dev, connectable from a client).
3. Implement the game logic per the "cipher-deck-game-engine" skill: 52 standard cards plus 2–4 Jokers, 3–6 players, dealing, rack sort-order validation, correct/wrong guess logic, and end-game conditions — implement as pure functions that are easy to unit test, kept separate from the networking layer.
4. Write unit tests covering every item in the SKILL.md checklist.
5. Build /client as a bare React + Vite app that just connects to the Colyseus room and renders raw JSON state (no polished UI yet).
6. After finishing each step, give a short summary of what was done before moving to the next step. Don't batch all steps together and summarize at the end.

Do not implement Steamworks or any payment system in this pass — focus only on getting the web prototype's core loop fully playable.

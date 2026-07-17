# Cipher Deck — Card Deduction Game (Design Doc v0.1)

> Genre: multiplayer card deduction / bluffing with an original playing-card ruleset and identity.

## 1. Core Loop (adapted from the original board game)
- Deck: one standard 52-card deck plus a server-randomized 2–4 Jokers, for 54–56 cards per match.
- 3–6 players. Each player has a personal "rack" of cards. Standard cards must stay sorted low to high by rank (`A, 2–10, J, Q, K`), then by color with red before black. Suits do not affect sorting or guessing; cards with the same rank and color are equivalent for ordering. Jokers may be inserted at any rack position and are ignored when validating the order of the standard cards around them.
- At match start, the server randomly selects the Joker count, shuffles the complete deck, and deals enough cards to preserve at least four full draw rounds:
  - `base hand size = min(8, floor((deck size - 4 × player count) / player count))`
  - The first player receives `base + 1` cards.
  - The last player receives `base - 1` cards.
  - Every other player receives the base hand size. The +1/-1 adjustment keeps the total dealt unchanged.
- Players see their own rack fully, but only see the *revealed* cards of opponents.
- While the draw pile contains cards, draw one card and keep it outside the rack while guessing. The player must make at least one guess before that card can be placed. Guess a standard card by rank and color, or guess a Joker by declaring `JOKER` without a color.
  - Correct guess → that target is permanently revealed. The player may guess again or stop. If they stop, they choose one server-approved rack position for the pending card; it stays face-down, and the turn ends.
  - Wrong guess → reveal the pending drawn card, let the player choose one server-approved rack position for it, then end the turn. The target of the wrong guess stays hidden.
  - The server must validate placement. Standard cards may use only positions that preserve rank order and red-before-black order. A Joker may use any position. Equivalent cards can produce more than one valid position.
- When the draw pile is empty, the player must make exactly one guess. A correct guess reveals the target and ends the turn safely. A wrong guess moves to a penalty choice: the player selects one of their own unrevealed cards to reveal, then the turn ends.
- Jokers are Cipher cards: they may occupy any rack position and are guessed by declaring `JOKER` without a color. A correct Joker guess reveals only the targeted Joker and follows the same extra-guess rule as any other correct guess.
- A player loses when every card in their own rack has been revealed. The last active player wins.

## 2. Lobby and Reconnection
- A room is created with a fixed `desiredPlayers` value from 3–6 and starts automatically when that many authenticated players have joined.
- Public rooms are available through Quick Match. Private/code rooms receive a unique server-generated six-digit room code, are excluded from Quick Match, and can be joined by entering that code.
- Lock the room when the match starts; do not allow mid-match joins.
- Pause all game actions when a connected player drops and allow 30 seconds for reconnection.
- If the player does not reconnect in time, permanently reveal every card in their rack and eliminate them by forfeit. If they had drawn a card but had not inserted it yet, insert and reveal it before resolving the forfeit so no card disappears from authoritative state.
- If the forfeiting player owned the current turn, advance to the next active player. Apply the normal last-player-standing win condition after every forfeit.

## 3. Future Differentiators
Potential extensions after the core loop is stable:
- Add a "Wild/Cipher" card that can't be guessed directly and needs a special ability to resolve.
- Add a turn timer for real-time pressure instead of untimed turns.
- Add a 2v2 team mode with a limited number of shared hint tokens.
- Add ranked/MMR matchmaking for the online mode.

## 4. Recommended Tech Stack (ordered: easiest → Steam-ready)

### Phase 1 — Web Multiplayer
- Frontend: React + TypeScript + Vite.
- Realtime: Node.js + Colyseus with authoritative server state.
- Secondary backend (auth/leaderboard): FastAPI (Python) — matches your existing FastAPI experience from Mini-bankwebapp.
- DB: PostgreSQL for users/leaderboard, Redis for sessions/matchmaking queue.
- Deploy: Docker Compose on your existing infrastructure (Proxmox/Docker) + Cloudflare for TLS/CDN.

### Phase 2 — Steam Release
- Wrap the client with **Electron**, or rebuild in **Godot 4** (recommended — feels more native and exports to Steam more cleanly than Electron).
- Steamworks integration via GodotSteam (Godot) or greenworks/steamworks.js (Electron).
- The realtime backend (Colyseus) stays the same — only the client wrapper changes, the protocol doesn't.
- Register on Steamworks ($100 one-time fee per game) once you're ready to publish.

## 5. Rough Roadmap
1. Local prototype (3–6 browser sessions) — validate the ruleset.
2. Connect the Colyseus room across LAN and internet deployments.
3. Complete matchmaking, match history, and leaderboard.
4. Polish UI/UX, sound, animation.
5. Wrap as a desktop build → test Steamworks in sandbox → submit via Steam Direct.

## 6. Legal/Naming Note
Use the CipherDeck working name and original artwork, text, visual identity, and branding. Review the final product name before public release.

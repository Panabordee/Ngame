# Cipher Deck — Card Deduction Game (Design Doc v0.1)

> Genre: multiplayer card deduction / bluffing with an original playing-card ruleset and identity.

## 1. Core Loop (adapted from the original board game)
- A room uses either Classic or Custom rules. Classic uses one standard 52-card deck plus a server-randomized 2–4 Jokers, for 54–56 cards. A private/code-room host may instead choose Custom rules: 24–56 total cards, 2–4 Jokers, and 1–8 reserved draw rounds. The server randomly samples the required standard cards, includes the configured Jokers, and securely shuffles the result. The total must be compatible with the standard-card and Joker counts.
- 3–6 players. Each player has a personal "rack" of cards. Standard cards must stay sorted low to high by rank (`A, 2–10, J, Q, K`), then by color with red before black. Suits do not affect sorting or guessing; cards with the same rank and color are equivalent for ordering. Jokers may be inserted at any rack position and are ignored when validating the order of the standard cards around them.
- After everyone is ready, the host starts the match. The server presents six face-down cards; every eligible player selects a different card, and all selected cards are revealed together. Highest rank starts and Joker ranks above `K`. Equal highest ranks, including multiple Jokers, cause only the tied players to choose again from six freshly randomized cards that were not in the preceding choice set. This repeats until one starter remains.
- Every player's final selected card becomes a revealed card in their initial rack and counts toward their hand size. A standard selected card is inserted automatically in legal order. Before turn one, every Joker in every opening hand must be positioned by its owner, including hidden Jokers received from the normal deal and a revealed Joker selected during the starting-player draw. Opponents are never told which hidden cards are Jokers.
- The server deals enough cards to preserve the configured draw-round reserve (`4` in Classic):
  - `base hand size = min(8, floor((deck size - draw rounds × player count) / player count))`
  - The selected starting player receives `base + 1` cards.
  - The player immediately before the starter in turn order receives `base - 1` cards.
  - Every other player receives the base hand size. The +1/-1 adjustment keeps the total dealt unchanged.
- Players see their own rack fully, but only see the *revealed* cards of opponents.
- While the draw pile contains cards, draw one card and keep it outside the rack while guessing. The player must make at least one guess before that card can be placed. Guess a standard card by rank and color, or guess a Joker by declaring `JOKER` without a color.
  - Correct guess → that target is permanently revealed. The player may guess again or stop. If they stop, they choose one server-approved rack position for the pending card; it stays face-down, and the turn ends.
  - Wrong guess → reveal the pending drawn card, let the player choose one server-approved rack position for it, then end the turn. The target of the wrong guess stays hidden.
  - The server must validate placement. Standard cards may use only positions that preserve rank order and red-before-black order. A Joker may use any position. Equivalent cards can produce more than one valid position.
- When the draw pile is empty, the player must make exactly one guess. A correct guess reveals the target and ends the turn safely. A wrong guess moves to a penalty choice: the player selects one of their own unrevealed cards to reveal, then the turn ends.
- The host may set the action timer to Off, 30, 60, 90, 120, 180, or 300 seconds. Each successful action resets the server deadline so the next required decision receives the full configured time. Clients display the countdown and switch to an orange warning during the final 10 seconds. A player who does not act before the deadline is immediately eliminated: the server reveals their whole rack, preserves and reveals any pending drawn card, advances play, and re-evaluates the winner. During opening-Joker placement, every owner who leaves a Joker unplaced at the deadline is eliminated. The timer pauses during reconnection.
- Jokers are Cipher cards: they may occupy any rack position and are guessed by declaring `JOKER` without a color. A correct Joker guess reveals only the targeted Joker and follows the same extra-guess rule as any other correct guess.
- A player loses when every card in their own rack has been revealed. The last active player wins.

## 2. Lobby and Reconnection
- A room is created with a `desiredPlayers` value from 3–6. The creator is host and is implicitly ready because they control the Start action. The match never auto-starts: every connected non-host human must mark ready, and the host may start alone or with other humans. Empty seats up to `desiredPlayers` are filled by server-controlled bots. Changing room settings clears non-host ready state.
- If the host leaves before starting, host ownership transfers by join order.
- The player-facing lobby uses a single Create Room flow and asks for the desired total player count. Private rooms display a six-digit room code and invite link; public Quick Play does not require a code.
- Bots act only through the authoritative server transitions: they select a starting card, place opening Jokers, draw, guess, place, take penalties, and obey the same rack, turn, reveal, and win/loss validation as humans.
- Hosts choose Easy, Normal, or Hard bots. Easy guesses randomly, Normal avoids guesses it has publicly seen fail for the same card, and Hard additionally narrows guesses using revealed neighbors and legal rack order. No bot reads hidden opponent values.
- Private rooms expose a six-digit code and copyable invite URL. Public Quick Play and the current Create Room flow remain available.
- The server publishes a bounded public activity log and authoritative per-match guess statistics. Completed matches show a result screen; the host may request a rematch, which returns connected humans to the ready lobby and builds a fresh match.
- Registered-player results are reported server-to-server to FastAPI and stored for recent history, win rate, accuracy, and streak display. Guests remain ephemeral.
- Clients provide a guided rules tutorial, reconnect countdown overlay, sound controls, reduced motion, high contrast, color-blind symbols, adjustable card size, language selection, and selectable visual themes.
- Lock the room when the host starts the starting-card selection; do not allow mid-match joins.
- Pause all game actions when a connected player drops and allow 30 seconds for reconnection.
- If the player does not reconnect in time, permanently reveal every card in their rack and eliminate them by forfeit. If they had drawn a card but had not inserted it yet, insert and reveal it before resolving the forfeit so no card disappears from authoritative state.
- If the forfeiting player owned the current turn, advance to the next active player. Apply the normal last-player-standing win condition after every forfeit.

## 3. Recommended Tech Stack (ordered: easiest → Steam-ready)

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

## 4. Rough Roadmap
1. Local prototype (3–6 browser sessions) — validate the ruleset.
2. Connect the Colyseus room across LAN and internet deployments.
3. Complete matchmaking, match history, and leaderboard.
4. Polish UI/UX, sound, animation.
5. Wrap as a desktop build → test Steamworks in sandbox → submit via Steam Direct.

## 5. Legal/Naming Note
Use the CipherDeck working name and original artwork, text, visual identity, and branding. Review the final product name before public release.

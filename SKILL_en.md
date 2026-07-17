---
name: cipher-deck-game-engine
description: Use this skill when creating or editing the game logic of the Cipher Deck card deduction game (guessing an opponent's rank/color or colorless JOKER) — including server-side deck setup, dealing, rack ordering, turn engine, freely positioned Cipher Jokers, and win-condition logic.
---

# Cipher Deck — Game Engine Skill

## When to Use This Skill
Trigger this skill for tasks involving:
- Dealing cards / building player racks / enforcing card sort order
- Turn logic (correct guess, wrong guess, card reveal, extra guesses)
- Win/loss conditions
- Colyseus room state / schema for this game

## Core Rules to Implement Exactly (see GAME_DESIGN.md)
1. Support 3–6 players. Classic uses 52 standard cards plus 2–4 server-randomized Cipher Jokers. A private Custom room may use 24–56 total cards, 2–4 Jokers, and 1–8 draw rounds, with every value validated server-side.
2. Preserve the configured draw reserve (`4` in Classic). Compute `base = min(8, floor((deckSize - drawRounds * playerCount) / playerCount))`; deal `base + 1` to the selected starter, `base - 1` to the player immediately before the starter in turn order, and `base` to everyone else.
3. Keep standard cards sorted by rank (`A, 2–10, J, Q, K`), then color (red before black). Ignore suits. Treat standard cards with the same rank and color as ordering-equivalent. Allow Jokers at any rack position and ignore them when validating the surrounding standard-card order. Validate every insertion on the server.
4. While the draw pile contains cards, draw exactly one card and keep it pending outside the rack. Require at least one guess before placement. A correct guess permanently reveals the target and lets the player either guess again or stop; stopping requires the player to choose a server-validated rack slot, places the pending card face-down, and ends the turn.
5. A wrong guess while holding a pending drawn card leaves the guessed target hidden, permanently reveals the pending card, then requires the player to choose a server-validated rack slot before the turn ends.
6. When the draw pile is empty, require exactly one guess. A correct guess reveals the target and ends the turn safely. A wrong guess requires the player to choose one of their own unrevealed cards to reveal, then ends the turn.
7. Guess a Joker by declaring `JOKER` without a color. A correct Joker guess reveals only the targeted Joker and grants another guess normally.
8. A player loses when every card in their rack is revealed; the last remaining player wins.
9. Never auto-start. The room creator is host, every connected player readies, and the host starts with 3–6 players. Select the starter from six hidden cards; tied highest ranks or multiple Jokers redraw only tied players from a fresh set. The selected cards enter racks revealed. Every Joker in every opening hand, including hidden normally dealt Jokers, requires owner-selected placement without leaking its identity to opponents. Pause on disconnect for 30 seconds; on reconnect timeout, preserve/reveal pending state, eliminate the player, advance if needed, and re-evaluate the winner.
10. A configured action deadline is server-authoritative and resets after each successful action. Clients warn in orange during the final 10 seconds. Missing a deadline immediately eliminates the responsible player, reveals their full rack, preserves/reveals a pending draw, advances play, and re-evaluates the winner. Opening-Joker owners who have not completed placement at its deadline are also eliminated.

## Checklist Before Submitting Work (use every time game logic is touched)
- [ ] The server is the sole arbiter — never the client (anti-cheat).
- [ ] Unit tests cover: Classic and Custom decks, 2–4 Jokers, 3–6 player deals, configured draw reserve, starting-card ties, every opening-hand Joker at every slot, action-timeout elimination, mandatory pre-placement guess, continue-or-stop, hidden/revealed placement, empty-pile self-penalty, duplicate ranks, invalid sort order, and end-game conditions.
- [ ] State broadcast to each client only contains what that client is allowed to see (never send the hidden values of other players' unrevealed cards — this is the most common vulnerability in this genre of game).
- [ ] Reconnect handling: pause actions for 30 seconds, preserve the full state on reconnect, and test the timeout-forfeit path without losing a pending drawn card.

## Reference Scripts
scripts/deal.ts — example deal/shuffle function (have Codex generate this from the spec above; no pre-existing file needed).

## Security Notes (matches the user's cybersecurity background)
- Validate every client action server-side (never trust client payloads directly).
- Use Colyseus's authoritative room state; never put secrets (unrevealed card values) into client-visible state.
- Rate-limit actions per turn to prevent spam/DoS from a malicious client.

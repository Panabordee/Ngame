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
1. Support 3–6 players with a standard 52-card deck plus a server-randomized 2–4 Cipher Jokers.
2. Preserve at least four full draw rounds. Compute `base = min(8, floor((deckSize - 4 * playerCount) / playerCount))`; deal `base + 1` to the first player, `base - 1` to the last, and `base` to everyone else.
3. Keep standard cards sorted by rank (`A, 2–10, J, Q, K`), then color (red before black). Ignore suits. Treat standard cards with the same rank and color as ordering-equivalent. Allow Jokers at any rack position and ignore them when validating the surrounding standard-card order. Validate every insertion on the server.
4. Correct rank-and-color guess → permanently reveal the target and let the guessing player guess again.
5. Wrong guess after drawing → permanently reveal the drawn card in its sorted rack position and end the turn.
6. Wrong guess with an empty draw pile → the guessing player chooses one of their own unrevealed cards to reveal, then the turn ends.
7. Guess a Joker by declaring `JOKER` without a color. A correct Joker guess reveals only the targeted Joker and grants another guess normally.
8. A player loses when every card in their rack is revealed; the last remaining player wins.
9. Start fixed-size 3–6 player rooms automatically when full. Pause on disconnect for 30 seconds; on timeout, reveal the dropped player's full rack, preserve/reveal any pending drawn card, eliminate them, advance their turn if necessary, and re-evaluate the winner.

## Checklist Before Submitting Work (use every time game logic is touched)
- [ ] The server is the sole arbiter — never the client (anti-cheat).
- [ ] Unit tests cover: 2–4 randomized Jokers, 3–6 player deals, four-round draw reserve, correct guess, both wrong-guess paths, duplicate ranks, invalid sort order, and end-game conditions.
- [ ] State broadcast to each client only contains what that client is allowed to see (never send the hidden values of other players' unrevealed cards — this is the most common vulnerability in this genre of game).
- [ ] Reconnect handling: pause actions for 30 seconds, preserve the full state on reconnect, and test the timeout-forfeit path without losing a pending drawn card.

## Reference Scripts
scripts/deal.ts — example deal/shuffle function (have Codex generate this from the spec above; no pre-existing file needed).

## Security Notes (matches the user's cybersecurity background)
- Validate every client action server-side (never trust client payloads directly).
- Use Colyseus's authoritative room state; never put secrets (unrevealed card values) into client-visible state.
- Rate-limit actions per turn to prevent spam/DoS from a malicious client.

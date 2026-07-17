# CipherDeck product backlog (draft)

This document records requested future work. It does not override `GAME_DESIGN.md`; a feature becomes authoritative only after its open rule decisions are resolved and the canonical design is updated.

Status (2026-07-17): items 2–9 are implemented. Protected admin/deck-art management remains future work. The canonical rules have been moved to `GAME_DESIGN.md`.

## Recommended order

1. Immediate UX: Enter-to-join, opponent names, contextual guess picker, and hide the manual Sync button.
2. Host ownership, ready/manual start, and room settings.
3. Starting-player card-selection phase, including revealed placement and Joker placement.
4. Protected admin and card-art/deck-theme management.
5. Full usernames, avatars, and player profiles last.

## 1. Protected admin and deck artwork

- Add `/admin` and FastAPI endpoints protected by an explicit `admin` role.
- Do not expose arbitrary SQL/database editing in a browser. Use validated resource forms, action-specific permissions, and an audit log.
- Manage deck themes, card backs, Joker/face artwork, previews, versions, and activation status.
- Store image files in object storage or a volume; PostgreSQL stores metadata, URL, checksum, version, and editor identity.
- Initially, a new deck means a visual theme. Rule-changing deck composition must be a separate server-validated preset.

### Art specification

| Use | Pixels | Ratio | Notes |
| --- | ---: | ---: | --- |
| Editable master | `1024 × 1536` | `2:3` | PNG or lossless WebP, sRGB |
| In-game runtime | `512 × 768` | `2:3` | WebP, target at most `2 MB` |
| Admin thumbnail | `160 × 240` | `2:3` | WebP |

Keep a `64 px` master / `32 px` runtime safe area. Do not bake rounded corners or shadows into artwork because the client applies them in CSS. The existing `cipher-card-back.webp` is the `512 × 768` reference. A minimum theme needs one card back; a full face-art theme needs explicit mappings for all 52 standard cards and Joker variants.

Expected data resources: `card_decks`, `card_assets`, `admin_audit_logs`, and admin roles/permissions.

## 2. Usernames and player profiles (last)

- Short term: show the server-verified Google display name instead of a shortened UUID.
- Full profile: editable display name, unique username, avatar, validation, reserved words, moderation, and change rate limits.
- Realtime must receive trusted identity metadata from the access token/API, never trust a client-supplied name.

The previous opponent label was a shortened account UUID; it was not encrypted text. The table now uses the verified display name.

## 3. Pre-match room settings

The host edits settings, the server broadcasts them, and settings lock when the match starts:

- Turn timer: Off / 30 / 60 / 90 / 120 / 180 / 300 seconds.
- Player count: 3–6.
- Initial-card/deal preset.
- Draw-round reserve.
- Allowed visual deck theme.

Quick Match uses Classic. Private rooms may use Custom with 24–56 total cards, 1–8 draw rounds, 2–4 Jokers, and validated timer choices. Timeout behavior is documented in `GAME_DESIGN.md`.

## 4. Host-controlled start

- The room creator becomes host and receives a `Start game` action.
- Remove automatic start when the room fills.
- Start only with at least three players, no more than the room limit, and all players ready.
- Transfer host by join order if the host leaves before the match.
- The server locks the room/settings and enters the starting-player phase.

## 5. Six-card starting-player selection

- The server presents six face-down cards; each player selects one without replacement.
- Reveal after all players select. Highest rank starts; a Joker beats standard cards.
- Each selected card enters its player's rack face-up in a legal position.
- With fewer than six players, unused cards return to the deck and the server reshuffles.
- Count the selected card as part of the initial hand to avoid increasing hand size accidentally.

Equal highest ranks and multiple Jokers redraw only the tied players from a fresh six-card set. Selected cards reveal together after every eligible player chooses.

## 6. Starting Joker placement

If a player selects a Joker, they may choose any rack slot. It remains revealed and the server validates/persists the slot. The current engine already permits Jokers at every rack position; this requires a new pre-turn phase and UI.

## 7. Opponent names

Add verified display names to authenticated room metadata. Show name plus host/ready/disconnected status while keeping UUIDs internal. Handle duplicate and long names with a stable fallback.

## 8. Enter-to-join room code

Wrap the room-code input in a form and handle submit. Enter behaves like `Join code`, duplicate submissions are disabled while connecting, and errors render beside the input.

## 9. Contextual guess picker

Clicking an opponent card opens an anchored popover. Select rank (`A`–`K`) or `JOKER` first; a standard rank then reveals Red/Black choices. Show a summary such as `Guess: black 4` and require confirmation. Escape/outside click cancels. The popover never receives hidden card values and the server remains the only arbiter.

## Why the Sync action exists

Sync asks Colyseus for the latest viewer-safe state snapshot. It does not save to the database, change turns, draw, or resolve actions. It protects against a missed initial state and refreshes state after reconnection. Because the client already sends Sync after join/reconnect, remove it from the normal player toolbar and keep it inside the networking layer or a developer menu.

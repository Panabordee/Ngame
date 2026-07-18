# Realtime room protocol

The Colyseus room name is `cipher_deck`. FastAPI issues the signed access JWT. Colyseus uses `sub` as player ID and the server-issued `name` claim as display name. Registered JWTs use `account_type=registered`; ephemeral JWTs use `account_type=guest` with a server-generated `guest_session_id`.

## Join

Assign the access token before matchmaking. Quick Match joins only public rooms with the same fixed player count:

```ts
const client = new Client("http://localhost:2567");
client.auth.token = accessToken;
const room = await client.joinOrCreate("cipher_deck", {
  desiredPlayers: 3,
  lobbyMode: "public",
});
```

`desiredPlayers` must be an integer from 3 through 6. Rooms with different desired counts do not match together. After Start, ordinary joins are rejected by the room while `{ spectator: true }` may join a started code room with a public-only projection. Quick Match stays Classic; code-room hosts may apply Custom rules before readying.

Create a numbered room with `client.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" })`. The server returns a unique six-digit `roomCode` in the state. To join it, request `GET /rooms/by-code/{roomCode}`, read the returned `roomId`, and call `client.joinById(roomId)`. Code rooms never match Quick Match requests.

Register message handlers immediately, then send `sync`. The explicit sync prevents a client from missing a state message emitted during the join handshake.

A Guest session may reserve only one room. It may switch rooms only after leaving a waiting lobby before Start. Once the host starts, the binding is committed and that Guest JWT cannot join another match. The browser stores `room.reconnectionToken` in per-tab `sessionStorage` and calls `client.reconnect(token)` after a reload; it does not create a new identity to bypass a forfeit.

Every authenticated account also has one active player-room reservation. Redis performs atomic `SET NX` reservation and compare-and-delete release across realtime replicas. A temporary disconnect retains the reservation through the reconnect window; leaving or reconnect timeout releases it. Spectator joins do not consume a player reservation.

## Client-to-server messages

| Type | Payload | Valid phase |
| --- | --- | --- |
| `sync` | none | any |
| `ready` | `true` or `false` | waiting lobby |
| `update-guest-name` | `{ "displayName": "Cipher Guest" }` | waiting lobby, Guest only |
| `update-settings` | `{ preset, turnSeconds, totalCards, drawRounds, jokerCount }` | waiting lobby, host only |
| `start-game` | none | waiting lobby, host only, everyone ready |
| `rematch` | none | finished, host only; returns everyone to a ready-check lobby |
| `kick-player` / `transfer-host` | `{ "playerId": "user UUID" }` | waiting lobby, host only |
| `emote` | `{ "emote": "thinking | nice | oops | good-game" }` | any joined phase |
| `select-starting-card` | `{ "cardId": "opaque option ID" }` | starting selection |
| `place-starting-joker` | `{ "rackIndex": 0 }` | `starter-place`, owner only |
| `draw` | none | `draw` |
| `insert` | `{ "rackIndex": 0 }` | `place` or `penalty-place` |
| `guess` | structure below | `guess` |
| `stop` | none | `guess`, after at least one correct guess with a pending card |
| `self-penalty` | `{ "cardId": "own opaque card ID" }` | `self-penalty` |

Standard guess:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "standard", "rank": "Q", "color": "red" }
}
```

Joker guess:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "joker" }
}
```

Classic normalizes settings to the full deck, four draw rounds, and randomized Jokers. Custom validates 24–56 total cards, 1–8 draw rounds, and 2–4 Jokers.

The authoritative game phases are `starter-place`, `draw`, `guess`, `place`, `penalty-place`, `self-penalty`, and `game-over`. A draw moves directly to `guess`. A correct guess with a pending card increments `correctGuessesThisTurn`; `stop` then opens `place`. A wrong guess opens `penalty-place` and reveals the pending card. With an empty pile, a correct guess advances immediately and a wrong guess opens `self-penalty`.

The server derives the actor from the authenticated connection. No payload can choose or override `actorId`.

## Server-to-client messages

`state` contains:

```json
{
  "status": "waiting | starting | playing | paused | finished",
  "desiredPlayers": 3,
  "lobbyMode": "public | code",
  "roomCode": "123456 or null",
  "settings": "validated RoomSettings",
  "startingSelection": "viewer-safe setup object or null",
  "hostPlayerId": "user UUID",
  "connectedPlayers": 3,
  "players": "display name, account type, host, ready, and connection status",
  "droppedPlayerIds": [],
  "serverTimeMs": 0,
  "turnDeadlineMs": "epoch milliseconds or null",
  "deductionMisses": "public wrong guesses retained for the deduction notebook",
  "game": "viewer-safe game object or null",
  "isSpectator": false
}
```

During starting selection, option values remain hidden until every eligible player chooses. Only selected cards reveal; resolved cards stay public during tie redraws. The `game` projection contains viewer-safe racks, draw-pile count, current player, phase, starting-card IDs, the viewer's own `pendingStartingJokerCardIds`, pending draw, winner, and turn. Another player's pending opening-Joker IDs are never projected. An unrevealed opponent card has only `{ id, kind: "hidden", revealed: false }`.

`guest-name-updated` confirms the normalized room display name. Guest names are 1–32 characters, must be unique inside that room when changed, and lock when Start is accepted. Every room player includes `accountType`; clients must display a visible Guest badge so a Guest name cannot be mistaken for a persistent profile.

`error` contains `{ "code": "...", "message": "..." }`. Expected codes include `INVALID_MESSAGE`, `INVALID_GUEST_NAME`, `GUEST_ONLY`, `NAME_TAKEN`, `MATCH_ALREADY_STARTED`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `RATE_LIMITED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION`, and `INVALID_TARGET`.

Room messages use both a per-connection limit and a Redis per-user/second bucket controlled by `MAX_ROOM_MESSAGES_PER_SECOND`. Any game result sent by a client is ignored; only the authoritative room evaluates reveals, elimination, and the winner.

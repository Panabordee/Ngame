# Realtime room protocol

The Colyseus room name is `cipher_deck`. FastAPI issues the short-lived access JWT. Colyseus uses `sub` as player ID and the server-issued `name` claim as display name.

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

`desiredPlayers` must be an integer from 3 through 6. Rooms with different desired counts do not match together. The room locks when the host starts and rejects duplicate identities or mid-match joins. Quick Match stays Classic; code-room hosts may apply Custom rules before readying.

Create a numbered room with `client.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" })`. The server returns a unique six-digit `roomCode` in the state. To join it, request `GET /rooms/by-code/{roomCode}`, read the returned `roomId`, and call `client.joinById(roomId)`. Code rooms never match Quick Match requests.

Register message handlers immediately, then send `sync`. The explicit sync prevents a client from missing a state message emitted during the join handshake.

## Client-to-server messages

| Type | Payload | Valid phase |
| --- | --- | --- |
| `sync` | none | any |
| `ready` | `true` or `false` | waiting lobby |
| `update-settings` | `{ preset, turnSeconds, totalCards, drawRounds, jokerCount }` | waiting lobby, host only |
| `start-game` | none | waiting lobby, host only, everyone ready |
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
  "players": "display name, host, ready, and connection status",
  "droppedPlayerIds": [],
  "serverTimeMs": 0,
  "turnDeadlineMs": "epoch milliseconds or null",
  "game": "viewer-safe game object or null"
}
```

During starting selection, option values remain hidden until every eligible player chooses. Only selected cards reveal; resolved cards stay public during tie redraws. The `game` projection contains viewer-safe racks, draw-pile count, current player, phase, starting-card IDs, the viewer's own `pendingStartingJokerCardIds`, pending draw, winner, and turn. Another player's pending opening-Joker IDs are never projected. An unrevealed opponent card has only `{ id, kind: "hidden", revealed: false }`.

`error` contains `{ "code": "...", "message": "..." }`. Expected codes include `INVALID_MESSAGE`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION`, and `INVALID_TARGET`.

Room messages are rate-limited by `MAX_ROOM_MESSAGES_PER_SECOND`. Any game result sent by a client is ignored; only the authoritative room evaluates reveals, elimination, and the winner.

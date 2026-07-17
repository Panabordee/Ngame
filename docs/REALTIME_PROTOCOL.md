# Realtime room protocol

The Colyseus room name is `cipher_deck`. FastAPI is the credential issuer; Colyseus accepts only a valid short-lived access JWT and uses its `sub` claim as the player ID.

## Join

Assign the access token before matchmaking and pass a fixed player count:

```ts
const client = new Client("http://localhost:2567");
client.auth.token = accessToken;
const room = await client.joinOrCreate("cipher_deck", { desiredPlayers: 3 });
```

`desiredPlayers` must be an integer from 3 through 6. Rooms with different desired counts do not match together. The room locks when full and rejects duplicate identities or mid-match joins.

Register message handlers immediately, then send `sync`. The explicit sync prevents a client from missing a state message emitted during the join handshake.

## Client-to-server messages

| Type | Payload | Valid phase |
| --- | --- | --- |
| `sync` | none | any |
| `draw` | none | `draw` |
| `insert` | `{ "rackIndex": 0 }` | `insert` |
| `guess` | structure below | `guess` |

Standard guess:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "standard", "rank": "Q", "color": "red" },
  "selfRevealCardId": null
}
```

Joker guess with the required empty-pile penalty selection:

```json
{
  "targetPlayerId": "user UUID",
  "targetCardId": "opaque card ID",
  "guess": { "kind": "joker" },
  "selfRevealCardId": "own opaque card ID"
}
```

The server derives the actor from the authenticated connection. No payload can choose or override `actorId`.

## Server-to-client messages

`state` contains:

```json
{
  "status": "waiting | playing | paused | finished",
  "desiredPlayers": 3,
  "connectedPlayers": 3,
  "droppedPlayerIds": [],
  "game": "viewer-safe game object or null"
}
```

The `game` projection contains player racks, draw-pile count, current player ID, phase, the current viewer's pending draw when applicable, drawn-card ID, winner, and turn number. An unrevealed opponent card has only `{ id, kind: "hidden", revealed: false }`.

`error` contains `{ "code": "...", "message": "..." }`. Expected codes include `INVALID_MESSAGE`, `MATCH_NOT_STARTED`, `MATCH_PAUSED`, `INVALID_TURN`, `WRONG_PHASE`, `INVALID_INSERTION`, and `INVALID_TARGET`.

Room messages are rate-limited by `MAX_ROOM_MESSAGES_PER_SECOND`. Any game result sent by a client is ignored; only the authoritative room evaluates reveals, elimination, and the winner.

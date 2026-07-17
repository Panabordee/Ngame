import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ColyseusClientRoom } from "@colyseus/sdk";
import {
  deserializeGameState,
  type CardGuess,
  type ClientGameView,
  type StateEnvelope,
  validInsertionIndexes,
} from "@ngame/shared";

import { createGameServer } from "./app.config.ts";
import { CipherDeckRoom } from "./CipherDeckRoom.ts";
import { loadServerConfig } from "./config.ts";
import type { ServerConfig } from "./config.ts";

const TEST_CONFIG: ServerConfig = {
  port: 2568,
  hostname: "127.0.0.1",
  jwtPublicKeyFile: "unused-in-room-tests.pem",
  jwtIssuer: "http://test.invalid",
  jwtAudience: "ngame-test",
  corsAllowedOrigins: ["http://frontend.test"],
  reconnectSeconds: 1,
  maxMessagesPerSecond: 100,
};

let testServer: ColyseusTestServer;

before(async () => {
  testServer = await boot(
    createGameServer(TEST_CONFIG, async (token) => {
      if (!token.startsWith("user-")) {
        throw new Error("Invalid test credential.");
      }
      return { userId: token, displayName: `Player ${token.slice(5)}` };
    }),
  );
});

after(async () => {
  await testServer.cleanup();
  await testServer.shutdown();
});

function ownView(envelope: StateEnvelope, userId: string): ClientGameView {
  assert.notEqual(envelope.game, null);
  assert.equal(envelope.game?.players.some((player) => player.id === userId), true);
  return envelope.game as ClientGameView;
}

async function requestState(
  client: {
    send(type: string): void;
    waitForMessage(type: string): Promise<unknown>;
  },
): Promise<StateEnvelope> {
  const response = client.waitForMessage("state") as Promise<StateEnvelope>;
  client.send("sync");
  return response;
}

function waitForStateWhere(
  client: ColyseusClientRoom,
  predicate: (state: StateEnvelope) => boolean,
  timeoutMilliseconds = 2_000,
): Promise<StateEnvelope> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the expected room state."));
    }, timeoutMilliseconds);
    const unsubscribe = client.onMessage<StateEnvelope>("state", (state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });
}

function waitForSignal(
  signal: { once(callback: () => void): void },
  description: string,
  timeoutMilliseconds = 2_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}.`));
    }, timeoutMilliseconds);
    signal.once(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

test("room rejects invalid credentials and invalid lobby sizes", async () => {
  const health = await testServer.http.get("/healthz", {
    headers: { Origin: "http://frontend.test" },
  });
  assert.equal(health.headers["x-powered-by"], undefined);
  assert.equal(health.headers["access-control-allow-origin"], "http://frontend.test");
  const blockedCors = await testServer.http.get("/healthz", {
    headers: { Origin: "https://attacker.example" },
  });
  assert.notEqual(
    blockedCors.headers["access-control-allow-origin"],
    "https://attacker.example",
  );

  testServer.sdk.auth.token = "invalid";
  await assert.rejects(
    testServer.sdk.joinOrCreate("cipher_deck", {
      desiredPlayers: 3,
      lobbyMode: "public",
    }),
    /Invalid or expired credentials/,
  );

  testServer.sdk.auth.token = "user-invalid-lobby";
  await assert.rejects(
    testServer.sdk.joinOrCreate("cipher_deck", {
      desiredPlayers: 2,
      lobbyMode: "public",
    }),
    /desiredPlayers must be an integer from 3 to 6/,
  );
});

test("server config requires exact CORS origins", () => {
  assert.throws(
    () => loadServerConfig({ CORS_ALLOWED_ORIGINS: "*" }),
    /exact origin, not a wildcard/,
  );
  assert.throws(
    () => loadServerConfig({ CORS_ALLOWED_ORIGINS: "https:\/\/example.com\/path" }),
    /exact HTTP\(S\) origins/,
  );
  assert.deepEqual(
    loadServerConfig({
      CORS_ALLOWED_ORIGINS: "https://one.example, https://two.example",
    }).corsAllowedOrigins,
    ["https://one.example", "https://two.example"],
  );
});

test("three authenticated clients can play without leaking hidden cards", async () => {
  testServer.sdk.auth.token = "user-1";
  const client1 = await testServer.sdk.joinOrCreate("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
  client1.onMessage("state", () => undefined);
  testServer.sdk.auth.token = "user-2";
  const client2 = await testServer.sdk.joinOrCreate("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
  client2.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-3";
  const client3 = await testServer.sdk.joinOrCreate("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
  client3.onMessage("state", () => undefined);
  const [envelope1, envelope2] = await Promise.all([
    requestState(client1),
    requestState(client2),
  ]);

  assert.equal(envelope1.status, "playing");
  assert.equal(envelope1.connectedPlayers, 3);
  assert.equal(
    envelope1.players.find((player) => player.id === "user-2")?.displayName,
    "Player 2",
  );
  const view1 = ownView(envelope1, "user-1");
  const view2 = ownView(envelope2, "user-2");
  assert.equal(view1.currentPlayerId, "user-1");
  assert.equal(view1.phase, "draw");

  for (const player of view1.players) {
    assert.equal(
      player.rack.every((card) =>
        player.id === "user-1" ? card.kind !== "hidden" : card.kind === "hidden",
      ),
      true,
    );
  }
  for (const player of view2.players) {
    assert.equal(
      player.rack.every((card) =>
        player.id === "user-2" ? card.kind !== "hidden" : card.kind === "hidden",
      ),
      true,
    );
  }

  const invalidTurn = client2.waitForMessage("error") as Promise<{
    code: string;
    message: string;
  }>;
  client2.send("draw");
  assert.equal((await invalidTurn).code, "INVALID_TURN");

  const drawState = client1.waitForMessage("state") as Promise<StateEnvelope>;
  client1.send("draw");
  const afterDraw = ownView(await drawState, "user-1");
  assert.equal(afterDraw.phase, "guess");
  assert.notEqual(afterDraw.pendingDraw, null);
  assert.notEqual(afterDraw.pendingDraw?.kind, "hidden");

  const serverRoom = testServer.getRoomById<CipherDeckRoom>(client1.roomId);
  let authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  const targetPlayer = authoritative.players.find((player) => player.id === "user-2");
  const correctTarget = targetPlayer?.rack.find((card) => !card.revealed);
  assert.notEqual(correctTarget, undefined);
  const correctGuess: CardGuess =
    correctTarget?.kind === "joker"
      ? { kind: "joker" }
      : {
          kind: "standard",
          rank: correctTarget?.rank ?? "A",
          color: correctTarget?.color ?? "red",
        };
  const correctState = client1.waitForMessage("state") as Promise<StateEnvelope>;
  client1.send("guess", {
    targetPlayerId: "user-2",
    targetCardId: correctTarget?.id,
    guess: correctGuess,
  });
  const afterCorrect = ownView(await correctState, "user-1");
  assert.equal(afterCorrect.currentPlayerId, "user-1");
  assert.equal(afterCorrect.phase, "guess");
  assert.equal(afterCorrect.correctGuessesThisTurn, 1);
  assert.equal(
    afterCorrect.players
      .find((player) => player.id === "user-2")
      ?.rack.find((card) => card.id === correctTarget?.id)?.revealed,
    true,
  );

  const stopState = client1.waitForMessage("state") as Promise<StateEnvelope>;
  client1.send("stop");
  assert.equal(ownView(await stopState, "user-1").phase, "place");

  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  const activePlayer = authoritative.players[authoritative.currentPlayerIndex];
  assert.notEqual(activePlayer, undefined);
  assert.notEqual(authoritative.pendingDraw, null);
  const rackIndex = validInsertionIndexes(activePlayer?.rack ?? [], authoritative.pendingDraw!)[0];
  assert.notEqual(rackIndex, undefined);
  const placedCardId = authoritative.pendingDraw?.id;
  const insertState = client1.waitForMessage("state") as Promise<StateEnvelope>;
  client1.send("insert", { rackIndex });
  const afterInsert = ownView(await insertState, "user-1");
  assert.equal(afterInsert.currentPlayerId, "user-2");
  assert.equal(afterInsert.phase, "draw");
  assert.equal(
    afterInsert.players
      .find((player) => player.id === "user-1")
      ?.rack.find((card) => card.id === placedCardId)?.revealed,
    false,
  );

  const secondDrawState = waitForStateWhere(
    client2,
    (envelope) =>
      envelope.game?.currentPlayerId === "user-2" &&
      envelope.game.phase === "guess" &&
      envelope.game.pendingDraw !== null,
  );
  client2.send("draw");
  assert.equal(ownView(await secondDrawState, "user-2").phase, "guess");
  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  const wrongTarget = authoritative.players
    .find((player) => player.id === "user-1")
    ?.rack.find((card) => !card.revealed);
  assert.notEqual(wrongTarget, undefined);
  const deliberatelyWrongGuess: CardGuess =
    wrongTarget?.kind === "joker"
      ? { kind: "standard", rank: "A", color: "red" }
      : { kind: "joker" };
  const wrongState = waitForStateWhere(
    client2,
    (envelope) => envelope.game?.phase === "penalty-place",
  );
  client2.send("guess", {
    targetPlayerId: "user-1",
    targetCardId: wrongTarget?.id,
    guess: deliberatelyWrongGuess,
  });
  const afterWrong = ownView(await wrongState, "user-2");
  assert.equal(afterWrong.currentPlayerId, "user-2");
  assert.equal(afterWrong.phase, "penalty-place");
  assert.equal(afterWrong.pendingDraw?.revealed, true);

  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  const penaltyPlayer = authoritative.players[authoritative.currentPlayerIndex];
  const penaltyIndex = validInsertionIndexes(
    penaltyPlayer?.rack ?? [],
    authoritative.pendingDraw!,
  )[0];
  assert.notEqual(penaltyIndex, undefined);
  const penaltyCardId = authoritative.pendingDraw?.id;
  const penaltyInsertState = waitForStateWhere(
    client2,
    (envelope) => envelope.game?.currentPlayerId === "user-3",
  );
  client2.send("insert", { rackIndex: penaltyIndex });
  const afterPenaltyInsert = ownView(await penaltyInsertState, "user-2");
  assert.equal(afterPenaltyInsert.currentPlayerId, "user-3");
  assert.equal(
    afterPenaltyInsert.players
      .find((player) => player.id === "user-2")
      ?.rack.find((card) => card.id === penaltyCardId)?.revealed,
    true,
  );

  const forfeitedState = client1.waitForMessage("state") as Promise<StateEnvelope>;
  serverRoom.forfeitDisconnectedPlayer("user-2");
  const afterForfeit = ownView(await forfeitedState, "user-1");
  assert.equal(
    afterForfeit.players.find((player) => player.id === "user-2")?.eliminated,
    true,
  );
  assert.equal(afterForfeit.currentPlayerId, "user-3");

  await Promise.all([
    client1.leave(true),
    client2.leave(true),
    client3.leave(true),
  ]);
});

test("code rooms use six-digit codes and stay out of Quick Match", async () => {
  testServer.sdk.auth.token = "user-code-owner";
  const codeRoom = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  codeRoom.onMessage("state", () => undefined);
  const codeEnvelope = await requestState(codeRoom);
  assert.equal(codeEnvelope.lobbyMode, "code");
  assert.match(codeEnvelope.roomCode ?? "", /^\d{6}$/);

  const lookup = await testServer.http.get(`/rooms/by-code/${codeEnvelope.roomCode}`);
  assert.equal((lookup.data as { roomId: string }).roomId, codeRoom.roomId);

  testServer.sdk.auth.token = "user-quick-match";
  const publicRoom = await testServer.sdk.joinOrCreate("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
  publicRoom.onMessage("state", () => undefined);
  assert.notEqual(publicRoom.roomId, codeRoom.roomId);
  const publicEnvelope = await requestState(publicRoom);
  assert.equal(publicEnvelope.lobbyMode, "public");
  assert.equal(publicEnvelope.roomCode, null);

  testServer.sdk.auth.token = "user-code-guest";
  const codeGuest = await testServer.sdk.joinById(codeRoom.roomId);
  codeGuest.onMessage("state", () => undefined);
  assert.equal(codeGuest.roomId, codeRoom.roomId);

  await Promise.all([
    codeRoom.leave(true),
    codeGuest.leave(true),
    publicRoom.leave(true),
  ]);
});

test("a player who drops before a match starts releases the waiting-room seat", async () => {
  testServer.sdk.auth.token = "user-waiting-owner";
  const owner = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  owner.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-waiting-guest";
  const guest = await testServer.sdk.joinById(owner.roomId);
  guest.onMessage("state", () => undefined);
  assert.equal((await requestState(owner)).connectedPlayers, 2);

  guest.reconnection.enabled = false;
  const releasedState = waitForStateWhere(
    owner,
    (envelope) => envelope.status === "waiting" && envelope.connectedPlayers === 1,
  );
  void guest.leave(false);
  await releasedState;

  testServer.sdk.auth.token = "user-waiting-replacement";
  const replacement = await testServer.sdk.joinById(owner.roomId);
  replacement.onMessage("state", () => undefined);
  assert.equal((await requestState(owner)).connectedPlayers, 2);

  await Promise.all([owner.leave(true), replacement.leave(true)]);
});

test("a dropped player reconnects without losing a pending drawn card", async () => {
  testServer.sdk.auth.token = "user-reconnect-1";
  const client1 = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  client1.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-reconnect-2";
  const client2 = await testServer.sdk.joinById(client1.roomId);
  client2.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-reconnect-3";
  const client3 = await testServer.sdk.joinById(client1.roomId);
  client3.onMessage("state", () => undefined);

  const drawnState = waitForStateWhere(
    client1,
    (envelope) => envelope.game?.pendingDraw !== null,
  );
  client1.send("draw");
  const pendingCardId = ownView(await drawnState, "user-reconnect-1").pendingDraw?.id;
  assert.notEqual(pendingCardId, undefined);

  client1.reconnection.minUptime = 0;
  const dropped = waitForSignal(
    client1.onDrop,
    "the client connection to drop",
  );
  const reconnected = waitForSignal(
    client1.onReconnect,
    "the client to reconnect",
  );
  const pausedState = waitForStateWhere(
    client2,
    (envelope) =>
      envelope.status === "paused" &&
      envelope.droppedPlayerIds.includes("user-reconnect-1"),
  );
  const resumedState = waitForStateWhere(
    client2,
    (envelope) =>
      envelope.status === "playing" && envelope.droppedPlayerIds.length === 0,
  );

  void client1.leave(false);
  await dropped;
  await pausedState;

  const serverRoom = testServer.getRoomById<CipherDeckRoom>(client1.roomId);
  let authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw?.id, pendingCardId);

  await reconnected;
  await resumedState;
  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw?.id, pendingCardId);
  assert.equal(authoritative.phase, "guess");

  const reconnectedState = await requestState(client1);
  assert.equal(reconnectedState.status, "playing");
  assert.equal(ownView(reconnectedState, "user-reconnect-1").pendingDraw?.id, pendingCardId);

  await Promise.all([
    client1.leave(true),
    client2.leave(true),
    client3.leave(true),
  ]);
});

test("reconnection timeout reveals and preserves a pending drawn card", async () => {
  testServer.sdk.auth.token = "user-timeout-1";
  const client1 = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  client1.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-timeout-2";
  const client2 = await testServer.sdk.joinById(client1.roomId);
  client2.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-timeout-3";
  const client3 = await testServer.sdk.joinById(client1.roomId);
  client3.onMessage("state", () => undefined);

  const drawnState = waitForStateWhere(
    client1,
    (envelope) => envelope.game?.pendingDraw !== null,
  );
  client1.send("draw");
  const pendingCardId = ownView(await drawnState, "user-timeout-1").pendingDraw?.id;
  assert.notEqual(pendingCardId, undefined);

  client1.reconnection.enabled = false;
  const pausedState = waitForStateWhere(
    client2,
    (envelope) =>
      envelope.status === "paused" && envelope.droppedPlayerIds.includes("user-timeout-1"),
  );
  const forfeitedState = waitForStateWhere(
    client2,
    (envelope) =>
      envelope.game?.players.find((player) => player.id === "user-timeout-1")
        ?.eliminated === true,
    3_000,
  );

  void client1.leave(false);
  await pausedState;

  const serverRoom = testServer.getRoomById<CipherDeckRoom>(client1.roomId);
  let authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw?.id, pendingCardId);

  await forfeitedState;
  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw, null);
  const forfeitedPlayer = authoritative.players.find(
    (player) => player.id === "user-timeout-1",
  );
  assert.equal(forfeitedPlayer?.eliminated, true);
  assert.equal(forfeitedPlayer?.rack.every((card) => card.revealed), true);
  assert.equal(
    forfeitedPlayer?.rack.some((card) => card.id === pendingCardId && card.revealed),
    true,
  );
  assert.equal(authoritative.currentPlayerIndex, 1);

  await Promise.all([client2.leave(true), client3.leave(true)]);
});

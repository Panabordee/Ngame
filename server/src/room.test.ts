import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Room as ColyseusClientRoom } from "@colyseus/sdk";
import {
  deserializeGameState,
  type CardGuess,
  type ClientGameView,
  type RoomSettingsAppliedMessage,
  type StateEnvelope,
  validInsertionIndexes,
} from "@ngame/shared";

import { createGameServer } from "./app.config.ts";
import { CipherDeckRoom } from "./CipherDeckRoom.ts";
import { loadServerConfig } from "./config.ts";
import type { ServerConfig } from "./config.ts";
import { InMemoryGuestSessionRegistry } from "./guestSessions.ts";
import { InMemoryUserRoomRegistry } from "./userRoomRegistry.ts";

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
  CipherDeckRoom.startingRevealMilliseconds = 5;
  testServer = await boot(
    createGameServer(TEST_CONFIG, async (token) => {
      if (token.startsWith("guest-")) {
        return {
          userId: token,
          displayName: `Guest ${token.slice(6)}`,
          accountType: "guest",
          guestSessionId: `session-${token}`,
          expiresAtMs: Date.now() + 60_000,
        };
      }
      if (!token.startsWith("user-")) {
        throw new Error("Invalid test credential.");
      }
      return {
        userId: token,
        displayName: `Player ${token.slice(5)}`,
        accountType: "registered",
      };
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

async function readyAndStart(
  host: ColyseusClientRoom,
  clients: readonly ColyseusClientRoom[],
): Promise<StateEnvelope> {
  const allReady = waitForStateWhere(
    host,
    (state) =>
      state.players.length === clients.length &&
      state.players.every((player) => player.ready),
  );
  for (const client of clients.slice(1)) client.send("ready", true);
  await allReady;
  const started = waitForStateWhere(
    host,
    (state) => state.status === "starting" && state.startingSelection?.phase === "choosing",
  );
  host.send("start-game");
  return completeStartingSelection(host, clients, await started);
}

async function completeStartingSelection(
  observer: ColyseusClientRoom,
  clients: readonly ColyseusClientRoom[],
  initialState: StateEnvelope,
): Promise<StateEnvelope> {
  let state = initialState;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (state.status === "playing") return state;
    const selection = state.startingSelection;
    assert.notEqual(selection, null);
    if (selection?.phase === "choosing") {
      const round = selection.round;
      const revealed = waitForStateWhere(
        observer,
        (candidate) =>
          candidate.startingSelection?.phase === "revealed" &&
          candidate.startingSelection.round === round,
      );
      const availableOptions = selection.options.filter(
        (option) => option.selectedByPlayerId === null,
      );
      for (const playerId of selection.eligiblePlayerIds) {
        if (selection.options.some((option) => option.selectedByPlayerId === playerId)) {
          continue;
        }
        const clientIndex = state.players.findIndex((player) => player.id === playerId);
        if (state.players[clientIndex]?.isBot === true) continue;
        const option = availableOptions.shift();
        assert.notEqual(clientIndex, -1);
        assert.notEqual(option, undefined);
        clients[clientIndex]?.send("select-starting-card", { cardId: option?.id });
      }
      state = await revealed;
      continue;
    }
    if (selection?.phase === "revealed") {
      const round = selection.round;
      state = await waitForStateWhere(
        observer,
        (candidate) =>
          candidate.status === "playing" ||
          candidate.startingSelection?.phase === "joker-placement" ||
          (candidate.startingSelection?.phase === "choosing" &&
            candidate.startingSelection.round > round),
        5_000,
      );
      continue;
    }
    if (selection?.phase === "joker-placement") {
      for (const client of clients) {
        let playerState = await requestState(client);
        while ((playerState.game?.pendingStartingJokerCardIds.length ?? 0) > 0) {
          const pendingCount = playerState.game?.pendingStartingJokerCardIds.length ?? 0;
          const placed = waitForStateWhere(
            client,
            (candidate) =>
              (candidate.game?.pendingStartingJokerCardIds.length ?? 0) < pendingCount,
          );
          client.send("place-starting-joker", { rackIndex: 0 });
          playerState = await placed;
          state = playerState;
        }
      }
      if (state.status !== "playing") {
        state = await waitForStateWhere(
          observer,
          (candidate) => candidate.status === "playing",
          5_000,
        );
      }
    }
  }
  throw new Error("Starting-player selection did not finish.");
}

test("two human players can fill the final seat with a server bot", async () => {
  testServer.sdk.auth.token = "user-bot-host";
  const host = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
  host.onMessage("state", () => undefined);

  testServer.sdk.auth.token = "user-bot-friend";
  const friend = await testServer.sdk.joinById(host.roomId);
  friend.onMessage("state", () => undefined);

  const playing = await readyAndStart(host, [host, friend]);
  assert.equal(playing.players.filter((player) => player.isBot).length, 1);
  assert.equal(playing.players.filter((player) => !player.isBot).length, 2);
  assert.equal(playing.game?.players.length, 3);
  assert.equal(playing.status, "playing");

  await friend.leave(true);
  await host.leave(true);
});

test("an active host who leaves transfers ownership to a connected human", async () => {
  testServer.sdk.auth.token = "user-active-host";
  const host = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "public" });
  host.onMessage("state", () => undefined);
  testServer.sdk.auth.token = "user-next-host";
  const friend = await testServer.sdk.joinById(host.roomId);
  friend.onMessage("state", () => undefined);
  await readyAndStart(host, [host, friend]);
  const transferred = waitForStateWhere(friend, (state) => state.hostPlayerId === "user-next-host" && state.players.find((player) => player.id === "user-next-host")?.isHost === true);
  await host.leave(true);
  await transferred;
  await friend.leave(true);
});

test("a host can start solo without readying and fill the room with bots", async () => {
  testServer.sdk.auth.token = "user-solo-host";
  const host = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
  host.onMessage("state", () => undefined);

  const starting = waitForStateWhere(
    host,
    (state) => state.status === "starting" && state.startingSelection?.phase === "choosing",
  );
  host.send("start-game");
  const playing = await completeStartingSelection(host, [host], await starting);
  assert.equal(playing.players.filter((player) => player.isBot).length, 2);
  assert.equal(playing.players.find((player) => player.id === "user-solo-host")?.ready, true);
  assert.equal(playing.game?.players.length, 3);

  await host.leave(true);
});

test("a spectator can watch a started code room without receiving hidden card values", async () => {
  testServer.sdk.auth.token = "user-spectator-host";
  const host = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" });
  host.onMessage("state", () => undefined);
  const starting = waitForStateWhere(host, (state) => state.status === "starting" && state.startingSelection?.phase === "choosing");
  host.send("start-game");
  await completeStartingSelection(host, [host], await starting);

  testServer.sdk.auth.token = "user-spectator-viewer";
  const spectator = await testServer.sdk.joinById(host.roomId, { spectator: true });
  const state = await requestState(spectator);
  assert.equal(state.isSpectator, true);
  assert.equal(state.players.some((player) => player.id === "user-spectator-viewer"), false);
  assert.equal(state.game?.players.flatMap((player) => player.rack).every((card) => card.revealed || card.kind === "hidden"), true);
  assert.equal(state.game?.pendingStartingJokerCardIds.length, 0);

  await spectator.leave(true);
  await host.leave(true);
});

test("starting-card selection assigns a remaining option when a player times out", async () => {
  CipherDeckRoom.turnTimerMillisecondsOverride = 40;
  try {
    testServer.sdk.auth.token = "user-start-choice-timeout";
    const host = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "public" });
    host.onMessage("state", () => undefined);
    const choosing = waitForStateWhere(host, (state) => state.startingSelection?.phase === "choosing");
    host.send("start-game");
    await choosing;
    const revealed = await waitForStateWhere(host, (state) => state.startingSelection?.phase === "revealed", 2_000);
    assert.equal(revealed.startingSelection?.options.filter((option) => option.selectedByPlayerId !== null).length, 3);
    await host.leave(true);
  } finally {
    CipherDeckRoom.turnTimerMillisecondsOverride = null;
  }
});

test("authoritative game transitions persist a Redis-compatible recovery checkpoint", async () => {
  let storedKey = "";
  let storedValue = "";
  CipherDeckRoom.recoveryStore = { setex: async (key, value) => { storedKey = key; storedValue = value; return "OK"; } };
  try {
    testServer.sdk.auth.token = "user-recovery-checkpoint";
    const host = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "public" });
    host.onMessage("state", () => undefined);
    const starting = waitForStateWhere(host, (state) => state.startingSelection?.phase === "choosing");
    host.send("start-game");
    const playing = await completeStartingSelection(host, [host], await starting);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storedKey, `ngame:room-recovery:${host.roomId}`);
    const checkpoint = JSON.parse(storedValue) as { version: number; game: string; playerIds: string[] };
    assert.equal(checkpoint.version, 1);
    assert.deepEqual(checkpoint.playerIds, playing.game?.players.map((player) => player.id));
    assert.equal(deserializeGameState(checkpoint.game).players.length, 3);
    await host.leave(true);
  } finally {
    CipherDeckRoom.recoveryStore = null;
  }
});

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

test("distributed limiter rejects a message before it reaches the room handler", async () => {
  CipherDeckRoom.distributedRateLimiter = { hincrbyex: async () => TEST_CONFIG.maxMessagesPerSecond + 1 };
  try {
    testServer.sdk.auth.token = "user-distributed-limit";
    const client = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "public" });
    const limited = client.waitForMessage("error") as Promise<{ code: string }>;
    client.send("draw");
    assert.equal((await limited).code, "RATE_LIMITED");
    const serverRoom = testServer.getRoomById(client.roomId) as CipherDeckRoom;
    assert.equal(serverRoom.getSnapshot(), null);
    await client.leave(true);
  } finally {
    CipherDeckRoom.distributedRateLimiter = null;
  }
});

test("deduction memory keeps public misses after the short guess feed rolls over", async () => {
  testServer.sdk.auth.token = "user-deduction-memory";
  const client = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "public" });
  client.onMessage("state", () => undefined);
  const serverRoom = testServer.getRoomById(client.roomId) as CipherDeckRoom;
  const recordGuess = (serverRoom as unknown as { recordGuess(actor: string, target: string, card: string, guess: CardGuess, correct: boolean): void }).recordGuess.bind(serverRoom);
  const misses: CardGuess[] = [
    { kind: "joker" },
    ...(["A", "2", "3", "4", "5", "6"] as const).flatMap((rank) => [
      { kind: "standard" as const, rank, color: "red" as const },
      { kind: "standard" as const, rank, color: "black" as const },
    ]),
  ];
  const updated = waitForStateWhere(client, (state) => state.guessHistory.length === 12 && state.deductionMisses.length === 1);
  misses.forEach((guess) => recordGuess("actor", "target", "hidden-card", guess, false));
  (serverRoom as unknown as { broadcastState(): void }).broadcastState();
  const state = await updated;
  assert.equal(state.guessHistory.length, 12);
  assert.equal(state.deductionMisses.find((entry) => entry.targetCardId === "hidden-card")?.guesses.length, 13);
  await client.leave(true);
});

test("guest-session registry reserves one room and remains consumed after commit", () => {
  const registry = new InMemoryGuestSessionRegistry();
  const expiresAtMs = Date.now() + 60_000;
  assert.equal(registry.reserve("guest-session", "room-a", expiresAtMs), "created");
  assert.equal(registry.reserve("guest-session", "room-a", expiresAtMs), "same-room");
  assert.equal(registry.reserve("guest-session", "room-b", expiresAtMs), "conflict");
  assert.equal(registry.releaseReservation("guest-session", "room-a"), true);
  assert.equal(registry.reserve("guest-session", "room-b", expiresAtMs), "created");
  assert.equal(registry.commit("guest-session", "room-b"), true);
  assert.equal(registry.releaseReservation("guest-session", "room-b"), false);
  assert.equal(registry.reserve("guest-session", "room-c", expiresAtMs), "conflict");
});

test("user-room registry atomically allows only one active player room", async () => {
  const registry = new InMemoryUserRoomRegistry();
  const results = await Promise.all([registry.reserve("same-user", "room-a"), registry.reserve("same-user", "room-b")]);
  assert.deepEqual(new Set(results), new Set(["created", "conflict"]));
  assert.equal(await registry.release("same-user", "room-b"), false);
  assert.equal(await registry.release("same-user", "room-a"), true);
  assert.equal(await registry.reserve("same-user", "room-b"), "created");
});

test("one registered account cannot occupy player seats in two rooms", async () => {
  testServer.sdk.auth.token = "user-one-room-only";
  const first = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" });
  first.onMessage("state", () => undefined);
  await assert.rejects(
    testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" }),
    /already playing in another room/,
  );
  await first.leave(true);
  const second = await testServer.sdk.create("cipher_deck", { desiredPlayers: 3, lobbyMode: "code" });
  second.onMessage("state", () => undefined);
  await second.leave(true);
});

test("guest can leave a waiting lobby but cannot switch rooms after match start", async () => {
  testServer.sdk.auth.token = "guest-waiting";
  const waiting = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  waiting.onMessage("state", () => undefined);
  await assert.rejects(
    testServer.sdk.create("cipher_deck", {
      desiredPlayers: 3,
      lobbyMode: "code",
    }),
    /already assigned to another match/,
  );
  await waiting.leave(true);

  const released = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  released.onMessage("state", () => undefined);
  await released.leave(true);

  testServer.sdk.auth.token = "guest-committed";
  const guest = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  guest.onMessage("state", () => undefined);
  testServer.sdk.auth.token = "user-guest-test-2";
  const player2 = await testServer.sdk.joinById(guest.roomId);
  player2.onMessage("state", () => undefined);
  testServer.sdk.auth.token = "user-guest-test-3";
  const player3 = await testServer.sdk.joinById(guest.roomId);
  player3.onMessage("state", () => undefined);

  const invalidNameError = guest.waitForMessage("error") as Promise<{
    code: string;
  }>;
  guest.send("update-guest-name", { displayName: "   " });
  assert.equal((await invalidNameError).code, "INVALID_GUEST_NAME");

  const renamed = waitForStateWhere(
    player2,
    (roomState) =>
      roomState.players.find((player) => player.id === "guest-committed")?.displayName ===
      "Cipher Guest",
  );
  const renameAck = guest.waitForMessage("guest-name-updated") as Promise<{
    displayName: string;
  }>;
  guest.send("update-guest-name", { displayName: "  Cipher   Guest  " });
  assert.equal((await renameAck).displayName, "Cipher Guest");
  const renamedState = await renamed;
  assert.equal(
    renamedState.players.find((player) => player.id === "guest-committed")?.accountType,
    "guest",
  );

  const registeredRenameError = player2.waitForMessage("error") as Promise<{
    code: string;
  }>;
  player2.send("update-guest-name", { displayName: "Not Allowed" });
  assert.equal((await registeredRenameError).code, "GUEST_ONLY");

  const duplicateNameError = guest.waitForMessage("error") as Promise<{
    code: string;
  }>;
  guest.send("update-guest-name", { displayName: "PLAYER GUEST-TEST-2" });
  assert.equal((await duplicateNameError).code, "NAME_TAKEN");

  const starting = waitForStateWhere(
    guest,
    (roomState) => roomState.status === "starting",
  );
  guest.send("ready", true);
  player2.send("ready", true);
  player3.send("ready", true);
  await waitForStateWhere(
    guest,
    (roomState) => roomState.players.every((player) => player.ready),
  );
  guest.send("start-game");
  await starting;

  const lockedNameError = guest.waitForMessage("error") as Promise<{
    code: string;
  }>;
  guest.send("update-guest-name", { displayName: "Too Late" });
  assert.equal((await lockedNameError).code, "MATCH_ALREADY_STARTED");
  await guest.leave(true);

  testServer.sdk.auth.token = "guest-committed";
  await assert.rejects(
    testServer.sdk.create("cipher_deck", {
      desiredPlayers: 3,
      lobbyMode: "code",
    }),
    /already assigned to another match/,
  );
  await player2.leave(true);
  await player3.leave(true);
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
  const waiting = await requestState(client1);
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.hostPlayerId, "user-1");
  assert.equal(waiting.players.find((player) => player.id === "user-1")?.isHost, true);

  const hostOnlyError = client2.waitForMessage("error") as Promise<{
    code: string;
  }>;
  client2.send("start-game");
  assert.equal((await hostOnlyError).code, "HOST_ONLY");
  const clients = [client1, client2, client3];
  const started = await readyAndStart(client1, clients);
  const envelopes = await Promise.all(clients.map((client) => requestState(client)));
  const envelope1 = envelopes[0]!;

  assert.equal(started.status, "playing");
  assert.notEqual(started.turnDeadlineMs, null);
  assert.equal(envelope1.connectedPlayers, 3);
  assert.equal(
    envelope1.players.find((player) => player.id === "user-2")?.displayName,
    "Player 2",
  );
  for (const [viewerIndex, envelope] of envelopes.entries()) {
    const viewerId = envelope.players[viewerIndex]!.id;
    const view = ownView(envelope, viewerId);
    for (const player of view.players) {
      for (const card of player.rack) {
        if (player.id === viewerId || card.revealed) {
          assert.notEqual(card.kind, "hidden");
        } else {
          assert.equal(card.kind, "hidden");
        }
      }
    }
  }

  const activePlayerId = started.game!.currentPlayerId;
  const activeClientIndex = started.players.findIndex((player) => player.id === activePlayerId);
  const activeClient = clients[activeClientIndex]!;
  const inactiveClient = clients[(activeClientIndex + 1) % clients.length]!;
  const invalidTurn = inactiveClient.waitForMessage("error") as Promise<{
    code: string;
    message: string;
  }>;
  inactiveClient.send("draw");
  assert.equal((await invalidTurn).code, "INVALID_TURN");

  const drawState = waitForStateWhere(
    activeClient,
    (envelope) => envelope.game?.pendingDraw !== null,
  );
  activeClient.send("draw");
  const afterDrawEnvelope = await drawState;
  const afterDraw = ownView(afterDrawEnvelope, activePlayerId);
  assert.equal(afterDraw.phase, "guess");
  assert.notEqual(afterDraw.pendingDraw, null);
  assert.notEqual(afterDraw.pendingDraw?.kind, "hidden");
  assert.ok((afterDrawEnvelope.turnDeadlineMs ?? 0) > (started.turnDeadlineMs ?? 0));

  const serverRoom = testServer.getRoomById<CipherDeckRoom>(client1.roomId);
  let authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  const targetPlayer = authoritative.players.find(
    (player) => player.id !== activePlayerId && !player.eliminated,
  );
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
  const correctState = activeClient.waitForMessage("state") as Promise<StateEnvelope>;
  activeClient.send("guess", {
    targetPlayerId: targetPlayer?.id,
    targetCardId: correctTarget?.id,
    guess: correctGuess,
  });
  const afterCorrectEnvelope = await correctState;
  const afterCorrect = ownView(afterCorrectEnvelope, activePlayerId);
  assert.deepEqual(afterCorrectEnvelope.guessHistory.at(-1), {
    id: 1,
    actorPlayerId: activePlayerId,
    targetPlayerId: targetPlayer?.id,
    targetCardId: correctTarget?.id,
    guess: correctGuess,
    correct: true,
  });
  assert.equal(afterCorrect.currentPlayerId, activePlayerId);
  assert.equal(afterCorrect.phase, "guess");
  assert.equal(afterCorrect.correctGuessesThisTurn, 1);
  assert.equal(
    afterCorrect.players
      .find((player) => player.id === targetPlayer?.id)
      ?.rack.find((card) => card.id === correctTarget?.id)?.revealed,
    true,
  );

  const stopState = activeClient.waitForMessage("state") as Promise<StateEnvelope>;
  activeClient.send("stop");
  assert.equal(ownView(await stopState, activePlayerId).phase, "place");

  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  const activePlayer = authoritative.players[authoritative.currentPlayerIndex];
  assert.notEqual(activePlayer, undefined);
  assert.notEqual(authoritative.pendingDraw, null);
  const rackIndex = validInsertionIndexes(activePlayer?.rack ?? [], authoritative.pendingDraw!)[0];
  assert.notEqual(rackIndex, undefined);
  const placedCardId = authoritative.pendingDraw?.id;
  const insertState = activeClient.waitForMessage("state") as Promise<StateEnvelope>;
  activeClient.send("insert", { rackIndex });
  const afterInsert = ownView(await insertState, activePlayerId);
  assert.notEqual(afterInsert.currentPlayerId, activePlayerId);
  assert.equal(afterInsert.phase, "draw");
  assert.equal(
    afterInsert.players
      .find((player) => player.id === activePlayerId)
      ?.rack.find((card) => card.id === placedCardId)?.revealed,
    false,
  );

  await Promise.all([
    client1.leave(true),
    client2.leave(true),
    client3.leave(true),
  ]);
});

test("the realtime action timer eliminates an active player who does not draw", async () => {
  CipherDeckRoom.turnTimerMillisecondsOverride = 600;
  const clients: ColyseusClientRoom[] = [];
  try {
    for (let player = 1; player <= 3; player += 1) {
      testServer.sdk.auth.token = `user-idle-${player}`;
      const client = player === 1
        ? await testServer.sdk.create("cipher_deck", {
          desiredPlayers: 3,
          lobbyMode: "code",
        })
        : await testServer.sdk.joinById(clients[0]!.roomId);
      client.onMessage("state", () => undefined);
      clients.push(client);
    }

    const started = await readyAndStart(clients[0]!, clients);
    const idlePlayerId = started.game!.currentPlayerId;
    const observer = clients.find(
      (_, index) => started.players[index]?.id !== idlePlayerId,
    )!;
    const eliminated = await waitForStateWhere(
      observer,
      (state) =>
        state.game?.players.find((player) => player.id === idlePlayerId)?.eliminated === true,
      2_000,
    );

    assert.equal(
      eliminated.game?.players
        .find((player) => player.id === idlePlayerId)
        ?.rack.every((card) => card.revealed),
      true,
    );
    assert.notEqual(eliminated.game?.currentPlayerId, idlePlayerId);
    assert.notEqual(eliminated.turnDeadlineMs, null);
  } finally {
    CipherDeckRoom.turnTimerMillisecondsOverride = null;
    await Promise.all(clients.map((client) => client.leave(true)));
  }
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

test("a code-room host can run a private custom 40-card match", async () => {
  const clients: ColyseusClientRoom[] = [];
  testServer.sdk.auth.token = "user-custom-1";
  const host = await testServer.sdk.create("cipher_deck", {
    desiredPlayers: 5,
    lobbyMode: "code",
  });
  host.onMessage("state", () => undefined);
  clients.push(host);
  for (let player = 2; player <= 5; player += 1) {
    testServer.sdk.auth.token = `user-custom-${player}`;
    const guest = await testServer.sdk.joinById(host.roomId);
    guest.onMessage("state", () => undefined);
    clients.push(guest);
  }

  const settingsState = waitForStateWhere(
    host,
    (state) => state.settings.preset === "custom" && state.settings.totalCards === 40,
  );
  const settingsApplied = host.waitForMessage(
    "settings-applied",
  ) as Promise<RoomSettingsAppliedMessage>;
  host.send("update-settings", {
    preset: "custom",
    turnSeconds: 30,
    totalCards: 40,
    drawRounds: 2,
    jokerCount: 2,
    botDifficulty: "hard",
  });
  const expectedSettings = {
    preset: "custom",
    turnSeconds: 30,
    totalCards: 40,
    drawRounds: 2,
    jokerCount: 2,
    botDifficulty: "hard",
  } as const;
  assert.deepEqual((await settingsState).settings, expectedSettings);
  assert.deepEqual((await settingsApplied).settings, expectedSettings);

  const allReady = waitForStateWhere(host, (state) => state.players.every((player) => player.ready));
  for (const client of clients) client.send("ready", true);
  await allReady;
  const choosing = waitForStateWhere(
    host,
    (state) => state.startingSelection?.phase === "choosing",
  );
  host.send("start-game");
  let setupState = await choosing;
  assert.equal(setupState.startingSelection?.options.length, 6);
  assert.equal(setupState.startingSelection?.options.every((option) => option.card === null), true);

  const firstOptionId = setupState.startingSelection!.options[0]!.id;
  const selectedHidden = waitForStateWhere(
    clients[1]!,
    (state) =>
      state.startingSelection?.options.find((option) => option.id === firstOptionId)
        ?.selectedByPlayerId === "user-custom-1",
  );
  host.send("select-starting-card", { cardId: firstOptionId });
  setupState = await selectedHidden;
  assert.equal(
    setupState.startingSelection?.options.find((option) => option.id === firstOptionId)?.card,
    null,
  );

  const playing = await completeStartingSelection(host, clients, setupState);
  assert.equal(playing.status, "playing");
  assert.notEqual(playing.turnDeadlineMs, null);
  const serverRoom = testServer.getRoomById<CipherDeckRoom>(host.roomId);
  const game = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(
    game.players.reduce((total, player) => total + player.rack.length, 0) + game.drawPile.length,
    40,
  );
  assert.deepEqual(game.players.map((player) => player.rack.length).toSorted(), [5, 6, 6, 6, 7]);
  assert.equal(
    game.players.find((player) => player.id === game.players[game.currentPlayerIndex]?.id)?.rack.length,
    7,
  );
  assert.equal(
    game.players.every((player) => {
      const startingCardId = game.startingCardIds[player.id];
      return player.rack.some((card) => card.id === startingCardId && card.revealed);
    }),
    true,
  );
  assert.ok(game.drawPile.length >= 10);

  await Promise.all(clients.map((client) => client.leave(true)));
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
  const clients = [client1, client2, client3];
  const started = await readyAndStart(client1, clients);
  const activePlayerId = started.game!.currentPlayerId;
  const activeIndex = started.players.findIndex((player) => player.id === activePlayerId);
  const activeClient = clients[activeIndex]!;
  const observer = clients[(activeIndex + 1) % clients.length]!;

  const drawnState = waitForStateWhere(
    activeClient,
    (envelope) => envelope.game?.pendingDraw !== null,
  );
  activeClient.send("draw");
  const pendingCardId = ownView(await drawnState, activePlayerId).pendingDraw?.id;
  assert.notEqual(pendingCardId, undefined);

  activeClient.reconnection.minUptime = 0;
  const dropped = waitForSignal(
    activeClient.onDrop,
    "the client connection to drop",
  );
  const reconnected = waitForSignal(
    activeClient.onReconnect,
    "the client to reconnect",
  );
  const pausedState = waitForStateWhere(
    observer,
    (envelope) =>
      envelope.status === "paused" &&
      envelope.droppedPlayerIds.includes(activePlayerId),
  );
  const resumedState = waitForStateWhere(
    observer,
    (envelope) =>
      envelope.status === "playing" && envelope.droppedPlayerIds.length === 0,
  );

  void activeClient.leave(false);
  await dropped;
  await pausedState;

  const serverRoom = testServer.getRoomById<CipherDeckRoom>(activeClient.roomId);
  let authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw?.id, pendingCardId);

  await reconnected;
  await resumedState;
  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw?.id, pendingCardId);
  assert.equal(authoritative.phase, "guess");

  const reconnectedState = await requestState(activeClient);
  assert.equal(reconnectedState.status, "playing");
  assert.equal(ownView(reconnectedState, activePlayerId).pendingDraw?.id, pendingCardId);

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
  const clients = [client1, client2, client3];
  const started = await readyAndStart(client1, clients);
  const activePlayerId = started.game!.currentPlayerId;
  const activeIndex = started.players.findIndex((player) => player.id === activePlayerId);
  const activeClient = clients[activeIndex]!;
  const observer = clients[(activeIndex + 1) % clients.length]!;

  const drawnState = waitForStateWhere(
    activeClient,
    (envelope) => envelope.game?.pendingDraw !== null,
  );
  activeClient.send("draw");
  const pendingCardId = ownView(await drawnState, activePlayerId).pendingDraw?.id;
  assert.notEqual(pendingCardId, undefined);

  activeClient.reconnection.enabled = false;
  const pausedState = waitForStateWhere(
    observer,
    (envelope) =>
      envelope.status === "paused" && envelope.droppedPlayerIds.includes(activePlayerId),
  );
  const forfeitedState = waitForStateWhere(
    observer,
    (envelope) =>
      envelope.game?.players.find((player) => player.id === activePlayerId)
        ?.eliminated === true,
    3_000,
  );

  void activeClient.leave(false);
  await pausedState;

  const serverRoom = testServer.getRoomById<CipherDeckRoom>(activeClient.roomId);
  let authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw?.id, pendingCardId);

  await forfeitedState;
  authoritative = deserializeGameState(serverRoom.getSnapshot() as string);
  assert.equal(authoritative.pendingDraw, null);
  const forfeitedPlayer = authoritative.players.find(
    (player) => player.id === activePlayerId,
  );
  assert.equal(forfeitedPlayer?.eliminated, true);
  assert.equal(forfeitedPlayer?.rack.every((card) => card.revealed), true);
  assert.equal(
    forfeitedPlayer?.rack.some((card) => card.id === pendingCardId && card.revealed),
    true,
  );
  assert.notEqual(authoritative.players[authoritative.currentPlayerIndex]?.id, activePlayerId);

  await Promise.all(clients.filter((client) => client !== activeClient).map((client) => client.leave(true)));
});

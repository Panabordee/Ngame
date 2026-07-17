import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Client, type Room } from "@colyseus/sdk";
import { importPKCS8, SignJWT } from "jose";
import type { StateEnvelope } from "@ngame/shared";

const apiUrl = process.env.API_PUBLIC_URL ?? "http://localhost:8000";
const realtimeUrl = process.env.REALTIME_PUBLIC_URL ?? "http://localhost:2567";
const jwtIssuer = process.env.JWT_ISSUER ?? "http://localhost:8000";
const jwtAudience = process.env.JWT_AUDIENCE ?? "ngame";
const jwtPrivateKeyFile =
  process.env.JWT_PRIVATE_KEY_FILE ??
  fileURLToPath(new URL("../../secrets/jwt-private.pem", import.meta.url));

interface SmokeUser {
  readonly accessToken: string;
  readonly userId: string;
}

const privateKey = await importPKCS8(await readFile(jwtPrivateKeyFile, "utf8"), "RS256");

async function createSmokeUser(): Promise<SmokeUser> {
  const userId = randomUUID();
  const accessToken = await new SignJWT({ typ: "access", name: `Smoke ${userId.slice(0, 6)}` })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(userId)
    .setIssuer(jwtIssuer)
    .setAudience(jwtAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(privateKey);
  return { accessToken, userId };
}

function authenticatedClient(player: SmokeUser): Client {
  const client = new Client(realtimeUrl);
  client.auth.token = player.accessToken;
  return client;
}

async function joinPlayerById(
  player: SmokeUser,
  roomId: string,
): Promise<Room> {
  const room = await authenticatedClient(player).joinById(roomId);
  room.onMessage("state", () => undefined);
  return room;
}

async function requestState(room: Room): Promise<StateEnvelope> {
  return new Promise<StateEnvelope>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for room state."));
    }, 3_000);
    const unsubscribe = room.onMessage<StateEnvelope>("state", (state) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(state);
    });
    room.send("sync");
  });
}

function waitForStateWhere(
  room: Room,
  predicate: (state: StateEnvelope) => boolean,
  timeoutMilliseconds = 5_000,
): Promise<StateEnvelope> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the expected room state."));
    }, timeoutMilliseconds);
    const unsubscribe = room.onMessage<StateEnvelope>("state", (state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });
}

const healthResponses = await Promise.all([
  fetch(`${apiUrl}/healthz`),
  fetch(`${realtimeUrl}/healthz`),
]);
assert.equal(healthResponses.every((response) => response.ok), true);

const players = await Promise.all([1, 2, 3].map(createSmokeUser));
const rooms: Room[] = [];
try {
  const owner = players[0];
  if (owner === undefined) throw new Error("The smoke-test owner is missing.");
  const ownerRoom = await authenticatedClient(owner).create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  ownerRoom.onMessage("state", () => undefined);
  rooms.push(ownerRoom);

  const codeState = await requestState(ownerRoom);
  assert.equal(codeState.lobbyMode, "code");
  assert.match(codeState.roomCode ?? "", /^\d{6}$/);
  const codeLookupResponse = await fetch(
    `${realtimeUrl}/rooms/by-code/${codeState.roomCode}`,
  );
  assert.equal(codeLookupResponse.ok, true);
  const codeLookup = (await codeLookupResponse.json()) as { roomId: string };
  assert.equal(codeLookup.roomId, ownerRoom.roomId);

  for (const player of players.slice(1)) {
    rooms.push(await joinPlayerById(player, codeLookup.roomId));
  }
  assert.equal(new Set(rooms.map((room) => room.roomId)).size, 1);

  const allReady = waitForStateWhere(ownerRoom, (state) =>
    state.players.length === rooms.length && state.players.every((player) => player.ready),
  );
  for (const room of rooms) room.send("ready", true);
  await allReady;
  const choosing = waitForStateWhere(
    ownerRoom,
    (state) => state.startingSelection?.phase === "choosing",
  );
  ownerRoom.send("start-game");
  let setupState = await choosing;
  for (let attempt = 0; attempt < 30 && setupState.status !== "playing"; attempt += 1) {
    const selection = setupState.startingSelection;
    if (selection?.phase === "choosing") {
      const available = selection.options.filter((option) => option.selectedByPlayerId === null);
      const revealed = waitForStateWhere(
        ownerRoom,
        (state) => state.startingSelection?.phase === "revealed" && state.startingSelection.round === selection.round,
      );
      for (const playerId of selection.eligiblePlayerIds) {
        if (selection.options.some((option) => option.selectedByPlayerId === playerId)) continue;
        const roomIndex = players.findIndex((player) => player.userId === playerId);
        rooms[roomIndex]?.send("select-starting-card", { cardId: available.shift()?.id });
      }
      setupState = await revealed;
    } else if (selection?.phase === "revealed") {
      const round = selection.round;
      setupState = await waitForStateWhere(
        ownerRoom,
        (state) =>
          state.status === "playing" ||
          state.startingSelection?.phase === "joker-placement" ||
          (state.startingSelection?.phase === "choosing" && state.startingSelection.round > round),
      );
    } else if (selection?.phase === "joker-placement") {
      for (const room of rooms) {
        let playerState = await requestState(room);
        while ((playerState.game?.pendingStartingJokerCardIds.length ?? 0) > 0) {
          const pendingCount = playerState.game?.pendingStartingJokerCardIds.length ?? 0;
          const placed = waitForStateWhere(
            room,
            (state) =>
              (state.game?.pendingStartingJokerCardIds.length ?? 0) < pendingCount,
          );
          room.send("place-starting-joker", { rackIndex: 0 });
          playerState = await placed;
          setupState = playerState;
        }
      }
      if (setupState.status !== "playing") setupState = await requestState(ownerRoom);
    }
  }
  assert.equal(setupState.status, "playing");

  const views = await Promise.all(rooms.map(requestState));
  for (let viewerIndex = 0; viewerIndex < views.length; viewerIndex += 1) {
    const view = views[viewerIndex];
    const viewerId = players[viewerIndex]?.userId;
    assert.equal(view?.status, "playing");
    assert.equal(view?.connectedPlayers, 3);
    for (const player of view?.game?.players ?? []) {
      assert.equal(
        player.rack.every((card) =>
          player.id === viewerId || card.revealed
            ? card.kind !== "hidden"
            : card.kind === "hidden"),
        true,
      );
    }
  }

  const activePlayerId = views[0]?.game?.currentPlayerId;
  const activeRoom = rooms[players.findIndex((player) => player.userId === activePlayerId)];
  if (activeRoom === undefined) throw new Error("The first room was not created.");
  const drewState = new Promise<StateEnvelope>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for the draw transition."));
    }, 3_000);
    const unsubscribe = activeRoom.onMessage<StateEnvelope>("state", (state) => {
      if (state.game?.phase === "guess" && state.game.pendingDraw !== null) {
        clearTimeout(timeout);
        unsubscribe();
        resolve(state);
      }
    });
  });
  activeRoom.send("draw");
  assert.equal((await drewState).game?.phase, "guess");

  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      apiUrl,
      realtimeUrl,
      roomId: rooms[0]?.roomId,
      roomCode: codeState.roomCode,
      players: players.map((player) => player.userId),
      verified: ["signed-jwt", "room-code", "host-ready", "starting-selection", "privacy", "draw"],
    }, null, 2)}\n`,
  );
} finally {
  await Promise.all(rooms.map((room) => room.leave(true)));
}

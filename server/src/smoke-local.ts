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
  const accessToken = await new SignJWT({ typ: "access" })
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

  const views = await Promise.all(rooms.map(requestState));
  for (let viewerIndex = 0; viewerIndex < views.length; viewerIndex += 1) {
    const view = views[viewerIndex];
    const viewerId = players[viewerIndex]?.userId;
    assert.equal(view?.status, "playing");
    assert.equal(view?.connectedPlayers, 3);
    assert.equal(view?.game?.currentPlayerId, players[0]?.userId);
    for (const player of view?.game?.players ?? []) {
      assert.equal(
        player.rack.every((card) =>
          player.id === viewerId ? card.kind !== "hidden" : card.kind === "hidden",
        ),
        true,
      );
    }
  }

  const activeRoom = rooms[0];
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
      verified: ["signed-jwt", "isolated-room-join", "privacy", "draw", "room-code"],
    }, null, 2)}\n`,
  );
} finally {
  await Promise.all(rooms.map((room) => room.leave(true)));
}

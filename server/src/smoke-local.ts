import assert from "node:assert/strict";

import { Client, type Room } from "@colyseus/sdk";
import type { StateEnvelope } from "@ngame/shared";

const apiUrl = process.env.API_PUBLIC_URL ?? "http://localhost:8000";
const realtimeUrl = process.env.REALTIME_PUBLIC_URL ?? "http://localhost:2567";
const runId = `${Date.now()}-${process.pid}`;

interface RegisteredUser {
  readonly accessToken: string;
  readonly userId: string;
}

async function registerPlayer(index: number): Promise<RegisteredUser> {
  const response = await fetch(`${apiUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `smoke-${runId}-${index}@example.com`,
      password: "smoke-password-123",
      display_name: `Smoke Player ${index}`,
    }),
  });
  const responseBody = await response.text();
  assert.equal(response.status, 201, responseBody);
  const body = JSON.parse(responseBody) as {
    access_token: string;
    user: { id: string };
  };
  return { accessToken: body.access_token, userId: body.user.id };
}

async function joinPlayer(player: RegisteredUser): Promise<Room> {
  const client = new Client(realtimeUrl);
  client.auth.token = player.accessToken;
  const room = await client.joinOrCreate("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "public",
  });
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

const players = await Promise.all([1, 2, 3].map(registerPlayer));
const rooms: Room[] = [];
let codeRoom: Room | null = null;
try {
  for (const player of players) {
    rooms.push(await joinPlayer(player));
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

  const codeClient = new Client(realtimeUrl);
  codeClient.auth.token = players[0]?.accessToken ?? "";
  codeRoom = await codeClient.create("cipher_deck", {
    desiredPlayers: 3,
    lobbyMode: "code",
  });
  codeRoom.onMessage("state", () => undefined);
  const codeState = await requestState(codeRoom);
  assert.equal(codeState.lobbyMode, "code");
  assert.match(codeState.roomCode ?? "", /^\d{6}$/);
  const codeLookupResponse = await fetch(
    `${realtimeUrl}/rooms/by-code/${codeState.roomCode}`,
  );
  assert.equal(codeLookupResponse.ok, true);
  const codeLookup = (await codeLookupResponse.json()) as { roomId: string };
  assert.equal(codeLookup.roomId, codeRoom.roomId);

  process.stdout.write(
    `${JSON.stringify({
      status: "ok",
      apiUrl,
      realtimeUrl,
      roomId: rooms[0]?.roomId,
      roomCode: codeState.roomCode,
      players: players.map((player) => player.userId),
      verified: ["auth", "matchmaking", "privacy", "draw", "room-code"],
    }, null, 2)}\n`,
  );
} finally {
  await Promise.all([
    ...rooms.map((room) => room.leave(true)),
    ...(codeRoom === null ? [] : [codeRoom.leave(true)]),
  ]);
}

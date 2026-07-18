import { randomInt } from "node:crypto";

import { Redis } from "ioredis";

export interface RoomCodeRegistry {
  allocate(roomId: string): Promise<string>;
  release(roomCode: string, roomId: string): Promise<boolean>;
}

export class InMemoryRoomCodeRegistry implements RoomCodeRegistry {
  private readonly roomIdsByCode = new Map<string, string>();

  async allocate(roomId: string): Promise<string> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const roomCode = randomInt(100_000, 1_000_000).toString();
      if (this.roomIdsByCode.has(roomCode)) continue;
      this.roomIdsByCode.set(roomCode, roomId);
      return roomCode;
    }
    throw new Error("Unable to allocate a room code. Please try again.");
  }

  async release(roomCode: string, roomId: string): Promise<boolean> {
    if (this.roomIdsByCode.get(roomCode) !== roomId) return false;
    return this.roomIdsByCode.delete(roomCode);
  }
}

export class RedisRoomCodeRegistry implements RoomCodeRegistry {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(redisUrl: string, ttlSeconds = 86_400) {
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.ttlSeconds = ttlSeconds;
  }

  async allocate(roomId: string): Promise<string> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const roomCode = randomInt(100_000, 1_000_000).toString();
      const created = await this.redis.set(this.key(roomCode), roomId, "EX", this.ttlSeconds, "NX");
      if (created === "OK") return roomCode;
    }
    throw new Error("Unable to allocate a room code. Please try again.");
  }

  async release(roomCode: string, roomId: string): Promise<boolean> {
    const result = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      this.key(roomCode),
      roomId,
    );
    return result === 1;
  }

  private key(roomCode: string): string {
    return `ngame:room-code:${roomCode}`;
  }
}

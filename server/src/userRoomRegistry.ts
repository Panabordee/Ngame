import { Redis } from "ioredis";

export type UserRoomReservation = "created" | "same-room" | "conflict";

export interface UserRoomRegistry {
  reserve(userId: string, roomId: string): Promise<UserRoomReservation>;
  release(userId: string, roomId: string): Promise<boolean>;
}

export class InMemoryUserRoomRegistry implements UserRoomRegistry {
  private readonly roomsByUserId = new Map<string, string>();

  async reserve(userId: string, roomId: string): Promise<UserRoomReservation> {
    const current = this.roomsByUserId.get(userId);
    if (current !== undefined) return current === roomId ? "same-room" : "conflict";
    this.roomsByUserId.set(userId, roomId);
    return "created";
  }

  async release(userId: string, roomId: string): Promise<boolean> {
    if (this.roomsByUserId.get(userId) !== roomId) return false;
    return this.roomsByUserId.delete(userId);
  }
}

export class RedisUserRoomRegistry implements UserRoomRegistry {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(redisUrl: string, ttlSeconds = 86_400) {
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.ttlSeconds = ttlSeconds;
  }

  async reserve(userId: string, roomId: string): Promise<UserRoomReservation> {
    const key = this.key(userId);
    const created = await this.redis.set(key, roomId, "EX", this.ttlSeconds, "NX");
    if (created === "OK") return "created";
    const current = await this.redis.get(key);
    if (current !== roomId) return "conflict";
    await this.redis.expire(key, this.ttlSeconds);
    return "same-room";
  }

  async release(userId: string, roomId: string): Promise<boolean> {
    const result = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      this.key(userId),
      roomId,
    );
    return result === 1;
  }

  private key(userId: string): string {
    return `ngame:active-player:${userId}`;
  }
}

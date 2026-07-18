import { Redis } from "ioredis";

export type GuestSessionPhase = "reserved" | "committed";

interface GuestSessionBinding {
  readonly roomId: string;
  readonly expiresAtMs: number;
  phase: GuestSessionPhase;
}

export type GuestReservation = "created" | "same-room" | "conflict";

export interface GuestSessionRegistry {
  reserve(
    guestSessionId: string,
    roomId: string,
    expiresAtMs: number,
  ): Promise<GuestReservation>;
  commit(guestSessionId: string, roomId: string): Promise<boolean>;
  releaseReservation(guestSessionId: string, roomId: string): Promise<boolean>;
}

export class InMemoryGuestSessionRegistry implements GuestSessionRegistry {
  private readonly bindings = new Map<string, GuestSessionBinding>();

  async reserve(
    guestSessionId: string,
    roomId: string,
    expiresAtMs: number,
  ): Promise<GuestReservation> {
    this.pruneExpired();
    const current = this.bindings.get(guestSessionId);
    if (current !== undefined) {
      return current.roomId === roomId ? "same-room" : "conflict";
    }
    this.bindings.set(guestSessionId, {
      roomId,
      expiresAtMs,
      phase: "reserved",
    });
    return "created";
  }

  async commit(guestSessionId: string, roomId: string): Promise<boolean> {
    this.pruneExpired();
    const current = this.bindings.get(guestSessionId);
    if (current === undefined || current.roomId !== roomId) return false;
    current.phase = "committed";
    return true;
  }

  async releaseReservation(guestSessionId: string, roomId: string): Promise<boolean> {
    this.pruneExpired();
    const current = this.bindings.get(guestSessionId);
    if (
      current === undefined ||
      current.roomId !== roomId ||
      current.phase !== "reserved"
    ) {
      return false;
    }
    return this.bindings.delete(guestSessionId);
  }

  private pruneExpired(now = Date.now()): void {
    for (const [guestSessionId, binding] of this.bindings) {
      if (binding.expiresAtMs <= now) this.bindings.delete(guestSessionId);
    }
  }
}

export class RedisGuestSessionRegistry implements GuestSessionRegistry {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  async reserve(guestSessionId: string, roomId: string, expiresAtMs: number): Promise<GuestReservation> {
    const key = this.key(guestSessionId);
    const binding = JSON.stringify({ roomId, phase: "reserved" });
    const created = await this.redis.set(key, binding, "PX", Math.max(1, expiresAtMs - Date.now()), "NX");
    if (created === "OK") return "created";
    const current = await this.redis.get(key);
    if (current === null) return this.reserve(guestSessionId, roomId, expiresAtMs);
    try { return (JSON.parse(current) as GuestSessionBinding).roomId === roomId ? "same-room" : "conflict"; }
    catch { return "conflict"; }
  }

  async commit(guestSessionId: string, roomId: string): Promise<boolean> {
    const result = await this.redis.eval("local v=redis.call('get',KEYS[1]); if not v then return 0 end; local b=cjson.decode(v); if b.roomId~=ARGV[1] then return 0 end; b.phase='committed'; redis.call('set',KEYS[1],cjson.encode(b),'KEEPTTL'); return 1", 1, this.key(guestSessionId), roomId);
    return result === 1;
  }

  async releaseReservation(guestSessionId: string, roomId: string): Promise<boolean> {
    const result = await this.redis.eval("local v=redis.call('get',KEYS[1]); if not v then return 0 end; local b=cjson.decode(v); if b.roomId==ARGV[1] and b.phase=='reserved' then return redis.call('del',KEYS[1]) end; return 0", 1, this.key(guestSessionId), roomId);
    return result === 1;
  }

  private key(guestSessionId: string): string { return `ngame:guest-session:${guestSessionId}`; }
}

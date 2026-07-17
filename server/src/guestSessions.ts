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
  ): GuestReservation;
  commit(guestSessionId: string, roomId: string): boolean;
  releaseReservation(guestSessionId: string, roomId: string): boolean;
}

export class InMemoryGuestSessionRegistry implements GuestSessionRegistry {
  private readonly bindings = new Map<string, GuestSessionBinding>();

  reserve(
    guestSessionId: string,
    roomId: string,
    expiresAtMs: number,
  ): GuestReservation {
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

  commit(guestSessionId: string, roomId: string): boolean {
    this.pruneExpired();
    const current = this.bindings.get(guestSessionId);
    if (current === undefined || current.roomId !== roomId) return false;
    current.phase = "committed";
    return true;
  }

  releaseReservation(guestSessionId: string, roomId: string): boolean {
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

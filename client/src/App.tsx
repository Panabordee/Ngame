import { useEffect, useRef, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
  type CardColor,
  type GuestDisplayNameUpdatedMessage,
  type Rank,
  type RoomSettings,
  type RoomSettingsAppliedMessage,
  type RoomErrorMessage,
  type StateEnvelope,
} from "@ngame/shared";

import {
  clearGuestReconnectionToken,
  clearGuestSession,
  createGuestSession,
  guestReconnectionToken,
  logout,
  refresh,
  restoreGuestSession,
  saveGuestDisplayName,
  saveGuestReconnectionToken,
  startGoogleLogin,
  updateProfile,
  type AuthResponse,
} from "./auth.ts";
import { GameTable } from "./GameTable.tsx";
import { CardView } from "./CardView.tsx";

const REALTIME_URL = import.meta.env.VITE_REALTIME_URL ?? "http://localhost:2567";

interface GuessForm {
  targetPlayerId: string;
  targetCardId: string;
  rank: Rank | "JOKER" | null;
  color: CardColor | null;
}

const INITIAL_GUESS: GuessForm = {
  targetPlayerId: "",
  targetCardId: "",
  rank: null,
  color: null,
};

const INITIAL_SETTINGS: RoomSettings = {
  preset: "classic",
  turnSeconds: 120,
  totalCards: 40,
  drawRounds: 2,
  jokerCount: 2,
};

type JoinMode = "quick" | "create-code" | "join-code";
type SettingsSaveStatus = "synced" | "dirty" | "applying" | "approved";

function roomSettingsEqual(left: RoomSettings, right: RoomSettings): boolean {
  return (
    left.preset === right.preset &&
    left.turnSeconds === right.turnSeconds &&
    left.totalCards === right.totalCards &&
    left.drawRounds === right.drawRounds &&
    left.jokerCount === right.jokerCount
  );
}

function realtimeHttpUrl(): string {
  return REALTIME_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestRoomName, setGuestRoomName] = useState("");
  const [guestNameRoomId, setGuestNameRoomId] = useState<string | null>(null);
  const [guestNameSaving, setGuestNameSaving] = useState(false);
  const [desiredPlayers, setDesiredPlayers] = useState(3);
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<StateEnvelope | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState<GuessForm>(INITIAL_GUESS);
  const [selectedPenaltyCardId, setSelectedPenaltyCardId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<RoomSettings>(INITIAL_SETTINGS);
  const [settingsRoomId, setSettingsRoomId] = useState<string | null>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<SettingsSaveStatus>("synced");
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const guestRestoreAttempted = useRef(false);

  const game = state?.game ?? null;
  const roomPlayer = state?.players.find((player) => player.id === auth?.user.id);
  const normalizedGuestRoomName = guestRoomName.trim().replace(/\s+/gu, " ");
  const guestRoomNameChanged =
    normalizedGuestRoomName.length > 0 &&
    normalizedGuestRoomName !== roomPlayer?.displayName;
  const playerLabel = (playerId: string | null | undefined): string => {
    const player = state?.players.find((candidate) => candidate.id === playerId);
    if (player === undefined) return "Player";
    return `${player.displayName}${player.accountType === "guest" ? " · GUEST" : ""}`;
  };
  const isMyTurn = game?.currentPlayerId === auth?.user.id;
  const canHostStart =
    roomPlayer?.isHost === true &&
    (state?.connectedPlayers ?? 0) >= 3 &&
    state?.players.every((player) => player.ready) === true;
  const canDraw = room !== null && isMyTurn && game?.phase === "draw" && state?.status === "playing";
  const canGuess =
    room !== null &&
    isMyTurn &&
    game?.phase === "guess" &&
    guess.targetPlayerId.length > 0 &&
    guess.targetCardId.length > 0 &&
    guess.rank !== null &&
    (guess.rank === "JOKER" || guess.color !== null) &&
    state?.status === "playing";
  const canStopAndPlace =
    room !== null &&
    isMyTurn &&
    game?.phase === "guess" &&
    game.pendingDraw !== null &&
    game.correctGuessesThisTurn > 0 &&
    state?.status === "playing";
  const canRevealPenalty =
    room !== null &&
    isMyTurn &&
    game?.phase === "self-penalty" &&
    selectedPenaltyCardId.length > 0 &&
    state?.status === "playing";
  const turnRemainingSeconds =
    state?.turnDeadlineMs === null || state?.turnDeadlineMs === undefined
      ? null
      : Math.max(
          0,
          Math.ceil(
            (state.turnDeadlineMs - (clockNow + serverClockOffsetMs)) / 1_000,
          ),
        );
  const settingsChanged = state !== null && !roomSettingsEqual(settingsDraft, state.settings);
  const visibleSettingsStatus = settingsSaveStatus === "applying"
    ? "applying"
    : settingsChanged
      ? "dirty"
      : settingsSaveStatus === "approved"
        ? "approved"
        : "synced";

  useEffect(() => {
    let active = true;
    const isGoogleCallback = window.location.pathname === "/auth/callback";
    if (isGoogleCallback) {
      clearGuestSession();
      const oauthError = new URLSearchParams(window.location.search).get("error");
      if (oauthError === "identity_conflict") {
        setError("That email is already linked to another sign-in method.");
      } else if (oauthError !== null) {
        setError("Google sign-in was cancelled or could not be completed.");
      }
      window.history.replaceState({}, document.title, "/");
    }
    if (!isGoogleCallback) {
      const guestSession = restoreGuestSession();
      if (guestSession !== null) {
        setAuth(guestSession);
        setAuthReady(true);
        return () => {
          active = false;
        };
      }
    }
    void refresh()
      .then((session) => {
        if (active) setAuth(session);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !authReady ||
      auth?.user.account_type !== "guest" ||
      room !== null ||
      guestRestoreAttempted.current
    ) {
      return;
    }
    guestRestoreAttempted.current = true;
    const reconnectionToken = guestReconnectionToken();
    if (reconnectionToken === null) return;

    let active = true;
    setConnectionStatus("reconnecting");
    const client = new Client(REALTIME_URL);
    client.auth.token = auth.access_token;
    void client.reconnect(reconnectionToken)
      .then((reconnected) => {
        if (!active) {
          void reconnected.leave(false);
          return;
        }
        attachRoom(reconnected, auth);
      })
      .catch((caught) => {
        if (!active) return;
        clearGuestReconnectionToken();
        setConnectionStatus("disconnected");
        setError(`Guest match could not be restored: ${errorText(caught)}`);
      });
    return () => {
      active = false;
    };
  }, [auth, authReady, room]);

  useEffect(() => {
    setGuess((current) => ({
      ...current,
      targetPlayerId: "",
      targetCardId: "",
    }));
    setSelectedPenaltyCardId("");
  }, [game?.turn]);

  useEffect(() => {
    if (room === null || state?.settings === undefined || settingsRoomId === room.roomId) return;
    setSettingsDraft(state.settings);
    setSettingsRoomId(room.roomId);
    setSettingsSaveStatus("synced");
  }, [room, settingsRoomId, state?.settings]);

  useEffect(() => {
    if (
      room === null ||
      auth?.user.account_type !== "guest" ||
      roomPlayer === undefined ||
      guestNameRoomId === room.roomId
    ) {
      return;
    }
    setGuestRoomName(roomPlayer.displayName);
    setGuestNameRoomId(room.roomId);
    setGuestNameSaving(false);
  }, [auth?.user.account_type, guestNameRoomId, room, roomPlayer]);

  useEffect(() => {
    if (state?.turnDeadlineMs === null || state?.turnDeadlineMs === undefined) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state?.turnDeadlineMs]);

  useEffect(() => {
    if (!rulesOpen) return;
    function closeRulesOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setRulesOpen(false);
    }
    window.addEventListener("keydown", closeRulesOnEscape);
    return () => window.removeEventListener("keydown", closeRulesOnEscape);
  }, [rulesOpen]);

  function attachRoom(joined: Room, session: AuthResponse): void {
    let lastStatus: StateEnvelope["status"] | null = null;
    if (session.user.account_type === "guest") {
      saveGuestReconnectionToken(joined.reconnectionToken);
    }
    joined.onMessage("state", (message: StateEnvelope) => {
      lastStatus = message.status;
      setServerClockOffsetMs(message.serverTimeMs - Date.now());
      setState(message);
      if (session.user.account_type === "guest" && message.status === "finished") {
        clearGuestSession();
      }
    });
    joined.onMessage("error", (message: RoomErrorMessage) => {
      setError(`${message.code}: ${message.message}`);
      if (["INVALID_GUEST_NAME", "GUEST_ONLY", "NAME_TAKEN", "MATCH_ALREADY_STARTED"].includes(message.code)) {
        setGuestNameSaving(false);
      }
      setSettingsSaveStatus((current) => current === "applying" ? "dirty" : current);
    });
    joined.onMessage("settings-applied", (message: RoomSettingsAppliedMessage) => {
      setSettingsDraft(message.settings);
      setSettingsSaveStatus("approved");
      window.setTimeout(() => {
        setSettingsSaveStatus((current) => current === "approved" ? "synced" : current);
      }, 2_400);
    });
    joined.onMessage("guest-name-updated", (message: GuestDisplayNameUpdatedMessage) => {
      setGuestRoomName(message.displayName);
      setGuestNameSaving(false);
      const updated = saveGuestDisplayName(message.displayName);
      if (updated !== null) setAuth(updated);
    });
    joined.onDrop(() => {
      setGuestNameSaving(false);
      setConnectionStatus("reconnecting");
    });
    joined.onReconnect(() => {
      if (session.user.account_type === "guest") {
        saveGuestReconnectionToken(joined.reconnectionToken);
      }
      setConnectionStatus("connected");
      joined.send("sync");
    });
    joined.onLeave(() => {
      clearGuestReconnectionToken();
      if (
        session.user.account_type === "guest" &&
        lastStatus !== null &&
        lastStatus !== "waiting"
      ) {
        clearGuestSession();
      }
      setConnectionStatus("disconnected");
      setGuestNameSaving(false);
      setRoom(null);
      setState(null);
      setSettingsRoomId(null);
      setGuestNameRoomId(null);
    });
    setRoom(joined);
    setConnectionStatus("connected");
    joined.send("sync");
    if (session.user.account_type === "guest") {
      joined.send("update-guest-name", { displayName: session.user.display_name });
    }
  }

  async function joinRoom(mode: JoinMode): Promise<void> {
    if (auth === null) return;
    const normalizedCode = roomCode.trim();
    if (mode === "join-code" && !/^\d{6}$/.test(normalizedCode)) {
      setError("Room code must contain exactly six digits.");
      return;
    }
    setError(null);
    setConnectionStatus("connecting");
    try {
      const currentSession = auth.user.account_type === "guest" ? auth : await refresh();
      setAuth(currentSession);
      const client = new Client(REALTIME_URL);
      client.auth.token = currentSession.access_token;
      let joined: Room;
      if (mode === "quick") {
        joined = await client.joinOrCreate("cipher_deck", {
          desiredPlayers,
          lobbyMode: "public",
        });
      } else if (mode === "create-code") {
        joined = await client.create("cipher_deck", {
          desiredPlayers,
          lobbyMode: "code",
        });
      } else {
        const lookupResponse = await fetch(
          `${realtimeHttpUrl()}/rooms/by-code/${normalizedCode}`,
        );
        const lookup = (await lookupResponse.json()) as {
          roomId?: string;
          detail?: string;
        };
        if (!lookupResponse.ok || lookup.roomId === undefined) {
          throw new Error(lookup.detail ?? "Room code was not found.");
        }
        joined = await client.joinById(lookup.roomId);
      }
      attachRoom(joined, currentSession);
    } catch (caught) {
      setConnectionStatus("disconnected");
      setError(errorText(caught));
    }
  }

  async function signOut(): Promise<void> {
    setError(null);
    try {
      if (room !== null) await room.leave(true);
      if (auth?.user.account_type === "registered") {
        await logout();
      } else {
        clearGuestSession();
      }
      setRoom(null);
      setState(null);
      setProfileOpen(false);
      setAuth(null);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function continueAsGuest(): Promise<void> {
    setGuestLoading(true);
    setError(null);
    try {
      const session = await createGuestSession(guestName);
      guestRestoreAttempted.current = true;
      setProfileOpen(false);
      setAuth(session);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setGuestLoading(false);
    }
  }

  function sendGuess(): void {
    if (!canGuess) return;
    room?.send("guess", {
      targetPlayerId: guess.targetPlayerId,
      targetCardId: guess.targetCardId,
      guess: guess.rank === "JOKER"
        ? { kind: "joker" }
        : { kind: "standard", rank: guess.rank, color: guess.color },
    });
    setGuess(INITIAL_GUESS);
  }

  function openProfile(): void {
    if (auth === null) return;
    setRulesOpen(false);
    setProfileName(auth.user.display_name);
    setProfileUsername(auth.user.username ?? "");
    setProfileOpen(true);
  }

  async function saveProfile(): Promise<void> {
    if (auth === null) return;
    setProfileSaving(true);
    setError(null);
    try {
      const user = await updateProfile(auth.access_token, {
        display_name: profileName,
        username: profileUsername,
      });
      setAuth({ ...auth, user });
      setProfileOpen(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setProfileSaving(false);
    }
  }

  function saveRoomSettings(): void {
    if (room === null || !settingsChanged || settingsSaveStatus === "applying") return;
    setSettingsSaveStatus("applying");
    room?.send("update-settings", settingsDraft);
  }

  function saveGuestRoomName(): void {
    if (
      room === null ||
      auth?.user.account_type !== "guest" ||
      state?.status !== "waiting" ||
      !guestRoomNameChanged ||
      guestNameSaving
    ) {
      return;
    }
    setGuestNameSaving(true);
    setError(null);
    room.send("update-guest-name", { displayName: normalizedGuestRoomName });
  }

  if (!authReady) {
    return (
      <main className="loading-screen">
        <span className="cipher-mark">◇</span>
        <p>Restoring encrypted session…</p>
      </main>
    );
  }

  if (auth === null) {
    return (
      <main className="auth-screen">
        <div className="auth-art" aria-hidden="true">
          <span className="brand-rune">◇</span>
          <p>READ THE PATTERN</p>
        </div>
        <section className="auth-panel">
          <header className="brand-lockup">
            <span className="eyebrow">NGAME PRESENTS</span>
            <h1>CIPHER<span>DECK</span></h1>
            <p>Every card tells a story. Most of them are lying.</p>
          </header>
          {error !== null && <p className="error-banner">{error}</p>}
          <button className="google-button" onClick={startGoogleLogin}>
            Continue with Google
          </button>
          <div className="auth-divider"><span>or play one match</span></div>
          <form
            className="guest-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void continueAsGuest();
            }}
          >
            <label htmlFor="guest-display-name">Guest display name</label>
            <div>
              <input
                id="guest-display-name"
                maxLength={32}
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="Optional — we can generate one"
                autoComplete="nickname"
              />
              <button className="guest-button" type="submit" disabled={guestLoading}>
                {guestLoading ? "Creating…" : "Continue as Guest"}
              </button>
            </div>
          </form>
          <small className="auth-note">
            Google creates a persistent profile. Guest access lasts for one match and is not saved as an account.
          </small>
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="mini-brand"><span>◇</span><strong>CIPHERDECK</strong></div>
        <div className="topbar-status">
          <span className={`connection-dot status-${connectionStatus}`} />
          {connectionStatus}
          {state !== null && <span className={`match-status match-${state.status}`}>{state.status}</span>}
        </div>
        <div className="topbar-account">
          <button
            type="button"
            className="help-icon-button"
            aria-label="เปิดวิธีการเล่น"
            title="วิธีการเล่น"
            onClick={() => {
              setProfileOpen(false);
              setRulesOpen(true);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.8 9a2.35 2.35 0 0 1 4.48 1c0 1.78-2.28 2.02-2.28 3.55" />
              <path d="M12 17.2h.01" />
            </svg>
          </button>
          <div className="profile-chip">
            <span>{auth.user.display_name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{auth.user.display_name}</strong>
              <small>{auth.user.account_type === "guest" ? "Guest · one match" : auth.user.username === null ? auth.user.email : `@${auth.user.username}`}</small>
            </div>
            {auth.user.account_type === "registered" && <button type="button" onClick={openProfile}>Profile</button>}
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>

      {rulesOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRulesOpen(false)}>
          <section
            className="rules-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="rules-modal-header">
              <div>
                <span className="eyebrow">HOW TO PLAY</span>
                <h2 id="rules-title">วิธีเล่น CipherDeck</h2>
              </div>
              <button
                type="button"
                className="modal-close-button"
                aria-label="ปิดวิธีการเล่น"
                onClick={() => setRulesOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="rules-flow" aria-label="ลำดับการเล่นในหนึ่งเทิร์น">
              <span>จั่วไพ่</span>
              <b>→</b>
              <span>เดาไพ่</span>
              <b>→</b>
              <span>เดาต่อหรือวาง</span>
            </div>

            <div className="rules-grid">
              <article className="rule-step">
                <span className="rule-number">01</span>
                <div>
                  <h3>เตรียมห้อง</h3>
                  <p>ทุกคนกด Ready แล้ว Host จึงกด Start เพื่อเริ่มเกม การตั้งค่าห้องกำหนดเวลา จำนวนไพ่ และจำนวนรอบที่จั่วได้</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">02</span>
                <div>
                  <h3>หาคนเริ่ม</h3>
                  <p>เลือกไพ่ลับคนละ 1 ใบจาก 6 ใบ ผู้ที่ได้ไพ่สูงสุดหรือ Joker เริ่มก่อน ถ้าเสมอจะสุ่มใหม่ จากนั้นเจ้าของเลือกตำแหน่งให้ Joker ทุกใบในมือเริ่มต้น</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">03</span>
                <div>
                  <h3>จั่วแล้วต้องเดา</h3>
                  <p>เมื่อเริ่มเทิร์นให้จั่วไพ่ จากนั้นเลือกไพ่คว่ำของคู่ต่อสู้ เลือกเลขก่อน แล้วเลือกสีแดง ดำ หรือ Joker เพื่อส่งคำตอบ</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">04</span>
                <div>
                  <h3>เมื่อเดาถูก</h3>
                  <p>ไพ่เป้าหมายจะถูกเปิด คุณเลือกเดาต่อเพื่อทำแต้มต่อเนื่อง หรือกดจบแล้ววางไพ่ที่จั่วมาแบบคว่ำในตำแหน่งที่ถูกต้อง</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">05</span>
                <div>
                  <h3>เมื่อเดาผิด</h3>
                  <p>ไพ่ที่จั่วมาจะถูกเปิด และคุณต้องเลือกช่องวางที่ถูกต้อง หากกองจั่วหมดแล้ว ให้เลือกเปิดไพ่คว่ำของตัวเอง 1 ใบแทน</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">06</span>
                <div>
                  <h3>การเรียงและชนะ</h3>
                  <p>เรียงจาก A ถึง K โดยสีแดงมาก่อนสีดำเมื่อเลขเท่ากัน ไม่แยกดอก ส่วน Joker วางช่องใดก็ได้ ผู้เล่นคนสุดท้ายที่ยังมีไพ่คว่ำเป็นผู้ชนะ</p>
                </div>
              </article>
            </div>

            <p className="rules-note">
              <strong>เวลา:</strong> เวลาจะรีเซ็ตหลังทุก action และเตือนสีส้มใน 10 วินาทีสุดท้าย หากไม่ทำ action ก่อนหมดเวลาจะถูกเปิดไพ่ทั้งมือและแพ้ทันที
            </p>
          </section>
        </div>
      )}

      {profileOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setProfileOpen(false)}>
          <form
            className="profile-modal"
            aria-label="Player profile"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProfile();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">PLAYER PROFILE</span>
            <h2>Choose how players see you</h2>
            <label>
              Display name
              <input required minLength={1} maxLength={32} value={profileName} onChange={(event) => setProfileName(event.target.value)} />
            </label>
            <label>
              Username
              <input required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} placeholder="cipher_player" />
              <small>3–20 characters: letters, numbers, and underscore.</small>
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setProfileOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save profile"}</button>
            </div>
          </form>
        </div>
      )}

      {error !== null && <div className="error-banner floating-error"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}

      {room === null ? (
        <section className="lobby-screen">
          <div className="lobby-card">
            <span className="eyebrow">AUTHORITATIVE MULTIPLAYER</span>
            <h1>Enter the table</h1>
            <p>Choose a room size. The host starts the match when everyone is ready.</p>
            <div className="player-count-picker">
              {[3, 4, 5, 6].map((count) => (
                <button key={count} className={desiredPlayers === count ? "is-active" : ""} onClick={() => setDesiredPlayers(count)}>
                  <strong>{count}</strong><span>players</span>
                </button>
              ))}
            </div>
            <div className="lobby-actions">
              <button className="primary-button" disabled={connectionStatus === "connecting"} onClick={() => void joinRoom("quick")}>Quick Match</button>
              <button className="secondary-button" disabled={connectionStatus === "connecting"} onClick={() => void joinRoom("create-code")}>Create room code</button>
            </div>
            <form className="room-code-join" onSubmit={(event) => {
              event.preventDefault();
              void joinRoom("join-code");
            }}>
              <label htmlFor="room-code">Join a numbered room</label>
              <div>
                <input
                  id="room-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <button type="submit" className="secondary-button" disabled={connectionStatus === "connecting"}>Join code</button>
              </div>
            </form>
          </div>
          <aside className="rules-glance">
            <h2>At a glance</h2>
            <ol><li><span>01</span>Draw a card, then make a mandatory guess before placing it.</li><li><span>02</span>Correct: guess again or stop and place it face-down.</li><li><span>03</span>Wrong: reveal the drawn card and place it in a legal slot.</li><li><span>04</span>When the pile is empty, one guess decides the turn.</li></ol>
          </aside>
        </section>
      ) : (
        <div className="match-layout">
          <section className="match-toolbar">
            <div>
              <span className="eyebrow">{state?.lobbyMode === "code" ? "NUMBERED ROOM" : "PUBLIC ROOM"}</span>
              <h1>{state?.status === "waiting" ? "Waiting for players" : "Cipher table"}</h1>
              <p>{state === null ? "Synchronizing state…" : `${state.connectedPlayers}/${state.desiredPlayers} players connected`}</p>
              {state?.roomCode !== null && state?.roomCode !== undefined && (
                <div className="room-code-display">
                  <span>ROOM CODE</span>
                  <strong>{state.roomCode}</strong>
                  <button type="button" onClick={() => void navigator.clipboard.writeText(state.roomCode ?? "")}>Copy</button>
                </div>
              )}
            </div>
            <div className="toolbar-actions">
              <button className="danger-button" onClick={() => void room.leave(true)}>Leave room</button>
            </div>
          </section>

          {game !== null ? (
            <>
              <GameTable
                game={game}
                viewerId={auth.user.id}
                viewerName={roomPlayer?.displayName ?? auth.user.display_name}
                viewerAccountType={auth.user.account_type}
                playerNames={Object.fromEntries((state?.players ?? []).map((player) => [player.id, player.displayName]))}
                playerAccountTypes={Object.fromEntries((state?.players ?? []).map((player) => [player.id, player.accountType]))}
                actionsEnabled={state?.status === "playing" || state?.status === "starting"}
                turnRemainingSeconds={turnRemainingSeconds}
                selectedTargetCardId={guess.targetCardId}
                selectedPenaltyCardId={selectedPenaltyCardId}
                guessRank={guess.rank}
                guessColor={guess.color}
                onSelectTarget={(targetPlayerId, targetCardId) => setGuess({ targetPlayerId, targetCardId, rank: null, color: null })}
                onSelectGuessRank={(rank) => setGuess((current) => ({ ...current, rank, color: null }))}
                onSelectGuessColor={(color) => setGuess((current) => ({ ...current, color }))}
                onConfirmGuess={sendGuess}
                onCancelGuess={() => setGuess(INITIAL_GUESS)}
                onSelectPenalty={setSelectedPenaltyCardId}
                onInsert={(rackIndex) => room.send(game.phase === "starter-place" ? "place-starting-joker" : "insert", { rackIndex })}
              />

              <section className="control-dock">
                <div className="phase-instruction">
                  <span className="eyebrow">YOUR ACTION</span>
                  <strong>{game.phase === "starter-place" ? (game.pendingStartingJokerCardIds.length > 0 ? `Place an opening-hand Joker · ${game.pendingStartingJokerCardIds.length} left` : "Waiting for opening-hand Joker placement") : !isMyTurn ? "Observe the table" : game.phase === "draw" ? "Draw a card" : game.phase === "place" ? "Place your card face-down" : game.phase === "penalty-place" ? "Place your revealed card" : game.phase === "self-penalty" ? "Choose one of your cards to reveal" : game.phase === "guess" && game.correctGuessesThisTurn > 0 ? "Guess again or stop and place" : game.phase === "guess" ? "Make the required guess" : "Match complete"}</strong>
                </div>
                <div className="turn-actions">
                  <button className="draw-button" disabled={!canDraw} onClick={() => room.send("draw")}><span>◆</span> DRAW</button>
                  <button className="stop-button" disabled={!canStopAndPlace} onClick={() => room.send("stop")}>END &amp; PLACE</button>
                  <button className="penalty-button" disabled={!canRevealPenalty} onClick={() => {
                    room.send("self-penalty", { cardId: selectedPenaltyCardId });
                    setSelectedPenaltyCardId("");
                  }}>REVEAL SELECTED</button>
                </div>
                <p className="target-readout">{guess.targetCardId ? "Finish the guess beside the selected card." : "Select a face-down opponent card to guess."}</p>
              </section>
            </>
          ) : state?.startingSelection !== null && state?.startingSelection !== undefined ? (
            <section className="starter-selection">
              <span className="eyebrow">STARTING PLAYER · ROUND {state.startingSelection.round}</span>
              <h2>{state.startingSelection.phase === "choosing" ? "Choose one face-down card" : "Cards revealed"}</h2>
              <p>
                {state.startingSelection.phase === "choosing"
                  ? state.startingSelection.eligiblePlayerIds.includes(auth.user.id)
                    ? "Pick an available card. The highest rank starts; Joker is highest."
                    : "Only tied players are choosing again."
                  : state.startingSelection.starterPlayerId === null
                    ? "The highest cards tied. Tied players receive six fresh choices next."
                    : `${playerLabel(state.startingSelection?.starterPlayerId)} will start.`}
              </p>
              {state.startingSelection.phase === "choosing" && (
                <div className="starter-choice-status" aria-live="polite">
                  <span>
                    {state.startingSelection.options.filter((option) => option.selectedByPlayerId !== null).length}
                    /{state.startingSelection.eligiblePlayerIds.length}
                  </span>
                  <p>
                    {state.startingSelection.options.some((option) => option.selectedByPlayerId === auth.user.id)
                      ? "Choice locked · waiting for other players"
                      : state.startingSelection.eligiblePlayerIds.includes(auth.user.id)
                        ? "Your turn to choose · select any available card"
                        : "Waiting for the tied players to choose"}
                  </p>
                </div>
              )}
              <div className="starter-card-row" role="group" aria-label="Starting-player card choices">
                {state.startingSelection.options.map((option, index) => {
                  const selectedByMe = option.selectedByPlayerId === auth.user.id;
                  const alreadySelected = state.startingSelection?.options.some(
                    (candidate) => candidate.selectedByPlayerId === auth.user.id,
                  ) ?? false;
                  const canSelect =
                    state.startingSelection?.phase === "choosing" &&
                    state.startingSelection.eligiblePlayerIds.includes(auth.user.id) &&
                    !alreadySelected &&
                    option.selectedByPlayerId === null;
                  return (
                    <div className={`starter-option ${selectedByMe ? "is-mine" : option.selectedByPlayerId !== null ? "is-claimed" : "is-available"}`} key={option.id}>
                      <CardView
                        card={option.card ?? { id: option.id, kind: "hidden", revealed: false }}
                        revealed={option.card !== null}
                        selected={selectedByMe}
                        interactive={canSelect}
                        onSelect={() => room.send("select-starting-card", { cardId: option.id })}
                        label={`Starting choice ${index + 1}`}
                      />
                      <small>
                        {option.selectedByPlayerId === null
                          ? `CHOOSE ${index + 1}`
                          : selectedByMe
                            ? "YOUR CARD"
                            : playerLabel(option.selectedByPlayerId)}
                      </small>
                    </div>
                  );
                })}
              </div>
              {state.startingSelection.resolvedCards.length > 0 && (
                <div className="resolved-starters">
                  {state.startingSelection.resolvedCards.map((result) => (
                    <span key={result.playerId}>
                      {playerLabel(result.playerId)}: {result.card.kind === "joker" ? "JOKER" : `${result.card.rank} ${result.card.color}`}
                    </span>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="waiting-room">
              <div className="waiting-rune">◇</div>
              <h2>Seats are filling</h2>
              <p>The host may start with 3–{state?.desiredPlayers ?? desiredPlayers} ready players.</p>
              {auth.user.account_type === "guest" && roomPlayer !== undefined && (
                <form
                  className="guest-room-name-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveGuestRoomName();
                  }}
                >
                  <label htmlFor="guest-room-display-name">
                    <span>Guest name in this room</span>
                    <small>Editable until the host starts</small>
                  </label>
                  <div>
                    <input
                      id="guest-room-display-name"
                      required
                      maxLength={32}
                      value={guestRoomName}
                      onChange={(event) => setGuestRoomName(event.target.value)}
                      autoComplete="nickname"
                    />
                    <button
                      type="submit"
                      className="secondary-button"
                      disabled={!guestRoomNameChanged || guestNameSaving}
                    >
                      {guestNameSaving ? "Saving…" : "Save name"}
                    </button>
                  </div>
                </form>
              )}
              {state !== null && roomPlayer?.isHost !== true && (
                <div className="settings-summary">
                  <strong>{state.settings.preset === "classic" ? "Classic" : `Custom · ${state.settings.totalCards} cards`}</strong>
                  <span>{state.settings.drawRounds} draw rounds · {state.settings.turnSeconds === 0 ? "No timer" : `${state.settings.turnSeconds}s per action`}</span>
                </div>
              )}
              {roomPlayer?.isHost === true && state !== null && (
                <section className="room-settings-panel">
                  <header className="room-settings-header">
                    <div>
                      <span className="eyebrow">HOST CONTROLS</span>
                      <h3>Match settings</h3>
                      <p>Shape the table before everyone readies up.</p>
                    </div>
                    <span className="settings-mode-badge">
                      {settingsDraft.preset === "classic" ? "CLASSIC DECK" : "CUSTOM DECK"}
                    </span>
                  </header>

                  <form className="room-settings" onSubmit={(event) => {
                    event.preventDefault();
                    saveRoomSettings();
                  }}>
                    <div className="room-settings-fields">
                      <label className="settings-field">
                        <span>Ruleset</span>
                        <small>Choose the deck format</small>
                        <select value={settingsDraft.preset} onChange={(event) => setSettingsDraft({ ...settingsDraft, preset: event.target.value as RoomSettings["preset"] })}>
                          <option value="classic">Classic · full deck</option>
                          <option value="custom" disabled={state.lobbyMode === "public"}>Custom · build your deck</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span>Action timer</span>
                        <small>Time available for each decision</small>
                        <select value={settingsDraft.turnSeconds} onChange={(event) => setSettingsDraft({ ...settingsDraft, turnSeconds: Number(event.target.value) as RoomSettings["turnSeconds"] })}>
                          <option value={0}>No time limit</option>
                          <option value={30}>30 seconds</option>
                          <option value={60}>1 minute</option>
                          <option value={90}>1.5 minutes</option>
                          <option value={120}>2 minutes</option>
                          <option value={180}>3 minutes</option>
                          <option value={300}>5 minutes</option>
                        </select>
                      </label>
                      {settingsDraft.preset === "custom" && (
                        <>
                          <label className="settings-field">
                            <span>Total cards</span>
                            <small>24–56 cards in this match</small>
                            <input type="number" min={24} max={56} value={settingsDraft.totalCards} onChange={(event) => setSettingsDraft({ ...settingsDraft, totalCards: Number(event.target.value) })} />
                          </label>
                          <label className="settings-field">
                            <span>Draw allowance</span>
                            <small>Rounds each player may draw</small>
                            <input type="number" min={1} max={8} value={settingsDraft.drawRounds} onChange={(event) => setSettingsDraft({ ...settingsDraft, drawRounds: Number(event.target.value) })} />
                          </label>
                          <label className="settings-field">
                            <span>Jokers</span>
                            <small>Wild cards in the deck</small>
                            <select value={settingsDraft.jokerCount} onChange={(event) => setSettingsDraft({ ...settingsDraft, jokerCount: Number(event.target.value) as RoomSettings["jokerCount"] })}>
                              <option value={2}>2 Jokers</option>
                              <option value={3}>3 Jokers</option>
                              <option value={4}>4 Jokers</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>

                    <footer className="room-settings-footer">
                      <div className={`settings-save-state state-${visibleSettingsStatus}`} aria-live="polite">
                        <span className="settings-state-dot" />
                        <div>
                          <strong>
                            {visibleSettingsStatus === "applying"
                              ? "Waiting for server"
                              : visibleSettingsStatus === "approved"
                                ? "Settings approved"
                                : visibleSettingsStatus === "dirty"
                                  ? "Unsaved changes"
                                  : "Settings up to date"}
                          </strong>
                          <small>{visibleSettingsStatus === "dirty" ? "Apply to update the room" : "Applying changes resets player readiness"}</small>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className={`apply-settings-button state-${visibleSettingsStatus}`}
                        disabled={!settingsChanged || visibleSettingsStatus === "applying"}
                      >
                        {visibleSettingsStatus === "applying" ? (
                          <span className="settings-spinner" aria-hidden="true" />
                        ) : visibleSettingsStatus === "approved" ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
                        )}
                        {visibleSettingsStatus === "applying"
                          ? "Applying…"
                          : visibleSettingsStatus === "approved"
                            ? "Approved"
                            : settingsChanged
                              ? "Apply changes"
                              : "Saved"}
                      </button>
                    </footer>
                  </form>
                </section>
              )}
              <div className="waiting-player-list">
                {(state?.players ?? []).map((player) => (
                  <div key={player.id}>
                    <span className="waiting-player-name">
                      {player.displayName}
                      {player.accountType === "guest" && <em className="guest-badge">GUEST</em>}
                    </span>
                    <small>{player.isHost ? "HOST" : player.ready ? "READY" : "NOT READY"}</small>
                  </div>
                ))}
              </div>
              <div className="waiting-actions">
                <button
                  type="button"
                  className={roomPlayer?.ready ? "secondary-button ready-active" : "secondary-button"}
                  onClick={() => room.send("ready", !(roomPlayer?.ready ?? false))}
                >
                  {roomPlayer?.ready ? "Cancel ready" : "I'm ready"}
                </button>
                {roomPlayer?.isHost === true && (
                  <button type="button" className="primary-button" disabled={!canHostStart} onClick={() => room.send("start-game")}>Start game</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

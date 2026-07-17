import { useEffect, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
  type CardColor,
  type Rank,
  type RoomErrorMessage,
  type StateEnvelope,
} from "@ngame/shared";

import {
  logout,
  refresh,
  startGoogleLogin,
  updateProfile,
  type AuthResponse,
} from "./auth.ts";
import { GameTable } from "./GameTable.tsx";

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

type JoinMode = "quick" | "create-code" | "join-code";

function realtimeHttpUrl(): string {
  return REALTIME_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [desiredPlayers, setDesiredPlayers] = useState(3);
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<StateEnvelope | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState<GuessForm>(INITIAL_GUESS);
  const [selectedPenaltyCardId, setSelectedPenaltyCardId] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const game = state?.game ?? null;
  const isMyTurn = game?.currentPlayerId === auth?.user.id;
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

  useEffect(() => {
    let active = true;
    if (window.location.pathname === "/auth/callback") {
      const oauthError = new URLSearchParams(window.location.search).get("error");
      if (oauthError === "identity_conflict") {
        setError("That email is already linked to another sign-in method.");
      } else if (oauthError !== null) {
        setError("Google sign-in was cancelled or could not be completed.");
      }
      window.history.replaceState({}, document.title, "/");
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
    setGuess((current) => ({
      ...current,
      targetPlayerId: "",
      targetCardId: "",
    }));
    setSelectedPenaltyCardId("");
  }, [game?.turn]);

  function attachRoom(joined: Room): void {
    joined.onMessage("state", (message: StateEnvelope) => setState(message));
    joined.onMessage("error", (message: RoomErrorMessage) => {
      setError(`${message.code}: ${message.message}`);
    });
    joined.onDrop(() => setConnectionStatus("reconnecting"));
    joined.onReconnect(() => {
      setConnectionStatus("connected");
      joined.send("sync");
    });
    joined.onLeave(() => {
      setConnectionStatus("disconnected");
      setRoom(null);
      setState(null);
    });
    setRoom(joined);
    setConnectionStatus("connected");
    joined.send("sync");
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
      const currentSession = await refresh();
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
      attachRoom(joined);
    } catch (caught) {
      setConnectionStatus("disconnected");
      setError(errorText(caught));
    }
  }

  async function signOut(): Promise<void> {
    setError(null);
    try {
      if (room !== null) await room.leave(true);
      await logout();
      setRoom(null);
      setState(null);
      setAuth(null);
    } catch (caught) {
      setError(errorText(caught));
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
          <small className="auth-note">
            NGAME uses Google only. Your password is never handled by this service.
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
          <div className="profile-chip">
            <span>{auth.user.display_name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{auth.user.display_name}</strong><small>{auth.user.username === null ? auth.user.email : `@${auth.user.username}`}</small></div>
          <button type="button" onClick={openProfile}>Profile</button>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

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
                viewerName={auth.user.display_name}
                playerNames={Object.fromEntries((state?.players ?? []).map((player) => [player.id, player.displayName]))}
                actionsEnabled={state?.status === "playing"}
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
                onInsert={(rackIndex) => room.send("insert", { rackIndex })}
              />

              <section className="control-dock">
                <div className="phase-instruction">
                  <span className="eyebrow">YOUR ACTION</span>
                  <strong>{!isMyTurn ? "Observe the table" : game.phase === "draw" ? "Draw a card" : game.phase === "place" ? "Place your card face-down" : game.phase === "penalty-place" ? "Place your revealed card" : game.phase === "self-penalty" ? "Choose one of your cards to reveal" : game.phase === "guess" && game.correctGuessesThisTurn > 0 ? "Guess again or stop and place" : game.phase === "guess" ? "Make the required guess" : "Match complete"}</strong>
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
          ) : (
            <div className="waiting-room">
              <div className="waiting-rune">◇</div>
              <h2>Seats are filling</h2>
              <p>The room starts at {state?.desiredPlayers ?? desiredPlayers} players.</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

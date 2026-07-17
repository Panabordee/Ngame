import { useEffect, useMemo, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
  RANKS,
  type CardColor,
  type Rank,
  type RoomErrorMessage,
  type StateEnvelope,
} from "@ngame/shared";

import {
  login,
  logout,
  refresh,
  register,
  startGoogleLogin,
  type AuthResponse,
} from "./auth.ts";
import { GameTable } from "./GameTable.tsx";

const REALTIME_URL = import.meta.env.VITE_REALTIME_URL ?? "http://localhost:2567";

interface GuessForm {
  targetPlayerId: string;
  targetCardId: string;
  kind: "standard" | "joker";
  rank: Rank;
  color: CardColor;
  selfRevealCardId: string;
}

const INITIAL_GUESS: GuessForm = {
  targetPlayerId: "",
  targetCardId: "",
  kind: "standard",
  rank: "A",
  color: "red",
  selfRevealCardId: "",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

export function App() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("player1@example.com");
  const [password, setPassword] = useState("local-password-123");
  const [displayName, setDisplayName] = useState("Player 1");
  const [desiredPlayers, setDesiredPlayers] = useState(3);
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<StateEnvelope | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState<GuessForm>(INITIAL_GUESS);

  const prettyState = useMemo(() => JSON.stringify(state, null, 2), [state]);
  const game = state?.game ?? null;
  const isMyTurn = game?.currentPlayerId === auth?.user.id;
  const canDraw = room !== null && isMyTurn && game?.phase === "draw" && state?.status === "playing";
  const needsPenalty = game?.drawPileCount === 0;
  const canGuess =
    room !== null &&
    isMyTurn &&
    game?.phase === "guess" &&
    guess.targetPlayerId.length > 0 &&
    guess.targetCardId.length > 0 &&
    (!needsPenalty || guess.selfRevealCardId.length > 0) &&
    state?.status === "playing";

  useEffect(() => {
    let active = true;
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
      selfRevealCardId: "",
    }));
  }, [game?.turn]);

  async function submitAuth(mode: "login" | "register"): Promise<void> {
    setError(null);
    try {
      const session =
        mode === "register"
          ? await register(email, password, displayName)
          : await login(email, password);
      setAuth(session);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function joinRoom(): Promise<void> {
    if (auth === null) return;
    setError(null);
    setConnectionStatus("connecting");
    try {
      const client = new Client(REALTIME_URL);
      client.auth.token = auth.access_token;
      const joined = await client.joinOrCreate("cipher_deck", { desiredPlayers });
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
      guess:
        guess.kind === "joker"
          ? { kind: "joker" }
          : { kind: "standard", rank: guess.rank, color: guess.color },
      selfRevealCardId: guess.selfRevealCardId || null,
    });
    setGuess((current) => ({ ...current, targetPlayerId: "", targetCardId: "" }));
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
          <div className="auth-fields">
            <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          </div>
          <div className="auth-actions">
            <button className="primary-button" onClick={() => void submitAuth("register")}>Create account</button>
            <button className="secondary-button" onClick={() => void submitAuth("login")}>Sign in</button>
          </div>
          <button className="google-button" onClick={startGoogleLogin}>Continue with Google</button>
          <small className="auth-note">Local development accepts email accounts. Production starts with Google authentication.</small>
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
          <div><strong>{auth.user.display_name}</strong><small>{auth.user.email}</small></div>
          <button type="button" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      {error !== null && <div className="error-banner floating-error"><span>{error}</span><button onClick={() => setError(null)}>×</button></div>}

      {room === null ? (
        <section className="lobby-screen">
          <div className="lobby-card">
            <span className="eyebrow">AUTHORITATIVE MULTIPLAYER</span>
            <h1>Enter the table</h1>
            <p>Choose a fixed room size. The match begins automatically when every seat is filled.</p>
            <div className="player-count-picker">
              {[3, 4, 5, 6].map((count) => (
                <button key={count} className={desiredPlayers === count ? "is-active" : ""} onClick={() => setDesiredPlayers(count)}>
                  <strong>{count}</strong><span>players</span>
                </button>
              ))}
            </div>
            <button className="primary-button join-button" onClick={() => void joinRoom()}>Find a table</button>
          </div>
          <aside className="rules-glance">
            <h2>At a glance</h2>
            <ol><li><span>01</span>Draw and place your card in rank order.</li><li><span>02</span>Read the pattern in an opponent's rack.</li><li><span>03</span>Guess rank + color, or declare JOKER.</li><li><span>04</span>Be the last rack with a secret.</li></ol>
          </aside>
        </section>
      ) : (
        <div className="match-layout">
          <section className="match-toolbar">
            <div>
              <span className="eyebrow">ROOM {room.roomId}</span>
              <h1>{state?.status === "waiting" ? "Waiting for players" : "Cipher table"}</h1>
              <p>{state === null ? "Synchronizing state…" : `${state.connectedPlayers}/${state.desiredPlayers} players connected`}</p>
            </div>
            <div className="toolbar-actions">
              <button className="secondary-button" onClick={() => room.send("sync")}>Sync</button>
              <button className="danger-button" onClick={() => void room.leave(true)}>Leave room</button>
            </div>
          </section>

          {game !== null ? (
            <>
              <GameTable
                game={game}
                viewerId={auth.user.id}
                viewerName={auth.user.display_name}
                actionsEnabled={state?.status === "playing"}
                selectedTargetCardId={guess.targetCardId}
                selectedPenaltyCardId={guess.selfRevealCardId}
                onSelectTarget={(targetPlayerId, targetCardId) => setGuess((current) => ({ ...current, targetPlayerId, targetCardId }))}
                onSelectPenalty={(selfRevealCardId) => setGuess((current) => ({ ...current, selfRevealCardId }))}
                onInsert={(rackIndex) => room.send("insert", { rackIndex })}
              />

              <section className="control-dock">
                <div className="phase-instruction">
                  <span className="eyebrow">YOUR ACTION</span>
                  <strong>{!isMyTurn ? "Observe the table" : game.phase === "draw" ? "Draw a card" : game.phase === "insert" ? "Choose an insertion slot" : game.phase === "guess" ? "Select an opponent card" : "Match complete"}</strong>
                </div>
                <button className="draw-button" disabled={!canDraw} onClick={() => room.send("draw")}><span>◆</span> DRAW</button>
                <div className="guess-controls">
                  <span className="target-readout">{guess.targetCardId ? `Target ${guess.targetCardId.slice(0, 8)}` : "Select a face-down opponent card"}</span>
                  <select value={guess.kind} onChange={(event) => setGuess({ ...guess, kind: event.target.value as GuessForm["kind"] })}><option value="standard">Standard</option><option value="joker">Joker</option></select>
                  <select value={guess.rank} disabled={guess.kind === "joker"} onChange={(event) => setGuess({ ...guess, rank: event.target.value as Rank })}>{RANKS.map((rank) => <option key={rank}>{rank}</option>)}</select>
                  <select value={guess.color} disabled={guess.kind === "joker"} onChange={(event) => setGuess({ ...guess, color: event.target.value as CardColor })}><option value="red">Red</option><option value="black">Black</option></select>
                  <button className="guess-button" disabled={!canGuess} onClick={sendGuess}>LOCK GUESS</button>
                </div>
              </section>
            </>
          ) : (
            <div className="waiting-room">
              <div className="waiting-rune">◇</div>
              <h2>Seats are filling</h2>
              <p>The room starts at {state?.desiredPlayers ?? desiredPlayers} players.</p>
            </div>
          )}

          <details className="debug-panel">
            <summary>Viewer-safe JSON state</summary>
            <pre>{prettyState || "No state received."}</pre>
          </details>
        </div>
      )}
    </main>
  );
}

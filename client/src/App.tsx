import { useEffect, useRef, useState } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
  RANKS,
  type CardColor,
  type GuestDisplayNameUpdatedMessage,
  type GuessHistoryEntry,
  type Rank,
  type RoomSettings,
  type RoomSettingsAppliedMessage,
  type RoomErrorMessage,
  type StateEnvelope,
  type TableEmoteMessage,
} from "@ngame/shared";

import {
  clearGuestReconnectionToken,
  clearGuestSession,
  createGuestSession,
  guestReconnectionToken,
  logout,
  loadPlayerStats,
  loadLeaderboard,
  loadDailyPuzzle,
  guessDailyPuzzle,
  loadFriends,
  socialAction,
  refresh,
  restoreGuestSession,
  saveGuestDisplayName,
  saveGuestReconnectionToken,
  startGoogleLogin,
  updateProfile,
  type AuthResponse,
  type PlayerStats,
  type Leaderboard,
  type DailyPuzzle,
  type FriendItem,
} from "./auth.ts";
import { GameTable } from "./GameTable.tsx";
import { CardView } from "./CardView.tsx";
import { formatPlayerLabel, resolveTheme, type ThemeId } from "./uiState.ts";

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
  botDifficulty: "normal",
};

type SettingsSaveStatus = "synced" | "dirty" | "applying" | "approved";
type GuessAnnouncement = { entry: GuessHistoryEntry; phase: "guess" | "result" };
const THEME_OPTIONS: readonly { id: ThemeId; label: string }[] = [
  { id: "classic", label: "Classic Emerald" },
  { id: "ocean", label: "Deep Ocean" },
  { id: "cobalt", label: "Cobalt Noir" },
  { id: "arctic", label: "Arctic Night" },
];

function roomSettingsEqual(left: RoomSettings, right: RoomSettings): boolean {
  return (
    left.preset === right.preset &&
    left.turnSeconds === right.turnSeconds &&
    left.totalCards === right.totalCards &&
    left.drawRounds === right.drawRounds &&
    left.jokerCount === right.jokerCount
    && left.botDifficulty === right.botDifficulty
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

export function App() {
  const [language, setLanguage] = useState<"en" | "th">(() => localStorage.getItem("cipherdeck-language") === "th" ? "th" : "en");
  const tr = (english: string, thai: string): string => language === "th" ? thai : english;
  const [theme, setTheme] = useState<ThemeId>(() => {
    return resolveTheme(localStorage.getItem("cipherdeck-theme"));
  });
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestLoading, setGuestLoading] = useState(false);
  const [guestRoomName, setGuestRoomName] = useState("");
  const [guestNameRoomId, setGuestNameRoomId] = useState<string | null>(null);
  const [guestNameSaving, setGuestNameSaving] = useState(false);
  const [desiredPlayers, setDesiredPlayers] = useState(3);
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(window.location.search).get("room")?.replace(/\D/g, "").slice(0, 6) ?? "");
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<StateEnvelope | null>(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [guess, setGuess] = useState<GuessForm>(INITIAL_GUESS);
  const [selectedPenaltyCardId, setSelectedPenaltyCardId] = useState("");
  const [guessAnnouncement, setGuessAnnouncement] = useState<GuessAnnouncement | null>(null);
  const announcedGuessId = useRef(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [guessFeedOpen, setGuessFeedOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [notebookCardId, setNotebookCardId] = useState("");
  const [notebookExcluded, setNotebookExcluded] = useState<Record<string, readonly string[]>>({});
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem("cipherdeck-sound") !== "off");
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem("cipherdeck-reduced-motion") === "on");
  const [highContrast, setHighContrast] = useState(() => localStorage.getItem("cipherdeck-high-contrast") === "on");
  const [cardScale, setCardScale] = useState(() => {
    const stored = Number(localStorage.getItem("cipherdeck-card-scale") ?? 100);
    return Number.isFinite(stored) && stored >= 85 && stored <= 120 ? stored : 100;
  });
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [dailyPuzzle, setDailyPuzzle] = useState<DailyPuzzle | null>(null);
  const [dailyAttempts, setDailyAttempts] = useState<string[]>([]);
  const [dailySolved, setDailySolved] = useState(false);
  const [tableEmote, setTableEmote] = useState<TableEmoteMessage | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [friends, setFriends] = useState<readonly FriendItem[]>([]);
  const [friendUsername, setFriendUsername] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<RoomSettings>(INITIAL_SETTINGS);
  const [settingsRoomId, setSettingsRoomId] = useState<string | null>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<SettingsSaveStatus>("synced");
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const guestRestoreAttempted = useRef(false);
  const inviteJoinAttempted = useRef(false);
  const lastGuessSoundId = useRef(0);

  const playerLabel = (playerId: string | null | undefined): string => {
    return formatPlayerLabel(state?.players, playerId);
  };
  const game = state?.game ?? null;
  const otherPlayerGuesses = state?.guessHistory.filter((entry) => entry.actorPlayerId !== auth?.user.id) ?? [];
  const latestGuess = state?.guessHistory.at(-1);
  const notebookTargets = game?.players
    .filter((player) => player.id !== auth?.user.id && !player.eliminated)
    .flatMap((player) => player.rack.filter((card) => !card.revealed).map((card, index) => ({
      id: card.id,
      label: `${playerLabel(player.id)} · #${index + 1}`,
    }))) ?? [];
  const publicMisses = new Set((state?.deductionMisses.find((entry) => entry.targetCardId === notebookCardId)?.guesses ?? [])
    .map((miss) => miss.kind === "joker" ? "JOKER" : `${miss.rank}-${miss.color}`));
  const manualExclusions = new Set(notebookExcluded[notebookCardId] ?? []);
  const notebookCandidates = ["JOKER", ...RANKS.flatMap((rank) => [`${rank}-red`, `${rank}-black`])]
    .filter((candidate) => !publicMisses.has(candidate) && !manualExclusions.has(candidate));
  const roomPlayer = state?.players.find((player) => player.id === auth?.user.id);
  const normalizedGuestRoomName = guestRoomName.trim().replace(/\s+/gu, " ");
  const guestRoomNameChanged =
    normalizedGuestRoomName.length > 0 &&
    normalizedGuestRoomName !== roomPlayer?.displayName;
  const matchStatusLabel = state?.status === "waiting" ? tr("Lobby", "ห้องรอ") : state?.status === "starting" ? tr("Starting", "กำลังเริ่มเกม") : state?.status === "playing" ? tr("Playing", "กำลังเล่น") : state?.status === "paused" ? tr("Paused", "หยุดรอผู้เล่น") : state?.status === "finished" ? tr("Finished", "จบเกม") : null;
  const isMyTurn = game?.currentPlayerId === auth?.user.id;
  const canHostStart =
    roomPlayer?.isHost === true &&
    state?.players.filter((player) => !player.isHost).every((player) => player.ready) === true;
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
  const customDeckMinimum = Math.max(24, (state?.desiredPlayers ?? 2) * (settingsDraft.drawRounds + 2));
  const customDeckMaximum = 52 + settingsDraft.jokerCount;
  const customDeckValid = settingsDraft.preset !== "custom" || (
    settingsDraft.totalCards >= customDeckMinimum &&
    settingsDraft.totalCards <= customDeckMaximum
  );
  const visibleSettingsStatus = settingsSaveStatus === "applying"
    ? "applying"
    : settingsChanged
      ? "dirty"
      : settingsSaveStatus === "approved"
        ? "approved"
        : "synced";

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("cipherdeck-language", language);
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("cipherdeck-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
    document.documentElement.dataset.contrast = highContrast ? "high" : "normal";
    document.documentElement.style.setProperty("--card-scale", `${cardScale / 100}`);
    localStorage.setItem("cipherdeck-sound", soundEnabled ? "on" : "off");
    localStorage.setItem("cipherdeck-reduced-motion", reducedMotion ? "on" : "off");
    localStorage.setItem("cipherdeck-high-contrast", highContrast ? "on" : "off");
    localStorage.setItem("cipherdeck-card-scale", String(cardScale));
  }, [soundEnabled, reducedMotion, highContrast, cardScale]);

  useEffect(() => {
    const latest = latestGuess;
    if (!soundEnabled || latest === undefined || latest.id <= lastGuessSoundId.current) return;
    lastGuessSoundId.current = latest.id;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = latest.correct ? 660 : 180;
    gain.gain.setValueAtTime(0.05, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + 0.18);
    oscillator.addEventListener("ended", () => void context.close());
  }, [soundEnabled, state?.guessHistory]);

  useEffect(() => {
    const latest = state?.guessHistory.at(-1);
    if (latest === undefined || latest.id <= announcedGuessId.current) return;
    announcedGuessId.current = latest.id;
    setGuessAnnouncement({ entry: latest, phase: "guess" });
    const revealResult = window.setTimeout(() => {
      setGuessAnnouncement((current) => current?.entry.id === latest.id ? { entry: latest, phase: "result" } : current);
    }, 700);
    const dismiss = window.setTimeout(() => {
      setGuessAnnouncement((current) => current?.entry.id === latest.id ? null : current);
    }, 2_050);
    return () => {
      window.clearTimeout(revealResult);
      window.clearTimeout(dismiss);
    };
  }, [latestGuess?.id]);

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
    if (auth === null || room !== null || inviteJoinAttempted.current || !/^\d{6}$/.test(roomCode)) return;
    if (new URLSearchParams(window.location.search).get("room") === null) return;
    inviteJoinAttempted.current = true;
    void joinRoom("join-code");
  }, [auth, room, roomCode]);

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
    if ((state?.turnDeadlineMs === null || state?.turnDeadlineMs === undefined) && state?.reconnectDeadlineMs === null) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state?.turnDeadlineMs, state?.reconnectDeadlineMs]);

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
      if (lastStatus === null) {
        const latestGuessId = message.guessHistory.at(-1)?.id ?? 0;
        announcedGuessId.current = latestGuessId;
        lastGuessSoundId.current = latestGuessId;
      }
      lastStatus = message.status;
      setServerClockOffsetMs(message.serverTimeMs - Date.now());
      setState(message);
      if (session.user.account_type === "guest" && message.status === "finished") {
        clearGuestSession();
      }
    });
    joined.onMessage("emote", (message: TableEmoteMessage) => {
      setTableEmote(message);
      window.setTimeout(() => setTableEmote((current) => current?.sentAtMs === message.sentAtMs ? null : current), 3_000);
    });
    joined.onMessage("error", (message: RoomErrorMessage) => {
      setError(message.code === "INVALID_DECK"
        ? tr(
            "These Custom settings cannot make a playable deck. Use 24–56 total cards and 2–4 Jokers. Total cards cannot exceed 52 + Jokers (54 with 2, 55 with 3, or 56 with 4). If needed, add cards or reduce Draw rounds so every player can receive at least 2 starting cards after the draw reserve.",
            "ค่า Custom ชุดนี้สร้างสำรับที่เล่นไม่ได้ ใช้ไพ่รวม 24–56 ใบและ Joker 2–4 ใบ โดยไพ่รวมต้องไม่เกิน 52 + จำนวน Joker (Joker 2 ใบใช้ได้สูงสุด 54, 3 ใบสูงสุด 55, 4 ใบสูงสุด 56) หากยังบันทึกไม่ได้ ให้เพิ่มไพ่รวมหรือลดรอบจั่ว เพื่อให้เหลือไพ่เริ่มต้นอย่างน้อยคนละ 2 ใบหลังกันไพ่สำหรับจั่ว",
          )
        : message.message);
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

  async function joinRoom(mode: "public" | "code" | "join-code" | "spectate-code" = "public"): Promise<void> {
    if (auth === null) return;
    const normalizedCode = roomCode.trim();
    if ((mode === "join-code" || mode === "spectate-code") && !/^\d{6}$/.test(normalizedCode)) {
      setError(tr("Enter a six-digit room code.", "กรอกรหัสห้อง 6 หลัก"));
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
      if (mode === "public") {
        joined = await client.joinOrCreate("cipher_deck", { desiredPlayers, lobbyMode: "public" });
      } else if (mode === "code") {
        joined = await client.create("cipher_deck", { desiredPlayers, lobbyMode: "code" });
      } else {
        const spectating = mode === "spectate-code";
        const response = await fetch(`${REALTIME_URL.replace(/^ws/, "http").replace(/\/$/, "")}/rooms/by-code/${normalizedCode}${spectating ? "?spectator=1" : ""}`);
        const lookup = await response.json() as { roomId?: string; detail?: string };
        if (!response.ok || lookup.roomId === undefined) throw new Error(lookup.detail ?? "Room not found.");
        joined = await client.joinById(lookup.roomId, spectating ? { spectator: true } : {});
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
    void loadPlayerStats(auth.access_token).then(setPlayerStats).catch(() => setPlayerStats(null));
  }

  function openLeaderboard(): void {
    if (auth === null || auth.user.account_type === "guest") return;
    setLeaderboardOpen(true);
    setLeaderboard(null);
    void loadLeaderboard(auth.access_token).then(setLeaderboard).catch((caught) => setError(errorText(caught)));
  }

  function openDaily(): void {
    setDailyOpen(true);
    setDailyPuzzle(null);
    void loadDailyPuzzle().then((puzzle) => {
      setDailyPuzzle(puzzle);
      try {
        const stored = JSON.parse(localStorage.getItem(`cipherdeck-daily-${puzzle.puzzle_id}`) ?? "[]") as unknown;
        setDailyAttempts(Array.isArray(stored) && stored.every((entry) => typeof entry === "string") ? stored : []);
      } catch {
        setDailyAttempts([]);
      }
      setDailySolved(localStorage.getItem(`cipherdeck-daily-solved-${puzzle.puzzle_id}`) === "yes");
    }).catch((caught) => setError(errorText(caught)));
  }

  async function submitDaily(candidate: string): Promise<void> {
    if (dailyPuzzle === null || dailySolved || dailyAttempts.includes(candidate)) return;
    const correct = await guessDailyPuzzle(candidate);
    const attempts = [...dailyAttempts, candidate];
    setDailyAttempts(attempts);
    localStorage.setItem(`cipherdeck-daily-${dailyPuzzle.puzzle_id}`, JSON.stringify(attempts));
    if (correct) {
      setDailySolved(true);
      localStorage.setItem(`cipherdeck-daily-solved-${dailyPuzzle.puzzle_id}`, "yes");
    }
  }

  function refreshFriends(): void {
    if (auth === null || auth.user.account_type === "guest") return;
    void loadFriends(auth.access_token).then(setFriends).catch((caught) => setError(errorText(caught)));
  }

  function openFriends(): void {
    setFriendsOpen(true);
    refreshFriends();
  }

  async function runSocialAction(path: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<void> {
    if (auth === null) return;
    try {
      await socialAction(auth.access_token, path, method, body);
      setFriendUsername("");
      refreshFriends();
    } catch (caught) { setError(errorText(caught)); }
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

  async function shareMatchResult(): Promise<void> {
    if (state?.matchResult === null || state?.matchResult === undefined) return;
    const ownStats = state.matchResult.stats.find((stats) => stats.playerId === auth?.user.id);
    const text = `CipherDeck ${state.matchResult.winnerPlayerId === auth?.user.id ? "WIN" : "MATCH"} · ${ownStats?.correctGuesses ?? 0}/${ownStats?.guesses ?? 0} correct · ${ownStats?.cardsRevealed ?? 0} cards revealed`;
    try {
      if (navigator.share !== undefined) {
        await navigator.share({ title: "CipherDeck", text, url: window.location.origin });
      } else {
        await navigator.clipboard.writeText(`${text}\n${window.location.origin}`);
        setError(tr("Result copied to clipboard.", "คัดลอกผลการแข่งขันแล้ว"));
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError(errorText(shareError));
    }
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
        <p>{tr("Preparing the game…", "กำลังเตรียมเกม…")}</p>
      </main>
    );
  }

  if (auth === null) {
    return (
      <main className="auth-screen">
        <div className="appearance-controls appearance-controls-auth">
          <label className="theme-picker"><select aria-label={tr("Theme", "ธีม")} value={theme} onChange={(event) => setTheme(event.target.value as ThemeId)}>{THEME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <button type="button" className="language-switch" onClick={() => setLanguage(language === "en" ? "th" : "en")} aria-label="Change language">{language === "en" ? "ไทย" : "EN"}</button>
        </div>
        <section className="auth-panel">
          <header className="brand-lockup">
            <h1>CIPHER<span>DECK</span></h1>
          </header>
          {error !== null && <p className="error-banner">{error}</p>}
          <button className="google-button" onClick={startGoogleLogin}>
            {tr("Continue with Google", "เล่นด้วยบัญชี Google")}
          </button>
          <div className="auth-divider"><span>{tr("or play as a guest", "หรือทดลองเล่นแบบ Guest")}</span></div>
          <form
            className="guest-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void continueAsGuest();
            }}
          >
            <label htmlFor="guest-display-name">{tr("Display name", "ชื่อที่ใช้ในเกม")}</label>
            <div>
              <input
                id="guest-display-name"
                maxLength={32}
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder={tr("Leave blank for a random name", "เว้นว่างเพื่อสุ่มชื่อให้")}
                autoComplete="nickname"
              />
              <button className="guest-button" type="submit" disabled={guestLoading}>
                {guestLoading ? tr("Joining…", "กำลังเข้าเกม…") : tr("Play as Guest", "เล่นแบบ Guest")}
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <div className="orientation-hint" role="status"><span>↻</span><strong>{tr("Rotate your phone", "หมุนมือถือเป็นแนวนอน")}</strong><small>{tr("CipherDeck is designed for landscape play.", "CipherDeck ออกแบบให้เล่นในแนวนอน")}</small></div>
      <header className="topbar">
        <div className="mini-brand"><span>◇</span><strong>CIPHERDECK</strong></div>
        <div className="topbar-account">
          <label className="theme-picker theme-picker-topbar"><select aria-label={tr("Theme", "ธีม")} value={theme} onChange={(event) => setTheme(event.target.value as ThemeId)}>{THEME_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <button type="button" className="language-switch" onClick={() => setLanguage(language === "en" ? "th" : "en")} aria-label="Change language">{language === "en" ? "ไทย" : "EN"}</button>
          <button type="button" className="language-switch menu-button" onClick={() => setUtilityOpen(true)}>{tr("Menu", "เมนู")}</button>
          <div className="profile-chip">
            <span>{auth.user.display_name.slice(0, 1).toUpperCase()}</span>
            <strong>{auth.user.display_name}</strong>
            {auth.user.account_type === "registered" && <button type="button" onClick={openProfile}>{tr("Profile", "โปรไฟล์")}</button>}
            <button type="button" aria-label={tr("Sign out", "ออกจากระบบ")} title={tr("Sign out", "ออกจากระบบ")} onClick={() => void signOut()}>↗</button>
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
                <span className="eyebrow">{tr("COMPLETE RULES", "กฎฉบับอ่านจบแล้วเล่นได้")}</span>
                <h2 id="rules-title">{tr("How to play CipherDeck", "วิธีเล่น CipherDeck")}</h2>
              </div>
              <button
                type="button"
                className="modal-close-button"
                aria-label={tr("Close rules", "ปิดวิธีการเล่น")}
                onClick={() => setRulesOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="rules-flow" aria-label={tr("Turn sequence", "ลำดับการเล่นในหนึ่งเทิร์น")}>
              <span>{tr("1. Draw", "1. จั่วไพ่")}</span>
              <b>→</b>
              <span>{tr("2. Guess an opponent card", "2. เดาไพ่คู่แข่ง")}</span>
              <b>→</b>
              <span>{tr("3. Continue or end the turn", "3. เดาต่อหรือจบเทิร์น")}</span>
            </div>

            <div className="rules-grid">
              <article className="rule-step">
                <span className="rule-number">01</span>
                <div>
                  <h3>{tr("Objective", "เป้าหมายของเกม")}</h3>
                  <p>{tr("Reveal every hidden opponent card. A fully revealed rack is eliminated; the last active player wins.", "เปิดไพ่คว่ำของคู่แข่งให้หมด ผู้เล่นที่ไพ่ถูกเปิดครบจะแพ้ ผู้เล่นคนสุดท้ายที่ยังเหลือไพ่คว่ำเป็นผู้ชนะ")}</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">02</span>
                <div>
                  <h3>{tr("Starting player", "ก่อนเริ่มเกม")}</h3>
                  <p>{tr("Everyone selects one card. Highest rank starts; Joker beats K. Only tied players redraw.", "เลือกไพ่คนละ 1 ใบ ไพ่สูงสุดเริ่มก่อน โดย Joker สูงกว่า K หากเสมอ เฉพาะคนที่เสมอจะเลือกใหม่")}</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">03</span>
                <div>
                  <h3>{tr("Draw, then guess", "จั่วแล้วต้องเดา")}</h3>
                  <p>{tr("Draw one card, then guess a hidden opponent card's rank and color. A Joker guess has no color.", "กดจั่ว 1 ใบ แล้วเลือกไพ่คว่ำของคู่แข่งเพื่อเดาหน้าไพ่และสี หากคิดว่าเป็น Joker ให้เลือก Joker โดยไม่ต้องเลือกสี")}</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">04</span>
                <div>
                  <h3>{tr("Correct guess", "เมื่อเดาถูก")}</h3>
                  <p>{tr("Reveal the target, then guess again or stop and place your drawn card face-down in a legal slot.", "ไพ่เป้าหมายถูกเปิด คุณเลือกเสี่ยงเดาต่อได้ หรือจบเทิร์นแล้ววางไพ่ที่จั่วมาแบบคว่ำในช่องที่ระบบอนุญาต")}</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">05</span>
                <div>
                  <h3>{tr("Wrong guess", "เมื่อเดาผิด")}</h3>
                  <p>{tr("Reveal and place your drawn card. If the draw pile is empty, reveal one of your own hidden cards instead.", "ไพ่ที่จั่วมาจะถูกเปิด และต้องวางในช่องที่ถูกต้องทันที หากกองจั่วหมด ให้เลือกเปิดไพ่คว่ำของตัวเอง 1 ใบแทน")}</p>
                </div>
              </article>
              <article className="rule-step">
                <span className="rule-number">06</span>
                <div>
                  <h3>{tr("Rack order", "วิธีเรียงไพ่")}</h3>
                  <p>{tr("Order A → K, red before black at equal ranks. Suits do not matter; Jokers may use any + slot.", "เรียง A → K เมื่อหน้าเท่ากัน สีแดงอยู่ก่อนสีดำ ไม่แยกดอก ส่วน Joker วางช่องใดก็ได้ที่มีเครื่องหมาย +")}</p>
                </div>
              </article>
            </div>

            <p className="rules-note">
              <strong>{tr("TIME LIMIT:", "สำคัญ:")}</strong> {tr("The timer resets after every successful action. The final 10 seconds show a warning. If time expires, your rack is revealed and you are eliminated.", "ทุกครั้งที่เกมรอให้คุณตัดสินใจ เวลาจะเริ่มนับใหม่ ช่วง 10 วินาทีสุดท้ายจะแสดงคำเตือน หากหมดเวลา ไพ่ทั้งมือจะถูกเปิดและคุณแพ้ทันที")}
            </p>
          </section>
        </div>
      )}

      {friendsOpen && <div className="modal-backdrop" onMouseDown={() => setFriendsOpen(false)}><section className="friends-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">SOCIAL</span><h2>{tr("Friends & party", "เพื่อนและปาร์ตี้")}</h2></div><button className="modal-close-button" onClick={() => setFriendsOpen(false)}>×</button></header><form onSubmit={(event) => { event.preventDefault(); void runSocialAction("/friends", "POST", { username: friendUsername }); }}><input required minLength={3} maxLength={20} placeholder={tr("Username", "ชื่อผู้ใช้")} value={friendUsername} onChange={(event) => setFriendUsername(event.target.value)} /><button className="primary-button">{tr("Add friend", "เพิ่มเพื่อน")}</button><button type="button" className="danger-button" onClick={() => void runSocialAction("/block", "POST", { username: friendUsername })}>{tr("Block", "บล็อก")}</button></form><div className="friends-list">{friends.length === 0 && <p>{tr("No friends or requests yet.", "ยังไม่มีเพื่อนหรือคำขอ")}</p>}{friends.map((friend) => <article key={friend.connection_id}><span><strong>{friend.display_name}</strong><small>@{friend.username ?? "player"} · {friend.status}</small></span>{friend.status === "incoming" && <button onClick={() => void runSocialAction(`/friends/${friend.connection_id}/accept`, "PATCH")}>{tr("Accept", "รับ")}</button>}{friend.status === "friend" && state?.roomCode !== null && state?.roomCode !== undefined && <button onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${state.roomCode}`)}>{tr("Copy party invite", "คัดลอกคำเชิญปาร์ตี้")}</button>}<button className="is-danger" onClick={() => void runSocialAction(`/friends/${friend.connection_id}`, "DELETE")}>{friend.status === "blocked" ? tr("Unblock", "เลิกบล็อก") : tr("Remove", "นำออก")}</button></article>)}</div></section></div>}

      {dailyOpen && <div className="modal-backdrop" onMouseDown={() => setDailyOpen(false)}><section className="daily-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close-button" onClick={() => setDailyOpen(false)}>×</button><span className="eyebrow">DAILY CIPHER · {dailyPuzzle?.puzzle_id}</span><h2>{dailySolved ? tr("Cipher solved!", "ไขรหัสสำเร็จ!") : tr("Find the hidden card", "หาไพ่ที่ซ่อนอยู่")}</h2>{dailyPuzzle === null ? <p>{tr("Loading today’s cipher…", "กำลังโหลดโจทย์วันนี้…")}</p> : <><div className="daily-clue"><span>{dailyPuzzle.lower_rank}</span><strong>?</strong><span>{dailyPuzzle.upper_rank}</span></div><p>{tr("The rack is sorted. Choose the exact rank and color; each candidate can be tried once.", "ไพ่เรียงตามลำดับ เลือกหน้าไพ่และสีให้ถูก แต่ละตัวเลือกลองได้ครั้งเดียว")}</p><div className="daily-candidates">{dailyPuzzle.candidates.map((candidate) => <button key={candidate} disabled={dailySolved || dailyAttempts.includes(candidate)} onClick={() => void submitDaily(candidate)}>{candidate.replace("-red", " ♥").replace("-black", " ♠")}</button>)}</div><small>{tr(`${dailyAttempts.length} attempt(s)`, `ลองแล้ว ${dailyAttempts.length} ครั้ง`)}</small></>}</section></div>}

      {leaderboardOpen && <div className="modal-backdrop" onMouseDown={() => setLeaderboardOpen(false)}><section className="leaderboard-modal" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">RANKED SEASON</span><h2>{tr("Leaderboard", "ตารางอันดับ")}</h2><p>{leaderboard === null ? tr("Loading…", "กำลังโหลด…") : tr(`Season ${leaderboard.season}`, `ซีซัน ${leaderboard.season}`)}</p></div><button className="modal-close-button" onClick={() => setLeaderboardOpen(false)}>×</button></header><div className="leaderboard-table">{leaderboard?.entries.length === 0 && <p>{tr("No ranked results this season yet.", "ซีซันนี้ยังไม่มีผลการแข่งขัน")}</p>}{leaderboard?.entries.map((entry) => <article key={entry.user_id} className={entry.user_id === auth.user.id ? "is-me" : ""}><strong>#{entry.rank}</strong><span>{entry.display_name}<small>{entry.wins}W · {entry.games - entry.wins}L</small></span><b>{entry.rating}</b></article>)}</div></section></div>}

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
            <section className="profile-stats"><article><strong>{playerStats?.games ?? "—"}</strong><span>{tr("Games", "เกม")}</span></article><article><strong>{playerStats === null || playerStats.games === 0 ? "—" : `${Math.round(playerStats.wins / playerStats.games * 100)}%`}</strong><span>{tr("Win rate", "อัตราชนะ")}</span></article><article><strong>{playerStats === null || playerStats.guesses === 0 ? "—" : `${Math.round(playerStats.correct_guesses / playerStats.guesses * 100)}%`}</strong><span>{tr("Accuracy", "ความแม่นยำ")}</span></article><article><strong>{playerStats?.current_streak ?? "—"}</strong><span>{tr("Win streak", "ชนะต่อเนื่อง")}</span></article></section>
            {playerStats !== null && <div className="achievement-list"><strong>{tr("Achievements", "ความสำเร็จ")}</strong>{playerStats.achievements.length === 0 ? <small>{tr("Play a match to unlock your first badge.", "เล่นให้จบหนึ่งเกมเพื่อปลดล็อกเหรียญแรก")}</small> : playerStats.achievements.map((achievement) => <span key={achievement}>◇ {achievement.replaceAll("-", " ")}</span>)}</div>}
            {playerStats !== null && playerStats.recent_matches.length > 0 && <div className="recent-matches"><strong>{tr("Recent matches", "เกมล่าสุด")}</strong>{playerStats.recent_matches.slice(0, 5).map((match) => <span key={match.match_id} className={match.won ? "is-win" : "is-loss"}>{match.won ? tr("WIN", "ชนะ") : tr("LOSS", "แพ้")} · {match.correct_guesses}/{match.guesses}</span>)}</div>}
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
      {tableEmote !== null && <div className="table-emote-toast"><strong>{playerLabel(tableEmote.actorPlayerId)}</strong><span>{tableEmote.emote === "thinking" ? "Hmm…" : tableEmote.emote === "nice" ? tr("Nice!", "เยี่ยม!") : tableEmote.emote === "oops" ? tr("Oops", "พลาดแล้ว") : "GG"}</span></div>}
      {guessAnnouncement !== null && (
        <div className={`guess-announcer is-${guessAnnouncement.phase} ${guessAnnouncement.entry.correct ? "is-correct" : "is-wrong"}`} role="status" aria-live="assertive">
          <span>{guessAnnouncement.phase === "guess" ? tr("CALLING", "ประกาศคำตอบ") : tr("RESULT", "ผลการเดา")}</span>
          {guessAnnouncement.phase === "guess" ? (
            <>
              <strong>{playerLabel(guessAnnouncement.entry.actorPlayerId)}</strong>
              <p>{tr("calls", "เดาไพ่ของ")} {playerLabel(guessAnnouncement.entry.targetPlayerId)}</p>
              <b>{guessAnnouncement.entry.guess.kind === "joker" ? "JOKER" : `${guessAnnouncement.entry.guess.rank} · ${guessAnnouncement.entry.guess.color === "red" ? tr("RED", "แดง") : tr("BLACK", "ดำ")}`}</b>
            </>
          ) : (
            <>
              <strong>{guessAnnouncement.entry.correct ? tr("CORRECT!", "ถูก!") : tr("WRONG!", "ผิด!")}</strong>
              <p>{guessAnnouncement.entry.correct ? tr("The card is revealed", "เปิดไพ่เป้าหมาย") : tr("The card stays hidden", "ไพ่เป้าหมายยังคว่ำอยู่")}</p>
            </>
          )}
        </div>
      )}

      {utilityOpen && <div className="modal-backdrop" onMouseDown={() => setUtilityOpen(false)}><section className="utility-modal" onMouseDown={(event) => event.stopPropagation()}><header><h2>{tr("Menu", "เมนู")}</h2><button className="modal-close-button" onClick={() => setUtilityOpen(false)}>×</button></header><div className="utility-grid"><button onClick={() => { setUtilityOpen(false); setRulesOpen(true); }}>{tr("How to play", "วิธีเล่น")}</button><button onClick={() => { setUtilityOpen(false); setTutorialStep(0); }}>{tr("Tutorial", "สอนเล่น")}</button><button onClick={() => { setUtilityOpen(false); setPreferencesOpen(true); }}>{tr("Settings", "ตั้งค่า")}</button><button onClick={() => { setUtilityOpen(false); void openDaily(); }}>{tr("Daily Cipher", "โจทย์รายวัน")}</button>{auth.user.account_type === "registered" && <button onClick={() => { setUtilityOpen(false); void openLeaderboard(); }}>{tr("Leaderboard", "อันดับ")}</button>}{auth.user.account_type === "registered" && <button onClick={() => { setUtilityOpen(false); void openFriends(); }}>{tr("Friends", "เพื่อน")}</button>}</div></section></div>}

      {preferencesOpen && <div className="modal-backdrop" onMouseDown={() => setPreferencesOpen(false)}><section className="preference-modal" onMouseDown={(event) => event.stopPropagation()}><header><h2>{tr("Settings", "ตั้งค่า")}</h2><button className="modal-close-button" onClick={() => setPreferencesOpen(false)}>×</button></header><label><span>{tr("Sound", "เสียง")}</span><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} /></label><label><span>{tr("Reduce motion", "ลดการเคลื่อนไหว")}</span><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /></label><label><span>{tr("High contrast", "เพิ่มความคมชัด")}</span><input type="checkbox" checked={highContrast} onChange={(event) => setHighContrast(event.target.checked)} /></label><label className="range-setting"><span>{tr(`Card size · ${cardScale}%`, `ขนาดไพ่ · ${cardScale}%`)}</span><input type="range" min={85} max={120} step={5} value={cardScale} onChange={(event) => setCardScale(Number(event.target.value))} /></label></section></div>}

      {tutorialStep !== null && <div className="tutorial-overlay"><section><span className="tutorial-progress">{tutorialStep + 1}/5</span><span className="eyebrow">{tr("GUIDED TUTORIAL", "บทเรียนแบบแนะนำ")}</span><h2>{[tr("Draw one card", "จั่วไพ่ 1 ใบ"), tr("Choose an opponent card", "เลือกไพ่ของคู่แข่ง"), tr("Guess rank and color", "เดาหน้าไพ่และสี"), tr("Correct: continue or stop", "เดาถูก: เดาต่อหรือหยุด"), tr("Place in a legal + slot", "วางในช่อง + ที่ถูกต้อง")][tutorialStep]}</h2><p>{[tr("Every turn begins by drawing. The card stays outside your rack until the turn resolves.", "ทุกเทิร์นเริ่มด้วยการจั่ว ไพ่จะอยู่นอกมือจนกว่าเทิร์นจะจบ"), tr("Only hidden cards belonging to active opponents can be targeted.", "เลือกได้เฉพาะไพ่คว่ำของคู่แข่งที่ยังเล่นอยู่"), tr("Standard cards need rank and red/black. Joker needs no color.", "ไพ่ปกติต้องเดาหน้าและสี ส่วน Joker ไม่ต้องเลือกสี"), tr("A correct guess reveals the target. Risk another guess or safely stop.", "เดาถูกจะเปิดไพ่เป้าหมาย จากนั้นเสี่ยงเดาต่อหรือหยุดอย่างปลอดภัย"), tr("The server shows only legal positions. Choose + to finish the turn.", "เซิร์ฟเวอร์แสดงเฉพาะตำแหน่งที่ถูกต้อง เลือก + เพื่อจบเทิร์น")][tutorialStep]}</p><div className="tutorial-demo"><span className="mini-card">?</span><b>→</b><span className="mini-card is-accent">{tutorialStep === 2 ? "Q♠" : "+"}</span></div><div className="modal-actions"><button className="secondary-button" disabled={tutorialStep === 0} onClick={() => setTutorialStep(Math.max(0, tutorialStep - 1))}>{tr("Back", "ย้อนกลับ")}</button><button className="primary-button" onClick={() => tutorialStep === 4 ? setTutorialStep(null) : setTutorialStep(tutorialStep + 1)}>{tutorialStep === 4 ? tr("Start playing", "เริ่มเล่น") : tr("Next", "ถัดไป")}</button></div></section></div>}

      {state?.status === "paused" && <div className="reconnect-overlay"><span className="cipher-mark">◇</span><h2>{tr("Match paused", "หยุดเกมชั่วคราว")}</h2><p>{tr(`${state.droppedPlayerIds.map(playerLabel).join(", ")} disconnected. Waiting for reconnection.`, `${state.droppedPlayerIds.map(playerLabel).join(", ")} หลุดจากเกม กำลังรอเชื่อมต่อใหม่`)}</p><strong>{state.reconnectDeadlineMs === null ? "—" : Math.max(0, Math.ceil((state.reconnectDeadlineMs - (clockNow + serverClockOffsetMs)) / 1000))}s</strong></div>}

      {room === null ? (
        <section className="lobby-screen">
          <div className="lobby-card">
            <h1>{tr("Play", "เริ่มเล่น")}</h1>
            <label className="picker-label">{tr("Total players", "จำนวนผู้เล่นทั้งหมด")}</label>
            <div className="player-count-picker">
              {[3, 4, 5, 6].map((count) => (
                <button key={count} className={desiredPlayers === count ? "is-active" : ""} onClick={() => setDesiredPlayers(count)}>
                  <strong>{count}</strong><span>{tr("players", "คน")}</span>
                </button>
              ))}
            </div>
            <div className="lobby-actions">
              <button className="primary-button create-room-button" disabled={connectionStatus === "connecting"} onClick={() => void joinRoom("public")}>{connectionStatus === "connecting" ? tr("Please wait…", "รอสักครู่…") : tr(`Quick play · ${desiredPlayers}`, `เล่นด่วน · ${desiredPlayers} คน`)}</button>
              <button className="secondary-button" disabled={connectionStatus === "connecting"} onClick={() => void joinRoom("code")}>{tr("Create private room", "สร้างห้องส่วนตัว")}</button>
            </div>
            <form className="room-code-join" onSubmit={(event) => { event.preventDefault(); void joinRoom("join-code"); }}>
              <label htmlFor="room-code">{tr("Join a private room", "เข้าห้องส่วนตัว")}</label>
              <div><input id="room-code" inputMode="numeric" maxLength={6} placeholder="000000" value={roomCode} onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /><button type="submit" className="secondary-button">{tr("Join", "เข้าห้อง")}</button><button type="button" className="secondary-button" onClick={() => void joinRoom("spectate-code")}>{tr("Watch", "รับชม")}</button></div>
            </form>
          </div>
        </section>
      ) : (
        <div className="match-layout">
          <section className="match-toolbar">
            <div>
              <span className="eyebrow">{state?.status === "waiting" ? tr("GAME LOBBY", "ห้องเตรียมเกม") : tr("CIPHERDECK TABLE", "โต๊ะ CipherDeck")}</span>
              <h1>{state?.status === "waiting" ? tr("Get ready", "เตรียมตัวให้พร้อม") : matchStatusLabel}</h1>
              <p>{state === null ? tr("Loading…", "กำลังโหลด…") : tr(`${state.connectedPlayers}/${state.desiredPlayers} players`, `${state.connectedPlayers}/${state.desiredPlayers} คน`)}</p>
              {state?.roomCode !== null && state?.roomCode !== undefined && <div className="room-code-display"><span>{tr("ROOM CODE", "รหัสห้อง")}</span><strong>{state.roomCode}</strong><button type="button" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?room=${state.roomCode}`)}>{tr("Copy invite link", "คัดลอกลิงก์ชวน")}</button></div>}
            </div>
            <div className="toolbar-actions">
              <button className="danger-button" onClick={() => void room.leave(true)}>{tr("Leave room", "ออกจากห้อง")}</button>
            </div>
          </section>

          {game !== null ? (
            <>
              <GameTable
                language={language}
                game={game}
                viewerId={auth.user.id}
                viewerName={roomPlayer?.displayName ?? auth.user.display_name}
                viewerAccountType={auth.user.account_type}
                playerNames={Object.fromEntries((state?.players ?? []).map((player) => [player.id, player.displayName]))}
                playerAccountTypes={Object.fromEntries((state?.players ?? []).map((player) => [player.id, player.accountType]))}
                actionsEnabled={state?.isSpectator !== true && (state?.status === "playing" || state?.status === "starting")}
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

              {state?.isSpectator === true && <div className="spectator-banner">◉ {tr("Spectator mode · hidden cards stay private", "โหมดผู้ชม · ไพ่คว่ำยังคงเป็นความลับ")}</div>}

              <section className="control-dock">
                <div className="phase-instruction">
                  <span className="eyebrow">{tr("YOUR NEXT ACTION", "สิ่งที่ต้องทำตอนนี้")}</span>
                  <strong>{game.phase === "starter-place" ? (game.pendingStartingJokerCardIds.length > 0 ? tr(`Choose a + slot for your Joker · ${game.pendingStartingJokerCardIds.length} left`, `เลือกช่อง + เพื่อวาง Joker · เหลือ ${game.pendingStartingJokerCardIds.length} ใบ`) : tr("Waiting for other players to place Jokers", "รอผู้เล่นคนอื่นวาง Joker")) : !isMyTurn ? tr(`Waiting for ${playerLabel(game.currentPlayerId)}`, `รอ ${playerLabel(game.currentPlayerId)} เล่น`) : game.phase === "draw" ? tr("Draw a card to begin your turn", "กดจั่วไพ่เพื่อเริ่มเทิร์น") : game.phase === "place" ? tr("Choose a + slot to place your card face-down", "เลือกช่อง + เพื่อวางไพ่แบบคว่ำ") : game.phase === "penalty-place" ? tr("Wrong guess — place the revealed card in a + slot", "เดาผิด — เลือกช่อง + เพื่อวางไพ่ที่เปิดแล้ว") : game.phase === "self-penalty" ? tr("Choose one of your hidden cards to reveal", "เลือกไพ่คว่ำของคุณ 1 ใบเพื่อรับโทษ") : game.phase === "guess" && game.correctGuessesThisTurn > 0 ? tr("Correct! Guess again, or stop and place", "เดาถูก! เดาต่อ หรือจบเทิร์นแล้ววางไพ่") : game.phase === "guess" ? tr("Choose a hidden opponent card to guess", "เลือกไพ่คว่ำของคู่แข่งเพื่อเดา") : tr("Match complete", "เกมจบแล้ว")}</strong>
                </div>
                <div className="turn-actions">
                  <button className="draw-button" disabled={!canDraw} onClick={() => room.send("draw")}><span>◆</span> {tr("DRAW", "จั่วไพ่")}</button>
                  <button className="stop-button" disabled={!canStopAndPlace} onClick={() => room.send("stop")}>{tr("STOP & PLACE", "จบการเดาและวางไพ่")}</button>
                  <button className="penalty-button" disabled={!canRevealPenalty} onClick={() => {
                    room.send("self-penalty", { cardId: selectedPenaltyCardId });
                    setSelectedPenaltyCardId("");
                  }}>{tr("REVEAL SELECTED", "เปิดไพ่ที่เลือก")}</button>
                </div>
                <p className="target-readout">{guess.targetCardId ? tr("Choose a rank and color beside the selected card", "เลือกหน้าไพ่และสีในกล่องข้างไพ่ที่เลือก") : isMyTurn && game.phase === "guess" ? tr("Tap a hidden opponent card to make a guess", "แตะไพ่คว่ำของคู่แข่งเพื่อเริ่มเดา") : tr("You will be prompted when it is your turn", "ระบบจะแจ้งเมื่อถึงตาคุณ")}</p>
              </section>
              <div className="emote-bar" aria-label={tr("Table emotes", "อีโมตบนโต๊ะ")}>{(["thinking", "nice", "oops", "good-game"] as const).map((emote) => <button key={emote} type="button" onClick={() => room.send("emote", { emote })}>{emote === "thinking" ? "Hmm…" : emote === "nice" ? tr("Nice!", "เยี่ยม!") : emote === "oops" ? tr("Oops", "พลาดแล้ว") : "GG"}</button>)}</div>
              <section className={`guess-feed ${guessFeedOpen ? "is-open" : ""}`}>
                <button type="button" className="guess-feed-toggle" onClick={() => setGuessFeedOpen((open) => !open)} aria-expanded={guessFeedOpen}>
                  <span>{tr("Other players' guesses", "ผู้เล่นคนอื่นเดาอะไร")}</span>
                  <em>{otherPlayerGuesses.length}</em>
                  <b>{guessFeedOpen ? "−" : "+"}</b>
                </button>
                {guessFeedOpen && (
                  <div className="guess-feed-list" aria-live="polite">
                    {otherPlayerGuesses.length === 0 ? (
                      <p>{tr("No guesses yet. The latest guesses will appear here.", "ยังไม่มีการเดา รายการล่าสุดจะแสดงที่นี่")}</p>
                    ) : [...otherPlayerGuesses].reverse().map((entry) => (
                      <article key={entry.id} className={entry.correct ? "is-correct" : "is-wrong"}>
                        <span>{entry.correct ? "✓" : "×"}</span>
                        <div>
                          <strong>{playerLabel(entry.actorPlayerId)}</strong>
                          <p>{tr("guessed", "เดาไพ่ของ")} {playerLabel(entry.targetPlayerId)} · {entry.guess.kind === "joker" ? "JOKER" : `${entry.guess.rank} ${language === "th" ? (entry.guess.color === "red" ? "สีแดง" : "สีดำ") : entry.guess.color}`}</p>
                        </div>
                        <em>{entry.correct ? tr("Correct", "ถูก") : tr("Wrong", "ผิด")}</em>
                      </article>
                    ))}
                    {(state?.eventLog.length ?? 0) > 0 && <><h3>{tr("Table activity", "เหตุการณ์บนโต๊ะ")}</h3>{[...(state?.eventLog ?? [])].reverse().slice(0, 10).map((entry) => <article key={`event-${entry.id}`}><span>·</span><div><strong>{entry.actorPlayerId === null ? tr("Game", "เกม") : playerLabel(entry.actorPlayerId)}</strong><p>{entry.kind === "match-started" ? tr("Match started", "เริ่มการแข่งขัน") : entry.kind === "draw" ? tr("drew a card", "จั่วไพ่") : entry.kind === "turn-ended" ? tr("ended the turn", "จบเทิร์น") : entry.kind === "eliminated" ? tr("was eliminated", "แพ้แล้ว") : entry.kind === "winner" ? tr("won the match", "ชนะการแข่งขัน") : tr("made a guess", "ทำการเดา")}</p></div></article>)}</>}
                  </div>
                )}
              </section>
              <section className={`deduction-notebook ${notebookOpen ? "is-open" : ""}`}>
                <button type="button" className="guess-feed-toggle" onClick={() => setNotebookOpen((open) => !open)} aria-expanded={notebookOpen}>
                  <span>{tr("Deduction notebook", "สมุดจดช่วยวิเคราะห์")}</span>
                  <em>{notebookCardId === "" ? notebookTargets.length : notebookCandidates.length}</em>
                  <b>{notebookOpen ? "−" : "+"}</b>
                </button>
                {notebookOpen && <div className="notebook-body">
                  <label>
                    <span>{tr("Hidden card", "ไพ่คว่ำที่กำลังวิเคราะห์")}</span>
                    <select value={notebookCardId} onChange={(event) => setNotebookCardId(event.target.value)}>
                      <option value="">{tr("Select a card…", "เลือกไพ่…")}</option>
                      {notebookTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                    </select>
                  </label>
                  {notebookCardId !== "" && <>
                    <p>{tr("Wrong public guesses are crossed out automatically. Tap any candidate to add or remove your own note.", "คำตอบที่มีคนเดาผิดจะถูกตัดอัตโนมัติ แตะตัวเลือกเพื่อจดหรือนำโน้ตของคุณออก")}</p>
                    <div className="candidate-grid">
                      {["JOKER", ...RANKS.flatMap((rank) => [`${rank}-red`, `${rank}-black`])].map((candidate) => {
                        const unavailable = publicMisses.has(candidate);
                        const excluded = manualExclusions.has(candidate);
                        return <button key={candidate} type="button" className={unavailable || excluded ? "is-excluded" : ""} disabled={unavailable} onClick={() => setNotebookExcluded((current) => {
                          const next = new Set(current[notebookCardId] ?? []);
                          if (next.has(candidate)) next.delete(candidate); else next.add(candidate);
                          return { ...current, [notebookCardId]: [...next] };
                        })}>{candidate.replace("-red", " ♥").replace("-black", " ♠")}</button>;
                      })}
                    </div>
                    <small>{tr(`${notebookCandidates.length} candidates remain`, `เหลือ ${notebookCandidates.length} ตัวเลือก`)}</small>
                  </>}
                </div>}
              </section>
              {state?.matchResult !== null && state?.matchResult !== undefined && (
                <section className="match-result" role="dialog" aria-label={tr("Match result", "ผลการแข่งขัน")}>
                  <span className="eyebrow">{tr("MATCH COMPLETE", "จบการแข่งขัน")}</span>
                  <h2>{state.matchResult.winnerPlayerId === auth.user.id ? tr("You win!", "คุณชนะ!") : tr(`${playerLabel(state.matchResult.winnerPlayerId)} wins`, `${playerLabel(state.matchResult.winnerPlayerId)} ชนะ`)}</h2>
                  <div className="result-stats">{[...state.matchResult.stats].sort((a, b) => b.correctGuesses - a.correctGuesses).map((stats) => <article key={stats.playerId}><strong>{playerLabel(stats.playerId)}</strong><span>{tr(`${stats.correctGuesses}/${stats.guesses} correct`, `เดาถูก ${stats.correctGuesses}/${stats.guesses}`)}</span><small>{tr(`${stats.cardsRevealed} cards revealed`, `เปิดไพ่ได้ ${stats.cardsRevealed} ใบ`)}</small></article>)}</div>
                  {replayOpen && <div className="replay-timeline">{state.eventLog.map((entry) => <p key={entry.id}><strong>{entry.actorPlayerId === null ? tr("Game", "เกม") : playerLabel(entry.actorPlayerId)}</strong> · {entry.kind.replaceAll("-", " ")}{entry.detail === null ? "" : ` · ${entry.detail}`}</p>)}</div>}
                  <div className="modal-actions">{roomPlayer?.isHost === true && <button className="primary-button" type="button" onClick={() => room.send("rematch")}>{tr("Play again", "เล่นอีกครั้ง")}</button>}<button className="secondary-button" type="button" onClick={() => setReplayOpen((open) => !open)}>{tr("Replay", "ดูย้อนหลัง")}</button><button className="secondary-button" type="button" onClick={() => void shareMatchResult()}>{tr("Share result", "แชร์ผล")}</button><button className="secondary-button" type="button" onClick={() => void room.leave(true)}>{tr("Leave table", "ออกจากโต๊ะ")}</button></div>
                </section>
              )}
            </>
          ) : state?.startingSelection !== null && state?.startingSelection !== undefined ? (
            <section className="starter-selection">
              <span className="eyebrow">{tr(`WHO STARTS · ROUND ${state.startingSelection.round}`, `หาผู้เล่นคนแรก · รอบ ${state.startingSelection.round}`)}</span>
              <h2>{state.startingSelection.phase === "choosing" ? tr("Choose one card", "เลือกไพ่คว่ำ 1 ใบ") : tr("Reveal together", "เปิดไพ่พร้อมกัน")}</h2>
              <p>
                {state.startingSelection.phase === "choosing"
                  ? state.startingSelection.eligiblePlayerIds.includes(auth.user.id)
                    ? tr("Pick any available card. Highest rank starts; Joker beats K.", "เลือกใบที่ยังว่าง ไพ่สูงสุดได้เริ่มก่อน และ Joker สูงกว่า K")
                    : tr("Waiting for the tied players to choose again.", "รอผู้เล่นที่ได้ไพ่สูงสุดเสมอกันเลือกใหม่")
                  : state.startingSelection.starterPlayerId === null
                    ? tr("Highest cards tied. Preparing a fresh set.", "ไพ่สูงสุดเสมอกัน กำลังเตรียมไพ่ชุดใหม่")
                    : tr(`${playerLabel(state.startingSelection?.starterPlayerId)} starts`, `${playerLabel(state.startingSelection?.starterPlayerId)} ได้เริ่มก่อน`)}
              </p>
              {state.startingSelection.phase === "choosing" && (
                <div className="starter-choice-status" aria-live="polite">
                  <span>
                    {state.startingSelection.options.filter((option) => option.selectedByPlayerId !== null).length}
                    /{state.startingSelection.eligiblePlayerIds.length}
                  </span>
                  <p>
                    {state.startingSelection.options.some((option) => option.selectedByPlayerId === auth.user.id)
                      ? tr("Locked in · waiting for everyone", "เลือกแล้ว · รอคนอื่นเลือกให้ครบ")
                      : state.startingSelection.eligiblePlayerIds.includes(auth.user.id)
                        ? tr("Your choice · pick an available card", "ถึงตาคุณ · เลือกไพ่ที่ยังว่างได้เลย")
                        : tr("Waiting for tied players", "รอผู้เล่นที่เสมอกันเลือกไพ่")}
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
                          ? tr(`Card ${index + 1}`, `เลือกใบที่ ${index + 1}`)
                          : selectedByMe
                            ? tr("Your card", "ไพ่ของคุณ")
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
              <h2>{roomPlayer?.isHost ? tr("Your room is ready", "ห้องพร้อมแล้ว") : tr("Waiting for the host", "รอ Host เริ่มเกม")}</h2>
              <p>{roomPlayer?.isHost
                ? tr("Start now or invite friends. Empty seats become bots.", "เริ่มได้เลยหรือชวนเพื่อน ที่นั่งว่างจะถูกเติมด้วยบอท")
                : tr("Set your status below. The host starts the match.", "กดพร้อมด้านล่าง แล้ว Host จะเป็นผู้เริ่มเกม")}</p>
              {auth.user.account_type === "guest" && roomPlayer !== undefined && (
                <form
                  className="guest-room-name-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveGuestRoomName();
                  }}
                >
                  <label htmlFor="guest-room-display-name">
                    <span>{tr("Player name", "ชื่อผู้เล่น")}</span>
                    <small>{tr("For this room", "สำหรับห้องนี้")}</small>
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
                      {guestNameSaving ? tr("Saving…", "กำลังบันทึก…") : guestRoomNameChanged ? tr("Save name", "บันทึกชื่อ") : tr("Name saved", "บันทึกแล้ว")}
                    </button>
                  </div>
                </form>
              )}
              {state !== null && roomPlayer?.isHost !== true && (
                <div className="settings-summary">
                  <strong>{state.settings.preset === "classic" ? tr("Classic rules", "กติกา Classic") : tr(`Custom · ${state.settings.totalCards} cards`, `กติกา Custom · ${state.settings.totalCards} ใบ`)}</strong>
                  <span>{tr(`${state.settings.drawRounds} draw rounds · ${state.settings.turnSeconds === 0 ? "no timer" : `${state.settings.turnSeconds}s per action`}`, `จั่วได้ ${state.settings.drawRounds} รอบ · ${state.settings.turnSeconds === 0 ? "ไม่จำกัดเวลา" : `${state.settings.turnSeconds} วินาทีต่อการตัดสินใจ`}`)}</span>
                </div>
              )}
              {roomPlayer?.isHost === true && state !== null && (
                <section className="room-settings-panel">
                  <header className="room-settings-header">
                    <div>
                      <h3>{tr("Game setup", "ตั้งค่าเกม")}</h3>
                      <p>{tr("Choose a pace and bot style.", "เลือกความเร็วและรูปแบบบอท")}</p>
                    </div>
                    <span className="settings-mode-badge">
                      {settingsDraft.preset === "classic" ? tr("Classic deck", "สำรับ Classic") : tr("Custom deck", "สำรับ Custom")}
                    </span>
                  </header>

                  <form className="room-settings" onSubmit={(event) => {
                    event.preventDefault();
                    saveRoomSettings();
                  }}>
                    <div className="speed-presets" aria-label={tr("Pace presets", "รูปแบบความเร็ว")}><button className={settingsDraft.turnSeconds === 30 ? "is-active" : ""} aria-pressed={settingsDraft.turnSeconds === 30} type="button" onClick={() => setSettingsDraft({ ...settingsDraft, turnSeconds: 30 })}>⚡ {tr("Fast · 30s", "เร็ว · 30 วิ")}</button><button className={settingsDraft.turnSeconds === 120 ? "is-active" : ""} aria-pressed={settingsDraft.turnSeconds === 120} type="button" onClick={() => setSettingsDraft({ ...settingsDraft, turnSeconds: 120 })}>{tr("Standard · 2m", "ปกติ · 2 นาที")}</button><button className={settingsDraft.turnSeconds === 0 ? "is-active" : ""} aria-pressed={settingsDraft.turnSeconds === 0} type="button" onClick={() => setSettingsDraft({ ...settingsDraft, turnSeconds: 0 })}>{tr("Relaxed · no timer", "สบาย ๆ · ไม่จับเวลา")}</button></div>
                    <div className="room-settings-fields">
                      <label className="settings-field">
                        <span>{tr("Rules", "รูปแบบกติกา")}</span>
                        <small>{tr("Classic is recommended for your first game", "Classic เหมาะสำหรับเกมแรก")}</small>
                        <select value={settingsDraft.preset} onChange={(event) => setSettingsDraft({ ...settingsDraft, preset: event.target.value as RoomSettings["preset"] })}>
                          <option value="classic">{tr("Classic · full deck", "Classic · สำรับเต็ม")}</option>
                          <option value="custom" disabled={state.lobbyMode === "public"}>{state.lobbyMode === "public" ? tr("Custom · private rooms only", "Custom · ใช้ได้ในห้องส่วนตัว") : tr("Custom · configure deck", "Custom · กำหนดสำรับเอง")}</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span>{tr("Bot difficulty", "ระดับความยากบอท")}</span>
                        <small>{tr("Bots use public information only", "บอทใช้เฉพาะข้อมูลสาธารณะ")}</small>
                        <select value={settingsDraft.botDifficulty} onChange={(event) => setSettingsDraft({ ...settingsDraft, botDifficulty: event.target.value as RoomSettings["botDifficulty"] })}>
                          <option value="easy">{tr("Easy · random guesses", "ง่าย · เดาสุ่ม")}</option>
                          <option value="normal">{tr("Normal · remembers misses", "ปกติ · จำคำตอบที่ผิด")}</option>
                          <option value="hard">{tr("Hard · uses rack order", "ยาก · วิเคราะห์ลำดับไพ่")}</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span>{tr("Action timer", "เวลาต่อการตัดสินใจ")}</span>
                        <small>{tr("Resets after every successful action", "รีเซ็ตหลังทำ action สำเร็จ")}</small>
                        <select value={settingsDraft.turnSeconds} onChange={(event) => setSettingsDraft({ ...settingsDraft, turnSeconds: Number(event.target.value) as RoomSettings["turnSeconds"] })}>
                          <option value={0}>{tr("No timer", "ไม่จำกัดเวลา")}</option>
                          <option value={30}>{tr("30 seconds", "30 วินาที")}</option>
                          <option value={60}>{tr("1 minute", "1 นาที")}</option>
                          <option value={90}>{tr("1 minute 30 seconds", "1 นาที 30 วินาที")}</option>
                          <option value={120}>{tr("2 minutes", "2 นาที")}</option>
                          <option value={180}>{tr("3 minutes", "3 นาที")}</option>
                          <option value={300}>{tr("5 minutes", "5 นาที")}</option>
                        </select>
                      </label>
                      {settingsDraft.preset === "custom" && (
                        <>
                          <label className="settings-field">
                            <span>{tr("Total cards", "จำนวนไพ่ทั้งหมด")}</span>
                            <small>{tr(`${customDeckMinimum}–${customDeckMaximum} for this match`, `${customDeckMinimum}–${customDeckMaximum} ใบสำหรับแมตช์นี้`)}</small>
                            <input type="number" min={customDeckMinimum} max={customDeckMaximum} value={settingsDraft.totalCards} onChange={(event) => setSettingsDraft({ ...settingsDraft, totalCards: Number(event.target.value) })} />
                          </label>
                          <label className="settings-field">
                            <span>{tr("Draw rounds", "จำนวนรอบจั่ว")}</span>
                            <small>{tr("Reserve 1–8 draws per player", "แต่ละคนจั่วได้ 1–8 รอบ")}</small>
                            <input type="number" min={1} max={8} value={settingsDraft.drawRounds} onChange={(event) => setSettingsDraft({ ...settingsDraft, drawRounds: Number(event.target.value) })} />
                          </label>
                          <label className="settings-field">
                            <span>{tr("Jokers", "จำนวน Joker")}</span>
                            <small>{tr("2–4 cards", "ไพ่พิเศษ 2–4 ใบ")}</small>
                            <select value={settingsDraft.jokerCount} onChange={(event) => setSettingsDraft({ ...settingsDraft, jokerCount: Number(event.target.value) as RoomSettings["jokerCount"] })}>
                              <option value={2}>{tr("2 cards", "2 ใบ")}</option>
                              <option value={3}>{tr("3 cards", "3 ใบ")}</option>
                              <option value={4}>{tr("4 cards", "4 ใบ")}</option>
                            </select>
                          </label>
                          <p className={`custom-deck-guidance${customDeckValid ? "" : " is-invalid"}`}>
                            {customDeckValid
                              ? tr(
                                  `${settingsDraft.totalCards} cards works: ${settingsDraft.jokerCount} Jokers and enough cards for ${state.desiredPlayers} players with ${settingsDraft.drawRounds} draw rounds.`,
                                  `${settingsDraft.totalCards} ใบใช้ได้: มี Joker ${settingsDraft.jokerCount} ใบ และเพียงพอสำหรับ ${state.desiredPlayers} คนที่จั่วได้ ${settingsDraft.drawRounds} รอบ`,
                                )
                              : tr(
                                  `Choose ${customDeckMinimum}–${customDeckMaximum} total cards. This match needs at least ${customDeckMinimum} cards for ${state.desiredPlayers} players and ${settingsDraft.drawRounds} draw rounds; ${settingsDraft.jokerCount} Jokers limit the deck to ${customDeckMaximum}.`,
                                  `เลือกไพ่รวม ${customDeckMinimum}–${customDeckMaximum} ใบ แมตช์นี้ต้องมีอย่างน้อย ${customDeckMinimum} ใบสำหรับ ${state.desiredPlayers} คนและจั่ว ${settingsDraft.drawRounds} รอบ ส่วน Joker ${settingsDraft.jokerCount} ใบทำให้สำรับมีได้สูงสุด ${customDeckMaximum} ใบ`,
                                )}
                          </p>
                        </>
                      )}
                    </div>

                    <footer className="room-settings-footer">
                      <div className={`settings-save-state state-${visibleSettingsStatus}`} aria-live="polite">
                        <span className="settings-state-dot" />
                        <div>
                          <strong>
                            {visibleSettingsStatus === "applying"
                              ? tr("Applying…", "กำลังส่งค่าไปยังเซิร์ฟเวอร์")
                              : visibleSettingsStatus === "approved"
                                ? tr("Settings saved", "บันทึกการตั้งค่าแล้ว")
                                : visibleSettingsStatus === "dirty"
                                  ? tr("Unsaved changes", "มีค่าที่ยังไม่ได้บันทึก")
                                  : tr("Settings are up to date", "การตั้งค่าเป็นปัจจุบัน")}
                          </strong>
                          <small>{visibleSettingsStatus === "dirty" ? tr("Save to apply", "กดบันทึกเพื่อใช้ค่าใหม่") : tr("Changes clear non-host ready states", "แก้ค่าแล้วทุกคนต้องกดพร้อมใหม่")}</small>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className={`apply-settings-button state-${visibleSettingsStatus}`}
                        disabled={!settingsChanged || !customDeckValid || visibleSettingsStatus === "applying"}
                      >
                        {visibleSettingsStatus === "applying" ? (
                          <span className="settings-spinner" aria-hidden="true" />
                        ) : visibleSettingsStatus === "approved" ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
                        )}
                        {visibleSettingsStatus === "applying"
                          ? tr("Saving…", "กำลังบันทึก…")
                          : visibleSettingsStatus === "approved"
                            ? tr("Saved", "บันทึกแล้ว")
                            : settingsChanged
                              ? tr("Save settings", "บันทึกการตั้งค่า")
                              : tr("Saved", "บันทึกแล้ว")}
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
                      {player.isBot && <em className="guest-badge">BOT</em>}
                    </span>
                    <small>{player.isHost ? "HOST" : player.ready ? tr("READY", "พร้อม") : tr("NOT READY", "ยังไม่พร้อม")}</small>
                    {roomPlayer?.isHost === true && !player.isHost && !player.isBot && <span className="host-player-actions">
                      <button type="button" onClick={() => room.send("transfer-host", { playerId: player.id })}>{tr("Make host", "ตั้งเป็น Host")}</button>
                      <button type="button" className="is-danger" onClick={() => room.send("kick-player", { playerId: player.id })}>{tr("Remove", "นำออก")}</button>
                    </span>}
                  </div>
                ))}
              </div>
              <div className="waiting-actions">
                {roomPlayer?.isHost !== true && <button
                  type="button"
                  className={roomPlayer?.ready ? "secondary-button ready-active" : "secondary-button"}
                  onClick={() => room.send("ready", !(roomPlayer?.ready ?? false))}
                >
                  {roomPlayer?.ready ? tr("Cancel ready", "ยกเลิกความพร้อม") : tr("Ready", "พร้อมเล่น")}
                </button>}
                {roomPlayer?.isHost === true && (
                  <button type="button" className="primary-button lobby-start-button" disabled={!canHostStart || settingsChanged || !customDeckValid || guestRoomNameChanged || guestNameSaving} onClick={() => room.send("start-game")}>{guestRoomNameChanged || guestNameSaving ? tr("Save your name first", "บันทึกชื่อก่อน") : settingsChanged ? tr("Save settings first", "บันทึกการตั้งค่าก่อน") : state?.players.filter((player) => !player.isHost).every((player) => player.ready) !== true ? tr("Waiting for everyone", "รอทุกคนกดพร้อม") : Math.max(0, state.desiredPlayers - state.players.length) > 0 ? tr(`Start with ${state.desiredPlayers - state.players.length} bot${state.desiredPlayers - state.players.length === 1 ? "" : "s"}`, `เริ่มเกมพร้อมบอท ${state.desiredPlayers - state.players.length} ตัว`) : tr("Start match", "เริ่มเกม")}</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

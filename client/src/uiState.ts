export type ThemeId = "classic" | "ocean" | "cobalt" | "arctic";

const THEME_IDS = new Set<ThemeId>(["classic", "ocean", "cobalt", "arctic"]);

export function resolveTheme(saved: string | null): ThemeId {
  return saved !== null && THEME_IDS.has(saved as ThemeId) ? saved as ThemeId : "ocean";
}

interface LabelPlayer {
  readonly id: string;
  readonly displayName: string;
  readonly accountType: "registered" | "guest" | "bot";
}

export function formatPlayerLabel(
  players: readonly LabelPlayer[] | undefined,
  playerId: string | null | undefined,
): string {
  const player = players?.find((candidate) => candidate.id === playerId);
  if (player === undefined) return "Player";
  return `${player.displayName}${player.accountType === "guest" ? " · GUEST" : ""}`;
}

import assert from "node:assert/strict";
import test from "node:test";

import { formatPlayerLabel, resolveTheme } from "../src/uiState.ts";

test("Deep Ocean is the default while an existing valid preference is preserved", () => {
  assert.equal(resolveTheme(null), "ocean");
  assert.equal(resolveTheme("unknown"), "ocean");
  assert.equal(resolveTheme("classic"), "classic");
});

test("player labels are safe to derive as soon as the first game state arrives", () => {
  const players = [
    { id: "human", displayName: "Cipher Fox", accountType: "guest" as const },
    { id: "bot", displayName: "Cipher Bot 1", accountType: "bot" as const },
  ];
  assert.equal(formatPlayerLabel(players, "human"), "Cipher Fox · GUEST");
  assert.equal(formatPlayerLabel(players, "bot"), "Cipher Bot 1");
  assert.equal(formatPlayerLabel(players, "missing"), "Player");
});

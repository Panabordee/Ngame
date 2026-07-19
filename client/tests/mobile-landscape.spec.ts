import { expect, test, type Page } from "@playwright/test";

const cards = (count: number, own = false): string => Array.from({ length: count }, (_, index) => own
  ? `<button class="playing-card" aria-label="Card ${index + 1}">${index + 1}♠</button>`
  : `<div class="target-card-wrap"><button class="playing-card card-hidden is-interactive" aria-label="Card ${index + 1}"></button></div>`,
).join("");

async function mountTable(page: Page, withGuess = false): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--gold").trim().length > 0);
  await page.evaluate(({ opponentCards, ownCards, guess }) => {
    document.querySelector("#root")!.innerHTML = `
      <main class="game-shell">
        <header class="topbar"><div class="mini-brand"><span>◇</span><strong>CIPHERDECK</strong></div><div class="topbar-account"><button class="language-switch">EN</button><button class="language-switch menu-button">Menu</button><div class="profile-chip"><span>P</span><strong>Player</strong></div></div></header>
        <div class="match-layout">
          <section class="match-toolbar"><div><span class="eyebrow">CIPHERDECK TABLE</span><h1>Playing</h1><p>3 human players online</p></div><button class="danger-button">Leave room</button></section>
          <section class="game-table">
            <div class="table-glow"></div>
            <div class="opponent-grid">${["Nova", "Mira", "Cipher Bot"].map((name, playerIndex) => `<article class="player-seat opponent-seat"><header class="seat-header"><div><span class="seat-kicker">Opponent ${playerIndex + 1}</span><strong>${name}</strong></div><span class="card-count">6 cards</span></header><div class="rack opponent-rack">${opponentCards}${guess && playerIndex === 0 ? `<div class="target-card-wrap"><button class="playing-card card-hidden is-selected"></button><div class="guess-popover"><div class="guess-popover-header"><strong>What card is this?</strong><button>×</button></div><div class="rank-grid">${["A","2","3","4","5","6","7","8","9","10","J","Q","K","JOKER"].map((rank) => `<button>${rank}</button>`).join("")}</div><div class="color-picker"><button>Red</button><button>Black</button></div><button class="guess-button confirm-guess">Confirm</button></div></div>` : ""}</div></article>`).join("")}</div>
            <div class="table-center"><div class="deck-zone"><div class="deck-stack"><span class="deck-card card-back-art"></span></div><div><span class="zone-label">DRAW PILE</span><strong>18</strong></div></div><div class="turn-orbit"><span>TURN</span><strong>4</strong><small>GUESS</small><em>00:42</em></div><div class="pending-zone"><span class="zone-label">DRAWN CARD</span><div class="card-placeholder">—</div></div></div>
            <article class="player-seat own-seat"><header class="seat-header"><div><span class="seat-kicker">Your rack</span><strong>Player</strong></div><span class="card-count">7 cards</span></header><div class="rack own-rack">${ownCards}</div></article>
          </section>
          <section class="control-dock"><div class="phase-instruction"><span class="eyebrow">YOUR NEXT ACTION</span><strong>Choose a hidden opponent card</strong></div><div class="turn-actions"><button class="draw-button">DRAW</button><button class="stop-button">STOP & PLACE</button></div><p class="target-readout">Tap a hidden card</p></section>
        </div>
      </main>`;
  }, { opponentCards: cards(6), ownCards: cards(7, true), guess: withGuess });
}

test("landscape table fits the viewport and keeps actions reachable", async ({ page }) => {
  await mountTable(page);
  const metrics = await page.evaluate(() => {
    const dock = document.querySelector(".control-dock")!.getBoundingClientRect();
    const actionButtons = [...document.querySelectorAll<HTMLElement>(".turn-actions button")].map((button) => button.getBoundingClientRect());
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      dockBottom: dock.bottom,
      dockLeft: dock.left,
      dockRight: dock.right,
      smallestActionHeight: Math.min(...actionButtons.map((button) => button.height)),
      leaveFits: (() => { const button = document.querySelector<HTMLElement>(".match-toolbar .danger-button")!; return button.scrollWidth <= button.clientWidth; })(),
      ownRackTop: document.querySelector(".own-seat")!.getBoundingClientRect().top,
      dockTop: dock.top,
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.dockBottom).toBeLessThanOrEqual(390);
  expect(metrics.dockLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.dockRight).toBeLessThanOrEqual(844);
  expect(metrics.smallestActionHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.leaveFits).toBe(true);
  expect(metrics.ownRackTop).toBeLessThan(metrics.dockTop);
  await page.screenshot({ path: "test-results/mobile-landscape-table.png" });
});

test("guess picker stays fully visible in landscape", async ({ page }) => {
  await mountTable(page, true);
  const box = await page.locator(".guess-popover").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(844);
  expect(box!.y + box!.height).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/mobile-landscape-guess.png" });
});

test("room setup stays compact and keeps the start action reachable", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--gold").trim().length > 0);
  await page.evaluate(() => {
    document.querySelector("#root")!.innerHTML = `
      <main class="game-shell"><header class="topbar"><div class="mini-brand"><span>◇</span><strong>CIPHERDECK</strong></div><div class="topbar-account"><button class="language-switch">EN</button><button class="language-switch">Menu</button></div></header>
      <div class="match-layout"><section class="match-toolbar"><div><span class="eyebrow">GAME LOBBY</span><h1>Get ready</h1><p>1/3 players</p></div><div class="room-code-display"><span>ROOM</span><strong>123456</strong></div><button class="danger-button">Leave</button></section>
      <div class="waiting-room"><h2>Your room is ready</h2><p>Start now or invite friends. Empty seats become bots.</p>
      <form class="guest-room-name-editor"><label><span>Player name</span><small>For this room</small></label><div><input value="Player"><button class="secondary-button" disabled>Name saved</button></div></form>
      <section class="room-settings-panel"><header class="room-settings-header"><div><h3>Game setup</h3><p>Choose a pace and bot style.</p></div><span class="settings-mode-badge">Classic deck</span></header><form class="room-settings"><div class="speed-presets"><button class="is-active">Fast · 30s</button><button>Standard · 2m</button><button>Relaxed</button></div><div class="room-settings-fields">${["Rules", "Bot difficulty", "Action timer"].map((label) => `<label class="settings-field"><span>${label}</span><small>Help</small><select><option>Selected</option></select></label>`).join("")}</div><footer class="room-settings-footer"><div class="settings-save-state"><span class="settings-state-dot"></span><div><strong>Up to date</strong><small>Ready</small></div></div><button class="apply-settings-button state-synced" disabled>Saved</button></footer></form></section>
      <div class="waiting-player-list"><div><span>Player</span><small>HOST</small></div></div><div class="waiting-actions"><button class="primary-button lobby-start-button">Start with 2 bots</button></div></div></div></main>`;
  });
  const metrics = await page.evaluate(() => {
    const name = document.querySelector(".guest-room-name-editor")!.getBoundingClientRect();
    const settings = document.querySelector(".room-settings-panel")!.getBoundingClientRect();
    const start = document.querySelector(".lobby-start-button")!.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      nameLeft: name.left,
      settingsLeft: settings.left,
      startLeft: start.left,
      startRight: start.right,
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(844);
  expect(metrics.documentHeight).toBeLessThanOrEqual(430);
  expect(metrics.settingsLeft).toBeGreaterThan(metrics.nameLeft);
  expect(metrics.startLeft).toBeGreaterThanOrEqual(0);
  expect(metrics.startRight).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "test-results/mobile-landscape-lobby.png" });
});

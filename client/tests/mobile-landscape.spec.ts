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
        <header class="topbar"><div class="mini-brand"><span>◇</span><strong>CIPHERDECK</strong></div><div class="topbar-status">ONLINE</div><div class="topbar-account">${"<button class='language-switch'>◇</button>".repeat(7)}<div class="profile-chip">Player</div></div></header>
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

# Known limitations in the current MVP

- The browser client now has a playable card-table interface and original card-back art, but it is still an MVP rather than final production visual design.
- Live room state survives a 30-second client disconnect. Authoritative transitions are checkpointed to Redis for one hour, but automatically recreating a room and reconnecting every client after a container/VM crash still requires an orchestrator.
- Redis now backs Colyseus presence/room discovery, per-user message buckets, recovery checkpoints, and the match-result retry outbox.
- Six-digit room codes are convenience locators, not access-control secrets. Code uniqueness is guaranteed inside the current single realtime process; horizontal scaling will require an atomic Redis-backed code registry.
- A Redis-backed active-player reservation prevents one account from occupying player seats in multiple rooms across realtime replicas. Spectating another started room remains intentionally allowed because it cannot submit game actions.
- Completed-match persistence, lifetime statistics, achievements, recent history, and seasonal/all-time leaderboard endpoints are implemented for registered users. Rating currently uses a provisional formula rather than Elo/Glicko matchmaking.
- The action timer is authoritative during starting-card selection, opening-Joker placement, and normal play. A missed starting-card choice receives a random remaining option rather than eliminating the player.
- Player profiles support display name, username, and the Google avatar URL. Uploading a custom avatar is not implemented.
- Google sign-in requires real Google credentials and exact origin/callback configuration; automated tests use a provider stub and cannot validate a real Google tenant.
- Realtime room messages are rate-limited, but distributed abuse controls for the FastAPI auth endpoints are still pending.
- One-match Guest bindings and six-digit code allocation still use process-local registries. Colyseus discovery is distributed, but these two registries must become atomic Redis operations before running multiple writable realtime replicas.
- Mobile play is landscape-first and has automated viewport coverage, but broad physical-device/browser testing is still required. Steamworks integration and payments remain out of scope.

# Known limitations in the current MVP

- The browser client now has a playable card-table interface and original card-back art, but it is still an MVP rather than final production visual design.
- Live room state survives a 30-second client disconnect. Authoritative transitions are checkpointed to Redis for one hour, but automatically recreating a room and reconnecting every client after a container/VM crash still requires an orchestrator.
- Redis now backs Colyseus presence/room discovery, per-user message buckets, recovery checkpoints, the match-result retry outbox, atomic room-code allocation, and API request limits.
- Six-digit room codes are convenience locators, not access-control secrets. Code uniqueness is atomic across realtime replicas when Redis is configured.
- A Redis-backed active-player reservation prevents one account from occupying player seats in multiple rooms across realtime replicas. Spectating another started room remains intentionally allowed because it cannot submit game actions.
- Completed-match persistence, lifetime statistics, achievements, recent history, and seasonal/all-time leaderboard endpoints are implemented for registered users. Rating currently uses a provisional formula rather than Elo/Glicko matchmaking.
- The action timer is authoritative during starting-card selection, opening-Joker placement, and normal play. A missed starting-card choice receives a random remaining option rather than eliminating the player.
- Player profiles support display name, username, and the Google avatar URL. Uploading a custom avatar is not implemented.
- Google sign-in requires real Google credentials and exact origin/callback configuration; automated tests use a provider stub and cannot validate a real Google tenant.
- Realtime messages and FastAPI requests are rate-limited. The API limiter uses Redis in Compose/production and an in-memory fallback for local development.
- Guest match bindings, registered-account seat reservations, and room-code allocation are Redis-atomic across realtime replicas when Redis is configured.
- Mobile play is landscape-first and has automated viewport coverage, but broad physical-device/browser testing is still required. Steamworks integration and payments remain out of scope.

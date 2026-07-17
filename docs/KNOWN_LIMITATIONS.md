# Known limitations in the current MVP

- The browser client now has a playable card-table interface and original card-back art, but it is still an MVP rather than final production visual design.
- Live room state survives a 30-second client disconnect but not a realtime container or VM crash.
- Redis is provisioned for future distributed matchmaking, rate limits, and room snapshots; the current single-process room does not use it yet.
- Six-digit room codes are convenience locators, not access-control secrets. Code uniqueness is guaranteed inside the current single realtime process; horizontal scaling will require an atomic Redis-backed code registry.
- Duplicate accounts are blocked inside one room, but the same account can still occupy seats in different rooms from multiple tabs. Add a Redis-backed presence reservation before public matchmaking is exposed to untrusted traffic.
- Completed match persistence, match history, leaderboard, and the realtime-to-API result endpoint are not implemented yet.
- Google sign-in requires real Google credentials and exact origin/callback configuration; automated tests use a provider stub and cannot validate a real Google tenant.
- Realtime room messages are rate-limited, but distributed abuse controls for the FastAPI auth endpoints are still pending.
- The MVP has no mobile-specific behavior, Steamworks integration, or payment system.

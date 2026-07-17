# Known limitations in the current MVP

- The browser client now has a playable card-table interface and original card-back art, but it is still an MVP rather than final production visual design.
- Live room state survives a 30-second client disconnect but not a realtime container or VM crash.
- Redis is provisioned for future distributed matchmaking, rate limits, and room snapshots; the current single-process room does not use it yet.
- Completed match persistence, match history, leaderboard, and the realtime-to-API result endpoint are not implemented yet.
- Production email registration must remain disabled until SMTP, verification, password reset, and endpoint rate limiting are completed. Local password auth is enabled for testing.
- Google sign-in code is present but requires real Google credentials and exact production origin/callback configuration before it can be exercised.
- Realtime room messages are rate-limited, but distributed abuse controls for the FastAPI auth endpoints are still pending.
- The MVP has no mobile-specific behavior, Steamworks integration, or payment system.

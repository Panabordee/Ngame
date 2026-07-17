# Ports and hostnames

## Local and Compose ports

| Service | Direct development | Docker host port | Container/internal port | Public production hostname |
| --- | ---: | ---: | ---: | --- |
| Vite frontend | `5173` | `8080` | `8080` | `ngame.ce-nacl.com` |
| Vite preview | `4173` | — | — | — |
| FastAPI | `8000` | `8000` | `8000` | `ngame-api.ce-nacl.com` |
| Colyseus realtime | `2567` | `2567` | `2567` | `ngame-realtime.ce-nacl.com` |
| PostgreSQL | — | not published | `5432` | none |
| Redis | — | not published | `6379` | none |
`PUBLISH_ADDRESS` controls the bind address for ports 8080, 8000, and 2567. Use `127.0.0.1` if Nginx runs on the same VM. If the external Nginx host is another machine, bind to the NGAME VM's private address and firewall those ports so only the proxy host can reach them.

Only ports 80 and 443 should be exposed publicly on the reverse proxy. PostgreSQL and Redis must never be exposed to the internet.

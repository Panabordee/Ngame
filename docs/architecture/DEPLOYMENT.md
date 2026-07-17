# NGAME deployment architecture

## Production target

- Hypervisor: Proxmox
- Guest: Ubuntu Server 24.04 LTS virtual machine
- Runtime: Docker Engine with the Docker Compose plugin
- TLS entry point: an existing self-hosted Nginx reverse proxy
- Domain: `ce-nacl.com`

Use a VM rather than a nested Docker LXC so kernel, networking, and storage behavior stay conventional. Keep the application VM and the existing proxy on the same trusted LAN when possible.

## Public hostnames

| Hostname | Upstream service | Default VM port |
| --- | --- | ---: |
| `ngame.ce-nacl.com` | React frontend | `8080` |
| `ngame-api.ce-nacl.com` | FastAPI | `8000` |
| `ngame-realtime.ce-nacl.com` | Colyseus WebSocket server | `2567` |

Create individual DNS records for `ngame`, `ngame-api`, and `ngame-realtime`, or use an appropriate wildcard DNS record. These are all single-label subdomains of `ce-nacl.com`, so a `*.ce-nacl.com` wildcard certificate covers all three.

Google's production OAuth redirect will be:

```text
https://ngame-api.ce-nacl.com/auth/google/callback
```

## Containers

| Service | Responsibility | Public exposure |
| --- | --- | --- |
| `frontend` | Serve the built React/Vite application | Through Nginx only |
| `api` | Authentication, users, and profiles; future match history | Through Nginx only |
| `realtime` | Matchmaking and authoritative CipherDeck rooms | Through Nginx only |
| `postgres` | Persistent relational data | Never public |
| `redis` | Provisioned for future rate limits, coordination, and room snapshots | Never public |

FastAPI owns persistent application data and Colyseus owns live match state. The planned match-history phase will add an authenticated internal FastAPI result endpoint for Colyseus. That endpoint is not part of the current MVP. Neither the frontend nor Colyseus writes directly to PostgreSQL.

## Networks and firewall

Use separate Compose networks:

- `edge`: frontend, API, and realtime services
- `data`: API, realtime, PostgreSQL, and Redis; mark it internal

If Nginx runs on the same VM, publish application ports on `127.0.0.1`. If Nginx runs on another host, publish them on the VM's private LAN address and allow those ports only from the proxy IP in the VM firewall. Never expose PostgreSQL port 5432 or Redis port 6379 outside Compose.

Only Nginx should accept public traffic on ports 80 and 443. Nginx terminates TLS and forwards the original host, client IP, and protocol headers. The realtime virtual host must support WebSocket upgrade headers.

## Data and recovery

Persist these paths as named volumes:

- PostgreSQL data
- Redis data when persistence is enabled

Back up PostgreSQL with scheduled logical dumps in addition to Proxmox VM backups. A VM snapshot alone is not the database backup strategy. The first release preserves matches across short network disconnects but not a realtime container/VM crash; Redis-backed room snapshots can be added after the basic loop is stable.

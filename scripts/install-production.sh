#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/Panabordee/Ngame.git}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEFAULT_INSTALL_DIR="/opt/ngame"
NODE_VERSION="${NODE_VERSION:-24.18.0}"

log() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_value() {
  local prompt="$1" value
  while true; do
    read -r -p "$prompt: " value
    [[ -n "$value" ]] && { printf '%s' "$value"; return; }
    printf 'This value is required.\n' >&2
  done
}

read_secret() {
  local prompt="$1" value
  while true; do
    read -r -s -p "$prompt: " value
    printf '\n' >&2
    [[ -n "$value" ]] && { printf '%s' "$value"; return; }
    printf 'This value is required.\n' >&2
  done
}

valid_ipv4() {
  local ip="$1" octet
  IFS=. read -r -a octets <<<"$ip"
  [[ ${#octets[@]} -eq 4 ]] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]+$ ]] && ((10#$octet <= 255)) || return 1
  done
}

install_node() {
  local machine_arch node_arch archive base_url checksum
  machine_arch="$(uname -m)"
  case "$machine_arch" in
    x86_64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) fail "Unsupported CPU architecture for Node.js: $machine_arch" ;;
  esac

  if command -v node >/dev/null && [[ "$(node --version)" == "v$NODE_VERSION" ]]; then
    printf 'Node.js %s is already installed.\n' "$NODE_VERSION"
    return
  fi

  archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  base_url="https://nodejs.org/dist/v${NODE_VERSION}"
  node_temp_dir="$(mktemp -d)"
  curl --fail --silent --show-error --location "$base_url/$archive" -o "$node_temp_dir/$archive"
  curl --fail --silent --show-error --location "$base_url/SHASUMS256.txt" -o "$node_temp_dir/SHASUMS256.txt"
  checksum="$(awk -v file="$archive" '$2 == file {print $1}' "$node_temp_dir/SHASUMS256.txt")"
  [[ -n "$checksum" ]] || fail "Node.js checksum was not found"
  printf '%s  %s\n' "$checksum" "$node_temp_dir/$archive" | sha256sum --check --status || \
    fail "Node.js archive checksum verification failed"

  "${SUDO[@]}" mkdir -p /opt/nodejs
  "${SUDO[@]}" tar -xJf "$node_temp_dir/$archive" -C /opt/nodejs
  "${SUDO[@]}" ln -sfn "/opt/nodejs/node-v${NODE_VERSION}-linux-${node_arch}/bin/node" /usr/local/bin/node
  "${SUDO[@]}" ln -sfn "/opt/nodejs/node-v${NODE_VERSION}-linux-${node_arch}/bin/npm" /usr/local/bin/npm
  "${SUDO[@]}" ln -sfn "/opt/nodejs/node-v${NODE_VERSION}-linux-${node_arch}/bin/npx" /usr/local/bin/npx
  hash -r
  printf 'Installed Node.js %s and npm %s.\n' "$(node --version)" "$(npm --version)"
}

env_value() {
  local key="$1" line
  [[ -f .env ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == "$key="* ]] && { printf '%s' "${line#*=}"; return; }
  done < .env
}

if [[ ${EUID} -eq 0 ]]; then
  SUDO=()
else
  command -v sudo >/dev/null || fail "sudo is required"
  SUDO=(sudo)
fi

SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -d "$SCRIPT_ROOT/.git" ]]; then
  default_dir="$SCRIPT_ROOT"
else
  default_dir="$DEFAULT_INSTALL_DIR"
fi
read -r -p "Install directory [$default_dir]: " INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-$default_dir}"
[[ "$INSTALL_DIR" = /* ]] || fail "Install directory must be an absolute path"

APP_IP="$(require_value 'Application VM private IP')"
valid_ipv4 "$APP_IP" || fail "Invalid application IPv4 address"
ip -o -4 address show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$APP_IP" || \
  fail "$APP_IP is not assigned to a local network interface"
PROXY_IP="$(require_value 'Trusted reverse-proxy private IP')"
valid_ipv4 "$PROXY_IP" || fail "Invalid reverse-proxy IPv4 address"

log "Installing Docker Engine, Compose v2, Node.js, Git, and OpenSSL"
"${SUDO[@]}" apt-get update
DEBIAN_FRONTEND=noninteractive "${SUDO[@]}" apt-get install -y git docker.io docker-compose-v2 openssl curl xz-utils
"${SUDO[@]}" systemctl enable --now docker
install_node

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log "Cloning $DEPLOY_BRANCH into $INSTALL_DIR"
  "${SUDO[@]}" mkdir -p "$INSTALL_DIR"
  "${SUDO[@]}" chown "$(id -u):$(id -g)" "$INSTALL_DIR"
  git clone --branch "$DEPLOY_BRANCH" --single-branch "$REPOSITORY_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
[[ -d .git ]] || fail "$INSTALL_DIR is not a Git repository"
[[ -z "$(git status --porcelain)" ]] || fail "Repository has local changes; commit or stash them before deployment"

log "Updating $DEPLOY_BRANCH with a fast-forward-only pull"
git fetch origin "$DEPLOY_BRANCH"
git switch "$DEPLOY_BRANCH"
git pull --ff-only origin "$DEPLOY_BRANCH"
DEPLOY_COMMIT="$(git rev-parse HEAD)"
printf 'Deploying commit %s\n' "$DEPLOY_COMMIT"

umask 077
if [[ -f .env ]]; then
  ENV_BACKUP=".env.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  cp --preserve=mode .env "$ENV_BACKUP"
  chmod 600 "$ENV_BACKUP"
  printf 'Backed up existing environment to %s\n' "$INSTALL_DIR/$ENV_BACKUP"
fi

EXISTING_GOOGLE_ID="$(env_value GOOGLE_CLIENT_ID)"
EXISTING_GOOGLE_SECRET="$(env_value GOOGLE_CLIENT_SECRET)"
if [[ -n "$EXISTING_GOOGLE_ID" ]]; then
  read -r -p "Google Client ID [press Enter to keep existing]: " GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$EXISTING_GOOGLE_ID}"
else
  GOOGLE_CLIENT_ID="$(require_value 'Google Client ID')"
fi
if [[ -n "$EXISTING_GOOGLE_SECRET" ]]; then
  read -r -s -p "Google Client Secret [press Enter to keep existing]: " GOOGLE_CLIENT_SECRET
  printf '\n'
  GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-$EXISTING_GOOGLE_SECRET}"
else
  GOOGLE_CLIENT_SECRET="$(read_secret 'Google Client Secret')"
fi

POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
OAUTH_STATE_SECRET="$(env_value OAUTH_STATE_SECRET)"
MATCH_RESULT_SECRET="$(env_value MATCH_RESULT_SECRET)"
[[ -n "$POSTGRES_PASSWORD" ]] || POSTGRES_PASSWORD="$(openssl rand -hex 32)"
[[ -n "$OAUTH_STATE_SECRET" ]] || OAUTH_STATE_SECRET="$(openssl rand -hex 32)"
[[ -n "$MATCH_RESULT_SECRET" ]] || MATCH_RESULT_SECRET="$(openssl rand -hex 32)"
read -r -p "Deck Admin Google email(s), comma-separated [optional]: " ADMIN_EMAILS
ADMIN_EMAILS="${ADMIN_EMAILS:-$(env_value ADMIN_EMAILS)}"

log "Creating production environment and JWT keys"
mkdir -p secrets
if [[ ! -s secrets/jwt-private.pem || ! -s secrets/jwt-public.pem ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out secrets/jwt-private.pem
  openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
fi
chmod 600 secrets/jwt-private.pem
chmod 644 secrets/jwt-public.pem

ENV_TEMP="$(mktemp .env.new.XXXXXX)"
chmod 600 "$ENV_TEMP"
{
  printf '%s\n' \
    'NGAME_ENV=production' \
    'FRONTEND_PUBLIC_URL=https://ngame.meawsnowball.org' \
    'API_PUBLIC_URL=https://ngame-api.meawsnowball.org' \
    'REALTIME_PUBLIC_URL=https://ngame-realtime.meawsnowball.org' \
    'CORS_ALLOWED_ORIGINS=https://ngame.meawsnowball.org' \
    "PUBLISH_ADDRESS=$APP_IP" \
    'FRONTEND_PORT=8080' \
    'API_PORT=8000' \
    'REALTIME_PORT=2567' \
    "FORWARDED_ALLOW_IPS=$PROXY_IP" \
    'RECONNECT_TIMEOUT_SECONDS=30' \
    'MAX_ROOM_MESSAGES_PER_SECOND=20' \
    'API_INTERNAL_URL=http://api:8000' \
    "MATCH_RESULT_SECRET=$MATCH_RESULT_SECRET" \
    'REDIS_URL=redis://redis:6379' \
    'POSTGRES_DB=ngame' \
    'POSTGRES_USER=ngame' \
    "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
    'JWT_ISSUER=https://ngame-api.meawsnowball.org' \
    'JWT_AUDIENCE=ngame' \
    'ACCESS_TOKEN_TTL_SECONDS=900' \
    'REFRESH_TOKEN_TTL_DAYS=30' \
    'REFRESH_COOKIE_NAME=ngame_refresh' \
    'COOKIE_SECURE=true' \
    'GUEST_AUTH_ENABLED=true' \
    'GUEST_SESSION_TTL_SECONDS=21600' \
    "OAUTH_STATE_SECRET=$OAUTH_STATE_SECRET" \
    'GOOGLE_AUTH_ENABLED=true' \
    "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID" \
    "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET" \
    'GOOGLE_REDIRECT_URI=https://ngame-api.meawsnowball.org/auth/google/callback' \
    "ADMIN_EMAILS=$ADMIN_EMAILS" \
    'API_RATE_LIMIT_PER_MINUTE=120'
} > "$ENV_TEMP"
mv -f "$ENV_TEMP" .env
chmod 600 .env

if grep -Eq 'replace-with|<[^>]+>|localhost|127\.0\.0\.1|=\*($|,)' .env; then
  fail "Production .env contains a placeholder or unsafe development value"
fi

DOCKER=("${SUDO[@]}" docker)
COMPOSE=("${DOCKER[@]}" compose --env-file .env)

if "${COMPOSE[@]}" ps --status running postgres --quiet 2>/dev/null | grep -q .; then
  log "Backing up the existing PostgreSQL database"
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/ngame}"
  "${SUDO[@]}" install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$BACKUP_DIR"
  DB_BACKUP="$BACKUP_DIR/ngame-$(date -u +%Y%m%dT%H%M%SZ).sql"
  "${COMPOSE[@]}" exec -T postgres pg_dump -U ngame -d ngame > "$DB_BACKUP"
  chmod 600 "$DB_BACKUP"
  [[ -s "$DB_BACKUP" ]] || fail "Database backup is empty"
  printf 'Database backup: %s\n' "$DB_BACKUP"
fi

log "Validating configuration and building containers"
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d --build --remove-orphans

log "Waiting for local health checks"
for port in 8080 8000 2567; do
  healthy=false
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error "http://$APP_IP:$port/healthz" >/dev/null; then
      healthy=true
      break
    fi
    sleep 2
  done
  [[ "$healthy" == true ]] || fail "Health check failed on $APP_IP:$port"
  printf 'HTTP 200: http://%s:%s/healthz\n' "$APP_IP" "$port"
done

"${COMPOSE[@]}" ps
printf '\nDeployment complete at commit %s\n' "$DEPLOY_COMMIT"
printf 'Environment: %s/.env (mode 600)\n' "$INSTALL_DIR"
printf 'Google callback: https://ngame-api.meawsnowball.org/auth/google/callback\n'
printf 'Google JavaScript origin: https://ngame.meawsnowball.org\n'

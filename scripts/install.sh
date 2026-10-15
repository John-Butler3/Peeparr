#!/usr/bin/env bash
#
# One-command install (or update) of Peeparr on any Linux host with Docker,
# built from this fork's source so it includes all of the fork's features.
#
# On a fresh Debian/Ubuntu machine (as root):
#   curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/scripts/install.sh | bash
#
# or from a checkout:
#   sudo ./scripts/install.sh [options]
#
# What it does:
#   1. Installs git, curl and Docker if they're missing (Debian/Ubuntu).
#   2. Clones (or updates) the source into $SRC_DIR.
#   3. Writes $INSTALL_DIR/compose.yaml and, on first install only,
#      $INSTALL_DIR/.env with a random database password (mode 600).
#   4. Builds the app image and starts Postgres + Peeparr.
#   5. Waits until the app reports healthy and prints the next steps.
#   6. Installs `peeparr-update` (rebuild + restart from the latest commits)
#      and `peeparr-reset-password` helpers into /usr/local/bin.
#
# Re-running it is safe: existing .env, database and settings are kept.
#
# Options (or the matching environment variables):
#   --branch NAME       git branch to deploy           (BRANCH, default main)
#   --repo URL          git repository                 (REPO_URL)
#   --port N            host port for the web UI       (APP_PORT, default 3000)
#   --install-dir DIR   compose + .env directory       (INSTALL_DIR, default /opt/peeparr)
#   --src-dir DIR       source checkout                (SRC_DIR, default /opt/peeparr-src)
#   --no-docker-install fail instead of installing Docker when it's missing
#   --no-helpers        don't install peeparr-update / peeparr-reset-password
#   -h, --help          show this help
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/John-Butler3/Peeparr.git}"
BRANCH="${BRANCH:-main}"
APP_PORT="${APP_PORT:-3000}"
INSTALL_DIR="${INSTALL_DIR:-/opt/peeparr}"
SRC_DIR="${SRC_DIR:-/opt/peeparr-src}"
IMAGE_TAG="${IMAGE_TAG:-peeparr:custom}"
INSTALL_DOCKER="${INSTALL_DOCKER:-yes}"
INSTALL_HELPERS="${INSTALL_HELPERS:-yes}"

usage() {
  if [[ -f "$0" ]]; then
    sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
  else
    echo "See the header of scripts/install.sh or docs/DEPLOYMENT.md for options."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --port) APP_PORT="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --src-dir) SRC_DIR="$2"; shift 2 ;;
    --no-docker-install) INSTALL_DOCKER=no; shift ;;
    --no-helpers) INSTALL_HELPERS=no; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Run as root (e.g. with sudo)."
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || fail "--port must be a number."

# ---- 1. Prerequisites ------------------------------------------------------
apt_install() {
  command -v apt-get >/dev/null 2>&1 || fail "Missing $* and this isn't a Debian/Ubuntu host -- install it yourself and re-run."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "$@" >/dev/null
}

for tool in git curl openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    log "Installing $tool"
    apt_install "$tool" ca-certificates
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  [[ "$INSTALL_DOCKER" == "yes" ]] || fail "Docker is not installed."
  log "Installing Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || fail "'docker compose' (v2) is required."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running (try: systemctl start docker)."

# ---- 2. Source -------------------------------------------------------------
if [[ -d "$SRC_DIR/.git" ]]; then
  log "Updating source in $SRC_DIR ($BRANCH)"
  if [[ -n "$(git -C "$SRC_DIR" status --porcelain)" ]]; then
    fail "Uncommitted changes in $SRC_DIR. Commit, stash or discard them first."
  fi
  git -C "$SRC_DIR" fetch --quiet origin "$BRANCH"
  git -C "$SRC_DIR" checkout --quiet "$BRANCH"
  git -C "$SRC_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  log "Cloning $REPO_URL ($BRANCH) into $SRC_DIR"
  mkdir -p "$(dirname "$SRC_DIR")"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi
log "Source at $(git -C "$SRC_DIR" log --oneline -1)"

# ---- 3. Compose file and settings -----------------------------------------
mkdir -p "$INSTALL_DIR"
COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
ENV_FILE="$INSTALL_DIR/.env"
TEMPLATE="$SRC_DIR/infrastructure/compose/compose.selfbuild.yaml"
[[ -f "$TEMPLATE" ]] || fail "$TEMPLATE not found -- is $BRANCH the right branch?"

if [[ -f "$COMPOSE_FILE" ]] && ! cmp -s "$TEMPLATE" "$COMPOSE_FILE"; then
  if grep -q 'POSTGRES_PASSWORD: \${POSTGRES_PASSWORD' "$COMPOSE_FILE"; then
    cp "$COMPOSE_FILE" "$COMPOSE_FILE.bak.$(date +%Y%m%d%H%M%S)"
    cp "$TEMPLATE" "$COMPOSE_FILE"
    log "Updated $COMPOSE_FILE (previous copy backed up)"
  else
    # Hand-written / older compose file (e.g. password inline): leave it alone.
    warn "$COMPOSE_FILE was not written by this installer; keeping it as-is."
  fi
elif [[ ! -f "$COMPOSE_FILE" ]]; then
  cp "$TEMPLATE" "$COMPOSE_FILE"
  log "Wrote $COMPOSE_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  cat > "$ENV_FILE" <<ENV
# Peeparr install settings (read by compose.yaml). Keep this file private.
POSTGRES_DB=peeparr
POSTGRES_USER=peeparr
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_PORT=${APP_PORT}
PEEPARR_IMAGE=${IMAGE_TAG}
# Behind a reverse proxy: the proxy's hop count or address (docs/DEPLOYMENT.md).
# PEEPARR_TRUST_PROXY=1
# Uncomment if catalog Save & Test times out on an IPv4-only network:
# NODE_OPTIONS=--no-network-family-autoselection
ENV
  chmod 600 "$ENV_FILE"
  log "Wrote $ENV_FILE with a random database password"
else
  # Existing install: keep its port and image name.
  if grep -q '^APP_PORT=' "$ENV_FILE"; then
    EXISTING_PORT="$(grep '^APP_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
    if [[ "$EXISTING_PORT" != "$APP_PORT" && "$APP_PORT" != 3000 ]]; then
      warn "Keeping the existing port $EXISTING_PORT; change APP_PORT in $ENV_FILE to move it."
    fi
    APP_PORT="$EXISTING_PORT"
  fi
  if grep -q '^PEEPARR_IMAGE=' "$ENV_FILE"; then
    IMAGE_TAG="$(grep '^PEEPARR_IMAGE=' "$ENV_FILE" | tail -1 | cut -d= -f2)"
  fi
fi

# ---- 4. Build and start ----------------------------------------------------
log "Building $IMAGE_TAG (compiles the app; a few minutes on first run)"
# The version shown in Settings > About: version.txt, plus the commit when
# this isn't exactly that release's tag.
APP_VERSION="$(tr -d '[:space:]' < "$SRC_DIR/version.txt" 2>/dev/null || true)"
APP_VERSION="${APP_VERSION:-0.0.0}"
if [[ "$(git -C "$SRC_DIR" describe --tags --exact-match 2>/dev/null || true)" != "v$APP_VERSION" ]]; then
  APP_VERSION="$APP_VERSION+$(git -C "$SRC_DIR" rev-parse --short HEAD 2>/dev/null || echo dev)"
fi
docker build --quiet --build-arg PEEPARR_VERSION="$APP_VERSION" -t "$IMAGE_TAG" "$SRC_DIR" >/dev/null

log "Starting Peeparr"
(cd "$INSTALL_DIR" && docker compose up -d --remove-orphans)

# ---- 5. Wait for healthy ---------------------------------------------------
log "Waiting for the app to report healthy"
APP_CONTAINER="$(cd "$INSTALL_DIR" && docker compose ps -q app)"
status="starting"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null || echo starting)"
  [[ "$status" == "healthy" ]] && break
  sleep 5
done
if [[ "$status" != "healthy" ]]; then
  fail "The app didn't become healthy. Check: cd $INSTALL_DIR && docker compose logs app"
fi
docker image prune -f >/dev/null 2>&1 || true
# Cap the build cache (it grows with every rebuild); ~1 GB keeps rebuilds quick.
if docker builder prune --help 2>/dev/null | grep -q -- '--max-used-space'; then
  docker builder prune -f --max-used-space 1gb >/dev/null 2>&1 || true
else
  docker builder prune -f --keep-storage 1gb >/dev/null 2>&1 || true
fi

# ---- 6. Helper commands ----------------------------------------------------
if [[ "$INSTALL_HELPERS" == yes ]]; then
cat > /usr/local/bin/peeparr-update <<HELPER
#!/usr/bin/env bash
# Rebuild and restart Peeparr from the latest commits (installed by install.sh).
exec env SRC_DIR="$SRC_DIR" COMPOSE_DIR="$INSTALL_DIR" IMAGE_TAG="$IMAGE_TAG" "$SRC_DIR/scripts/deploy-container.sh" "\$@"
HELPER
cat > /usr/local/bin/peeparr-reset-password <<HELPER
#!/usr/bin/env bash
# Show the temporary password from "Forgot password?" (installed by install.sh).
cd "$INSTALL_DIR" && exec docker compose exec app peeparr-reset-password
HELPER
chmod +x /usr/local/bin/peeparr-update /usr/local/bin/peeparr-reset-password
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-localhost}"

cat <<SUMMARY

==> Peeparr is running.

    Open:           http://${HOST_IP}:${APP_PORT}
    Settings:       ${ENV_FILE}  (database password, port)
    Compose:        ${COMPOSE_FILE}
    Source:         ${SRC_DIR} @ ${BRANCH}

    Update later:   peeparr-update   (or ${SRC_DIR}/scripts/deploy-container.sh)
    Lost password:  click "Forgot password?" on the sign-in page, then run
                    peeparr-reset-password   (or: cd ${INSTALL_DIR} && docker compose exec app peeparr-reset-password)

Next: create the admin account in the browser, then connect your catalog
(StashDB / FansDB / TPDB), Stash and Whisparr.

If Whisparr-Eros should use TPDB as its metadata source, point it at this
Peeparr with scripts/configure-eros.sh -- see docs/DEPLOYMENT.md
("Whisparr-Eros and the catalog choice"). The proxy URL is:
    http://${HOST_IP}:${APP_PORT}/api/whisparr-metadata/{route}
SUMMARY

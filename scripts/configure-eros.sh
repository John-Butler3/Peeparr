#!/usr/bin/env bash
#
# Point Whisparr-Eros at the metadata source that matches Peeparr's catalog.
#
# Peeparr finds scenes in Whisparr by the catalog's scene id. Eros' built-in
# metadata service (api.whisparr.com) speaks StashDB ids, so:
#
#   --catalog stashdb   Eros uses its built-in StashDB metadata (the default;
#                       removes any override).
#   --catalog tpdb      Eros uses Peeparr's TPDB-backed metadata proxy
#                       (<peeparr>/api/whisparr-metadata/{route}). Needs a
#                       TPDB integration set up in Peeparr.
#   --status            Show what Eros is currently using.
#
# It edits the <WhisparrMetadata> entry in Eros' config.xml (after backing it
# up) and restarts Eros. Where it runs:
#
#   On the Eros machine (systemd install, e.g. community-scripts LXC):
#     ./configure-eros.sh --catalog tpdb --peeparr-url http://10.0.0.5:3000
#   On a Proxmox host, against an Eros LXC:
#     ./configure-eros.sh --ctid 110 --catalog tpdb --peeparr-url http://10.0.0.5:3000
#   Over SSH:
#     ./configure-eros.sh --ssh root@eros-host --catalog stashdb
#   Eros running in Docker (run on the Docker host):
#     ./configure-eros.sh --docker whisparr --catalog tpdb --peeparr-url http://10.0.0.5:3000
#
# Options:
#   --catalog tpdb|stashdb   which metadata source Eros should use
#   --status                 print the current setting and exit
#   --peeparr-url URL       Peeparr's base URL as Eros can reach it (tpdb only)
#   --config PATH            config.xml location (auto-detected otherwise)
#   --service NAME           systemd unit to restart (auto: whisparr-eros, whisparr)
#   --no-restart             edit only; restart Eros yourself
#   --ctid N | --ssh HOST | --docker NAME   run against a remote / containerised Eros
#   -h, --help
#
set -euo pipefail

CATALOG=""
STATUS_ONLY=no
PEEPARR_URL="${PEEPARR_URL:-}"
CONFIG_PATH="${CONFIG_PATH:-}"
SERVICE="${SERVICE:-}"
RESTART=yes
CTID=""
SSH_TARGET=""
DOCKER_CONTAINER=""
FORWARD_ARGS=()

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --catalog) CATALOG="$2"; FORWARD_ARGS+=("$1" "$2"); shift 2 ;;
    --status) STATUS_ONLY=yes; FORWARD_ARGS+=("$1"); shift ;;
    --peeparr-url) PEEPARR_URL="$2"; FORWARD_ARGS+=("$1" "$2"); shift 2 ;;
    --config) CONFIG_PATH="$2"; FORWARD_ARGS+=("$1" "$2"); shift 2 ;;
    --service) SERVICE="$2"; FORWARD_ARGS+=("$1" "$2"); shift 2 ;;
    --no-restart) RESTART=no; FORWARD_ARGS+=("$1"); shift ;;
    --ctid) CTID="$2"; shift 2 ;;
    --ssh) SSH_TARGET="$2"; shift 2 ;;
    --docker) DOCKER_CONTAINER="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

log() { printf '==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

if [[ "$STATUS_ONLY" == no ]]; then
  case "$CATALOG" in
    tpdb|stashdb) ;;
    *) fail "Pass --catalog tpdb or --catalog stashdb (or --status)." ;;
  esac
fi

PROXY_URL=""
if [[ "$CATALOG" == tpdb ]]; then
  [[ -n "$PEEPARR_URL" ]] || fail "--catalog tpdb needs --peeparr-url (e.g. http://10.0.0.5:3000)."
  [[ "$PEEPARR_URL" =~ ^https?:// ]] || fail "--peeparr-url must start with http:// or https://"
  PROXY_URL="${PEEPARR_URL%/}/api/whisparr-metadata/{route}"
fi

# ---- Remote targets: copy this script over and run it there ---------------
SELF="$(readlink -f "$0")"
if [[ -n "$CTID" ]]; then
  command -v pct >/dev/null 2>&1 || fail "--ctid needs to run on the Proxmox host (no 'pct' here)."
  pct push "$CTID" "$SELF" /root/configure-eros.sh --perms 0755
  exec pct exec "$CTID" -- /root/configure-eros.sh "${FORWARD_ARGS[@]}"
fi
if [[ -n "$SSH_TARGET" ]]; then
  scp -q "$SELF" "$SSH_TARGET:/tmp/configure-eros.sh"
  exec ssh -t "$SSH_TARGET" "bash /tmp/configure-eros.sh $(printf '%q ' "${FORWARD_ARGS[@]}"); rm -f /tmp/configure-eros.sh"
fi

# ---- Read / write config.xml (locally or inside a Docker container) -------
read_config() {
  if [[ -n "$DOCKER_CONTAINER" ]]; then
    docker exec "$DOCKER_CONTAINER" cat "$CONFIG_PATH"
  else
    cat "$CONFIG_PATH"
  fi
}

BACKUP_SUFFIX="$(date +%Y%m%d-%H%M%S)-$$"

write_config() {
  local file="$1"
  if [[ -n "$DOCKER_CONTAINER" ]]; then
    docker exec "$DOCKER_CONTAINER" cp "$CONFIG_PATH" "$CONFIG_PATH.bak.$BACKUP_SUFFIX"
    docker cp "$file" "$DOCKER_CONTAINER:$CONFIG_PATH"
  else
    cp -p "$CONFIG_PATH" "$CONFIG_PATH.bak.$BACKUP_SUFFIX"
    cat "$file" > "$CONFIG_PATH"
  fi
}

config_exists() {
  if [[ -n "$DOCKER_CONTAINER" ]]; then
    docker exec "$DOCKER_CONTAINER" test -f "$1"
  else
    test -f "$1"
  fi
}

if [[ -z "$CONFIG_PATH" ]]; then
  for candidate in /var/lib/whisparr-eros/config.xml /var/lib/whisparr/config.xml \
    /config/config.xml "$HOME/.config/Whisparr/config.xml"; do
    if config_exists "$candidate"; then
      CONFIG_PATH="$candidate"
      break
    fi
  done
  [[ -n "$CONFIG_PATH" ]] || fail "Couldn't find Eros' config.xml; pass --config PATH."
fi
config_exists "$CONFIG_PATH" || fail "$CONFIG_PATH not found."

CURRENT="$(read_config | grep -o '<WhisparrMetadata>[^<]*</WhisparrMetadata>' | sed 's/<[^>]*>//g' || true)"
if [[ "$STATUS_ONLY" == yes ]]; then
  if [[ -z "$CURRENT" ]]; then
    echo "Eros uses its built-in metadata (StashDB ids) -- matches a StashDB catalog in Peeparr."
  else
    echo "Eros uses a custom metadata source: $CURRENT"
    [[ "$CURRENT" == *"/api/whisparr-metadata/"* ]] && echo "That's Peeparr's TPDB proxy -- matches a TPDB catalog in Peeparr."
  fi
  exit 0
fi

# ---- Check Peeparr's proxy is reachable from here (tpdb) ------------------
if [[ "$CATALOG" == tpdb ]] && command -v curl >/dev/null 2>&1; then
  probe="${PEEPARR_URL%/}/api/whisparr-metadata/site/search?q=test"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$probe" || echo 000)"
  case "$code" in
    200) log "Peeparr's TPDB proxy answers at $PEEPARR_URL" ;;
    503|404) fail "Peeparr is reachable but its TPDB proxy isn't working (HTTP $code): set up TPDB in Peeparr (Settings > Integrations), or update Peeparr if it predates the proxy." ;;
    000) fail "Can't reach $PEEPARR_URL from here. Use an address this machine can reach." ;;
    *) fail "Peeparr's proxy returned HTTP $code for $probe." ;;
  esac
fi

# ---- Edit ------------------------------------------------------------------
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
read_config | sed '/<WhisparrMetadata>/d' > "$TMP"
if [[ "$CATALOG" == tpdb ]]; then
  sed -i "s#</Config>#  <WhisparrMetadata>${PROXY_URL}</WhisparrMetadata>\n</Config>#" "$TMP"
fi

NEW="$(grep -o '<WhisparrMetadata>[^<]*</WhisparrMetadata>' "$TMP" | sed 's/<[^>]*>//g' || true)"
if [[ "$NEW" == "$CURRENT" ]]; then
  log "Already set (${NEW:-built-in StashDB metadata}); nothing to change."
  exit 0
fi

write_config "$TMP"
if [[ "$CATALOG" == tpdb ]]; then
  log "Eros now uses Peeparr's TPDB proxy: $PROXY_URL"
else
  log "Eros now uses its built-in StashDB metadata (override removed)."
fi
log "Backup of the previous config kept next to $CONFIG_PATH"

# ---- Restart ---------------------------------------------------------------
if [[ "$RESTART" == no ]]; then
  log "Restart Eros for the change to take effect."
  exit 0
fi

if [[ -n "$DOCKER_CONTAINER" ]]; then
  docker restart "$DOCKER_CONTAINER" >/dev/null
  log "Restarted container $DOCKER_CONTAINER"
  exit 0
fi

if [[ -z "$SERVICE" ]]; then
  for unit in whisparr-eros whisparr; do
    if systemctl cat "$unit" >/dev/null 2>&1; then
      SERVICE="$unit"
      break
    fi
  done
fi
if [[ -n "$SERVICE" ]]; then
  systemctl restart "$SERVICE"
  log "Restarted $SERVICE"
else
  log "No whisparr systemd unit found -- restart Eros yourself (or pass --service NAME)."
fi

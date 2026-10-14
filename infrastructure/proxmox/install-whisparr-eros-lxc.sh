#!/usr/bin/env bash
# Fresh-install Whisparr-Eros the same way the existing production instance
# was actually installed: via Proxmox VE Community Scripts
# (community-scripts/ProxmoxVE), which provisions its own LXC, downloads
# Whisparr's prebuilt release binary from github.com/Whisparr/Whisparr-Eros
# into /opt/Whisparr-Eros, and runs it as a systemd service
# ("whisparr-eros", data dir /var/lib/whisparr-eros, config.xml inside it).
#
# This is deliberately NOT a from-scratch `pct create` + Docker deployment --
# an earlier version of this script guessed a hotio Docker image, which does
# not match how this install actually works and would have silently produced
# something incompatible with the config-file edit below.
#
# After the community-scripts installer finishes, this script sets Eros'
# metadata source to match the catalog Stasharr uses (scripts/configure-eros.sh
# does the actual edit; see docs/DEPLOYMENT.md):
#
#   CATALOG=tpdb     point Eros' WhisparrMetadata config entry at Stasharr's
#                    self-hosted, TPDB-backed proxy
#                    (<stasharr>/api/whisparr-metadata/{route}). This is the
#                    change made to the original production instance.
#   CATALOG=stashdb  leave Eros on its built-in metadata (api.whisparr.com,
#                    StashDB ids).
#
# Whisparr never talks to TPDB or StashDB directly -- SkyHookProxy.cs calls
# whatever base URL is configured there for every scene/performer/studio
# search.
#
# Run this ON THE PROXMOX HOST as root:
#   CATALOG=tpdb STASHARR_URL=http://10.50.50.201:3000 ./install-whisparr-eros-lxc.sh
#   CATALOG=stashdb ./install-whisparr-eros-lxc.sh
#
# The community-scripts installer is interactive by default (Default vs
# Advanced settings, then CT ID/hostname/disk/cores/RAM/network/storage via
# whiptail). This script auto-detects the resulting CTID by diffing
# `pct list` before/after and applies the metadata choice to it.
#
# To change the choice later (or if auto-detection fails):
#   ../../scripts/configure-eros.sh --ctid <id> --catalog tpdb --stasharr-url http://host:3000
#   ../../scripts/configure-eros.sh --ctid <id> --catalog stashdb
set -euo pipefail

# ---- Configuration (override via env vars) ----
CATALOG="${CATALOG:-}"                 # tpdb | stashdb (asked if unset)
STASHARR_URL="${STASHARR_URL:-}"       # e.g. http://10.50.50.201:3000 (tpdb only)
COMMUNITY_SCRIPT_URL="${COMMUNITY_SCRIPT_URL:-https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/whisparr-eros.sh}"
CONFIGURE_EROS_URL="${CONFIGURE_EROS_URL:-https://raw.githubusercontent.com/John-Butler3/stasharr-portal/add-remove-request/scripts/configure-eros.sh}"

if [[ -z "$CATALOG" ]]; then
  read -r -p "Which catalog does Stasharr use? [tpdb/stashdb]: " CATALOG
fi
case "$CATALOG" in
  tpdb)
    if [[ -z "$STASHARR_URL" ]]; then
      read -r -p "Stasharr URL as Eros will reach it (e.g. http://10.50.50.201:3000): " STASHARR_URL
    fi
    ;;
  stashdb) ;;
  *) echo "error: CATALOG must be tpdb or stashdb." >&2; exit 1 ;;
esac

configure_eros() {
  local ctid="$1"
  local script
  script="$(dirname "$(readlink -f "$0")")/../../scripts/configure-eros.sh"
  if [[ ! -f "$script" ]]; then
    script="$(mktemp)"
    curl -fsSL "$CONFIGURE_EROS_URL" -o "$script"
    chmod +x "$script"
  fi

  echo "==> Waiting for Whisparr-Eros to write its initial config.xml"
  for _ in $(seq 1 30); do
    pct exec "$ctid" -- test -f /var/lib/whisparr-eros/config.xml && break
    sleep 2
  done

  local args=(--ctid "$ctid" --catalog "$CATALOG")
  [[ "$CATALOG" == tpdb ]] && args+=(--stasharr-url "$STASHARR_URL")
  if ! "$script" "${args[@]}"; then
    echo "warning: couldn't apply the metadata setting yet. Once Stasharr (and its TPDB" >&2
    echo "         integration) is reachable from CT $ctid, re-run:" >&2
    echo "         $script ${args[*]}" >&2
  fi
}

if ! command -v pct >/dev/null 2>&1; then
  echo "error: 'pct' not found. Run this script on the Proxmox VE host, not inside a container." >&2
  exit 1
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "error: run as root." >&2
  exit 1
fi

BEFORE_CTIDS="$(pct list | awk 'NR>1{print $1}' | sort)"

echo "==> Launching the official Whisparr-Eros installer (community-scripts/ProxmoxVE)."
echo "    This prompts interactively -- answer it the same way you did for the"
echo "    existing instance (Default settings is fine unless you need to match"
echo "    specific resource/network choices)."
echo
bash -c "$(curl -fsSL "$COMMUNITY_SCRIPT_URL")"

AFTER_CTIDS="$(pct list | awk 'NR>1{print $1}' | sort)"
NEW_CTID="$(comm -13 <(echo "$BEFORE_CTIDS") <(echo "$AFTER_CTIDS") | head -1)"

if [[ -z "$NEW_CTID" ]]; then
  cat <<MSG >&2

warning: couldn't auto-detect the new CTID from 'pct list'.
Find it yourself (it'll be the newest entry), then run:
  scripts/configure-eros.sh --ctid <id> --catalog $CATALOG ${STASHARR_URL:+--stasharr-url $STASHARR_URL}
MSG
  exit 0
fi

echo "==> Detected new container: CTID $NEW_CTID"
configure_eros "$NEW_CTID"

CT_IP="$(pct exec "$NEW_CTID" -- hostname -I | awk '{print $1}')"

cat <<SUMMARY

==> Done.
    Container:     CTID $NEW_CTID
    Service:       whisparr-eros (systemd) at /opt/Whisparr-Eros, data in /var/lib/whisparr-eros
    Metadata:      ${CATALOG} $( [[ "$CATALOG" == tpdb ]] && echo "(via ${STASHARR_URL}/api/whisparr-metadata/{route})" || echo "(Eros built-in)")

    Open http://${CT_IP}:6969 to finish setup (root folders, indexers,
    connect it to Stasharr's Whisparr integration with a fresh API key from
    Settings > General -- the API key is per-install and won't match any
    old one you had saved).
SUMMARY

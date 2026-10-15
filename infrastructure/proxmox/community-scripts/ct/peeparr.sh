#!/usr/bin/env bash
# Peeparr isn't in the community-scripts catalogue: load ct/ and install/
# from this repository instead (the engine still comes from community-scripts/core).
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/John-Butler3/Peeparr/main/infrastructure/proxmox/community-scripts}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2021-2026 community-scripts ORG
# Author: John-Butler3
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/John-Butler3/Peeparr

APP="Peeparr"
var_tags="${var_tags:-arr}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-3072}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-no}"
var_unprivileged="${var_unprivileged:-1}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/peeparr ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  if check_for_gh_branch "peeparr" "John-Butler3/Peeparr" "main"; then
    msg_info "Stopping Service"
    systemctl stop peeparr
    msg_ok "Stopped Service"

    msg_info "Backing up Configuration"
    cp /opt/peeparr/.env /opt/peeparr.env.bak
    msg_ok "Backed up Configuration"

    fetch_and_deploy_gh_branch "peeparr" "John-Butler3/Peeparr" "main" "/opt/peeparr"

    msg_info "Restoring Configuration"
    cp /opt/peeparr.env.bak /opt/peeparr/.env
    rm -f /opt/peeparr.env.bak
    msg_ok "Restored Configuration"

    msg_info "Building Peeparr (Patience)"
    cd /opt/peeparr
    export NODE_OPTIONS="--max-old-space-size=2048"
    set -a
    source /opt/peeparr/.env
    set +a
    $STD pnpm install --frozen-lockfile
    $STD ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
    $STD pnpm --filter sp-api build
    $STD pnpm --filter sp-web build
    cp infrastructure/docker/reset-password.sh /usr/local/bin/peeparr-reset-password
    chmod +x /usr/local/bin/peeparr-reset-password
    msg_ok "Built Peeparr"

    msg_info "Securing Service"
    # Installs from before this ran Peeparr as root: give it its own user.
    useradd --system --home-dir /var/lib/peeparr --shell /usr/sbin/nologin peeparr 2>/dev/null || true
    mkdir -p /var/lib/peeparr
    chown -R peeparr:peeparr /var/lib/peeparr
    chmod 700 /var/lib/peeparr
    if ! grep -q '^User=peeparr' /etc/systemd/system/peeparr.service; then
      sed -i 's|^Type=simple$|Type=simple\nUser=peeparr\nGroup=peeparr|; s|^RestartSec=5$|RestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\nProtectHome=true\nReadWritePaths=/var/lib/peeparr|' /etc/systemd/system/peeparr.service
      systemctl daemon-reload
    fi
    msg_ok "Secured Service"

    msg_info "Starting Service"
    systemctl start peeparr
    msg_ok "Started Service"
    msg_ok "Updated successfully!"
  fi
  exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3000${CL}"

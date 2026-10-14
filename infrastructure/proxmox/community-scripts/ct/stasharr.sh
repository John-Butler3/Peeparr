#!/usr/bin/env bash
# Stasharr isn't in the community-scripts catalogue: load ct/ and install/
# from this repository instead (the engine still comes from community-scripts/core).
export COMMUNITY_SCRIPTS_URL="${COMMUNITY_SCRIPTS_URL:-https://raw.githubusercontent.com/John-Butler3/stasharr-portal/add-remove-request/infrastructure/proxmox/community-scripts}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2021-2026 community-scripts ORG
# Author: John-Butler3
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/John-Butler3/stasharr-portal

APP="Stasharr"
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

  if [[ ! -d /opt/stasharr ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  if check_for_gh_branch "stasharr" "John-Butler3/stasharr-portal" "add-remove-request"; then
    msg_info "Stopping Service"
    systemctl stop stasharr
    msg_ok "Stopped Service"

    msg_info "Backing up Configuration"
    cp /opt/stasharr/.env /opt/stasharr.env.bak
    msg_ok "Backed up Configuration"

    fetch_and_deploy_gh_branch "stasharr" "John-Butler3/stasharr-portal" "add-remove-request" "/opt/stasharr"

    msg_info "Restoring Configuration"
    cp /opt/stasharr.env.bak /opt/stasharr/.env
    rm -f /opt/stasharr.env.bak
    msg_ok "Restored Configuration"

    msg_info "Building Stasharr (Patience)"
    cd /opt/stasharr
    export NODE_OPTIONS="--max-old-space-size=2048"
    set -a
    source /opt/stasharr/.env
    set +a
    $STD pnpm install --frozen-lockfile
    $STD ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
    $STD pnpm --filter sp-api build
    $STD pnpm --filter sp-web build
    cp infrastructure/docker/reset-password.sh /usr/local/bin/stasharr-reset-password
    chmod +x /usr/local/bin/stasharr-reset-password
    msg_ok "Built Stasharr"

    msg_info "Starting Service"
    systemctl start stasharr
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

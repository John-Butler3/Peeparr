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
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-yes}"
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

  if ! command -v pnpm >/dev/null; then
    NODE_VERSION="22" NODE_MODULE="pnpm@$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/package.json | jq -r '.packageManager | split("@")[1]')" setup_nodejs
  fi

  if check_for_gh_release "peeparr" "John-Butler3/Peeparr"; then
    msg_info "Stopping Service"
    systemctl stop peeparr
    msg_ok "Stopped Service"

    create_backup /opt/peeparr/.env

    CLEAN_INSTALL=1 fetch_and_deploy_gh_release "peeparr" "John-Butler3/Peeparr" "prebuild" "latest" "/opt/peeparr" "peeparr-*.tar.gz"

    restore_backup

    msg_info "Updating Peeparr"
    cd /opt/peeparr
    if grep -q '^PEEPARR_VERSION=' .env; then
      sed -i "s|^PEEPARR_VERSION=.*|PEEPARR_VERSION=$(cat VERSION)|" .env
    else
      echo "PEEPARR_VERSION=$(cat VERSION)" >>.env
    fi
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    set -a
    source /opt/peeparr/.env
    set +a
    $STD pnpm install --prod --frozen-lockfile --filter . --filter sp-api
    $STD ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
    ln -sf /opt/peeparr/bin/peeparr-reset-password /usr/local/bin/peeparr-reset-password
    msg_ok "Updated Peeparr"

    if ! grep -q '^User=peeparr' /etc/systemd/system/peeparr.service; then
      msg_info "Securing Service"
      # Installs from before this ran Peeparr as root: give it its own user.
      useradd --system --home-dir /var/lib/peeparr --shell /usr/sbin/nologin peeparr 2>/dev/null || true
      mkdir -p /var/lib/peeparr
      chown -R peeparr:peeparr /var/lib/peeparr
      chmod 700 /var/lib/peeparr
      sed -i 's|^Type=simple$|Type=simple\nUser=peeparr\nGroup=peeparr|; s|^RestartSec=5$|RestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\nProtectHome=true\nReadWritePaths=/var/lib/peeparr|' /etc/systemd/system/peeparr.service
      systemctl daemon-reload
      msg_ok "Secured Service"
    fi

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

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3000${CL}"
echo -e "${INFO}${YW} Behind a reverse proxy? Choose it under Remote access in setup (or Settings > Account).${CL}"

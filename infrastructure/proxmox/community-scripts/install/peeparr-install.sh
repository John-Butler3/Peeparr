#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: John-Butler3
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/John-Butler3/Peeparr

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y openssl
msg_ok "Installed Dependencies"

NODE_VERSION="22" NODE_MODULE="pnpm@$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/package.json | jq -r '.packageManager | split("@")[1]')" setup_nodejs
PG_VERSION="17" setup_postgresql
PG_DB_NAME="peeparr" PG_DB_USER="peeparr" setup_postgresql_db
fetch_and_deploy_gh_release "peeparr" "John-Butler3/Peeparr" "prebuild" "latest" "/opt/peeparr" "peeparr-*.tar.gz"

msg_info "Configuring Peeparr"
useradd --system --home-dir /var/lib/peeparr --shell /usr/sbin/nologin peeparr
mkdir -p /var/lib/peeparr
chown peeparr:peeparr /var/lib/peeparr
chmod 700 /var/lib/peeparr
cat <<EOF >/opt/peeparr/.env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://${PG_DB_USER}:${PG_DB_PASS}@localhost:5432/${PG_DB_NAME}?schema=public
SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\r\n')
APP_DATA_DIR=/var/lib/peeparr
PEEPARR_VERSION=$(cat /opt/peeparr/VERSION)
# Behind a reverse proxy: choose it under Remote access in setup, or set the
# proxy's hop count or address here (see docs/DEPLOYMENT.md).
# PEEPARR_TRUST_PROXY=1
EOF
chmod 600 /opt/peeparr/.env
msg_ok "Configured Peeparr"

msg_info "Installing Peeparr"
cd /opt/peeparr
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
set -a
source /opt/peeparr/.env
set +a
$STD pnpm install --prod --frozen-lockfile --filter . --filter sp-api
$STD ./node_modules/.bin/prisma generate --schema prisma/schema.prisma
ln -sf /opt/peeparr/bin/peeparr-reset-password /usr/local/bin/peeparr-reset-password
msg_ok "Installed Peeparr"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/peeparr.service
[Unit]
Description=Peeparr
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=peeparr
Group=peeparr
WorkingDirectory=/opt/peeparr
EnvironmentFile=/opt/peeparr/.env
ExecStartPre=/opt/peeparr/node_modules/.bin/prisma migrate deploy --schema /opt/peeparr/prisma/schema.prisma
ExecStart=/usr/bin/node /opt/peeparr/apps/sp-api/dist/main.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/peeparr

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now peeparr
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc

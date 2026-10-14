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

NODE_VERSION="22" setup_nodejs
PG_VERSION="17" setup_postgresql
PG_DB_NAME="peeparr" PG_DB_USER="peeparr" setup_postgresql_db

fetch_and_deploy_gh_branch "peeparr" "John-Butler3/Peeparr" "main" "/opt/peeparr"

msg_info "Configuring Peeparr"
mkdir -p /var/lib/peeparr
chmod 700 /var/lib/peeparr
cat <<EOF >/opt/peeparr/.env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_URL=postgresql://${PG_DB_USER}:${PG_DB_PASS}@localhost:5432/${PG_DB_NAME}?schema=public
SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\r\n')
APP_DATA_DIR=/var/lib/peeparr
# Set to true once Peeparr is served over HTTPS.
SESSION_COOKIE_SECURE=false
EOF
chmod 600 /opt/peeparr/.env
msg_ok "Configured Peeparr"

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

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/peeparr.service
[Unit]
Description=Peeparr
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
WorkingDirectory=/opt/peeparr
EnvironmentFile=/opt/peeparr/.env
ExecStartPre=/opt/peeparr/node_modules/.bin/prisma migrate deploy --schema /opt/peeparr/prisma/schema.prisma
ExecStart=/usr/bin/node /opt/peeparr/apps/sp-api/dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now peeparr
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc

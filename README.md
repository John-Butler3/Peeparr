# Stasharr

Stasharr is a self-hosted console that discovers scenes from a supported catalog provider, sends acquisitions to Whisparr, and validates availability against your local Stash library.

[![Latest release](https://img.shields.io/github/v/release/enymawse/stasharr-portal?display_name=tag&sort=semver&style=for-the-badge)](https://github.com/enymawse/stasharr-portal/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/enymawse/stasharr-portal/ci.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/enymawse/stasharr-portal/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/enymawse/stasharr-portal?&style=for-the-badge)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-0f766e?&style=for-the-badge)](#self-hosted-quick-start)
[![Deploy: Docker Compose](https://img.shields.io/badge/deploy-Docker%20Compose-2496ED?logo=docker&logoColor=white&style=for-the-badge)](#self-hosted-quick-start)
[![Auth: local admin](https://img.shields.io/badge/auth-local%20admin-475569?&style=for-the-badge)](#self-hosted-quick-start)

## What Stasharr Does

- Discover scenes through a configured catalog provider during first-run setup.
- Submit and track acquisition requests through Whisparr.
- Check local Stash availability so you can see what is already in your library.

## What You Need

- A Linux machine (or Proxmox LXC) with Docker, or a Debian/Ubuntu machine the installer can put Docker on
- An existing Stash instance that Stasharr can reach
- An existing Whisparr (Eros) instance that Stasharr can reach
- A supported catalog provider to configure during setup: StashDB, FansDB or TPDB

## Self-Hosted Quick Start

This fork is built from source (the upstream `ghcr.io/enymawse/stasharr-portal` image doesn't include its features). On a Debian/Ubuntu machine, as root:

```bash
curl -fsSL https://raw.githubusercontent.com/John-Butler3/stasharr-portal/add-remove-request/scripts/install.sh | bash
```

That installs Docker if needed, builds the app, writes `/opt/stasharr/compose.yaml` and a private `/opt/stasharr/.env` with a random database password, starts everything and prints the address. On Proxmox, use the [Proxmox VE Helper-Scripts](https://community-scripts.github.io/ProxmoxVE/)-style installer instead -- run this in the Proxmox shell for a native (no Docker) LXC:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/stasharr-portal/add-remove-request/infrastructure/proxmox/community-scripts/ct/stasharr.sh)"
```

Open `http://<host>:3000`. The first visit asks you to create the single local admin account; after that, sign-in is required.

**Using TPDB as the catalog?** Whisparr-Eros must then use Stasharr's TPDB metadata proxy instead of its built-in StashDB metadata -- run `scripts/configure-eros.sh --catalog tpdb --stasharr-url http://<host>:3000`. With StashDB, a stock Eros works as-is.

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for all options, Proxmox, updating, backups, password reset and the full Whisparr-Eros explanation.

If catalog Save & Test repeatedly fails with `ETIMEDOUT` on an IPv4-only Docker network, uncomment `NODE_OPTIONS=--no-network-family-autoselection` in `/opt/stasharr/.env` and run `stasharr-update`.

## Updating

```bash
stasharr-update
```

Rebuilds from the latest commits of the deployed branch and restarts. Stasharr applies Prisma migrations automatically when the app container starts.

## Rollback

Deploy an earlier branch or commit from the source checkout (`/opt/stasharr-src`), e.g. `stasharr-update -b <branch>`. Rolling back the app does not roll back database schema changes, so take a backup before updating and restore it if an older build can't start against the migrated schema.

## Backups

Keep `/opt/stasharr/.env`, `/opt/stasharr/compose.yaml` and the Docker volumes `stasharr_postgres_data` and `stasharr_app_data` (generated session secret). A logical database dump:

```bash
cd /opt/stasharr
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > stasharr-backup.sql
```

## Local Development

To run the repo locally for development:

- install dependencies with `pnpm install`
- copy `.env.example` to `.env` and set `SESSION_SECRET`
- start Postgres with `pnpm run dev:db`
- run the backend with `pnpm run backend`
- run the frontend with `pnpm run web`

If an older local database says migration `20260402142846` was modified after it was applied, run `pnpm run db:repair-runtime-health-migration` once, then rerun `pnpm prisma migrate dev`.

## Contributing

For repo structure, release automation, CI expectations, PR conventions, and contributor deployment notes, see [CONTRIBUTING.md](CONTRIBUTING.md).

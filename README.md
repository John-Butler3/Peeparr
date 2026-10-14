<p align="center">
  <img src="apps/sp-web/public/favicon.svg" width="140" alt="Peeparr logo" />
</p>

<h1 align="center">Peeparr</h1>

<p align="center">
Peeparr is a self-hosted console that discovers scenes from a supported catalog provider, sends acquisitions to Whisparr, and validates availability against your local Stash library.
</p>

<p align="center">

[![Latest release](https://img.shields.io/github/v/release/John-Butler3/Peeparr?display_name=tag&sort=semver&style=for-the-badge)](https://github.com/John-Butler3/Peeparr/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/John-Butler3/Peeparr/ci.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/John-Butler3/Peeparr/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/John-Butler3/Peeparr?&style=for-the-badge)](LICENSE)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-0f766e?&style=for-the-badge)](#self-hosted-quick-start)
[![Deploy: Docker Compose](https://img.shields.io/badge/deploy-Docker%20Compose-2496ED?logo=docker&logoColor=white&style=for-the-badge)](#self-hosted-quick-start)
[![Auth: local admin](https://img.shields.io/badge/auth-local%20admin-475569?&style=for-the-badge)](#self-hosted-quick-start)

</p>

## What Peeparr Does

- Discover scenes through a configured catalog provider during first-run setup.
- Submit and track acquisition requests through Whisparr.
- Check local Stash availability so you can see what is already in your library.

## What You Need

- A Linux machine (or Proxmox LXC) with Docker, or a Debian/Ubuntu machine the installer can put Docker on
- An existing Stash instance that Peeparr can reach
- An existing Whisparr (Eros) instance that Peeparr can reach
- A supported catalog provider to configure during setup: StashDB, FansDB or TPDB

## Self-Hosted Quick Start

Peeparr is built from source on the machine it runs on. On a Debian/Ubuntu machine, as root:

```bash
curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/scripts/install.sh | bash
```

That installs Docker if needed, builds the app, writes `/opt/peeparr/compose.yaml` and a private `/opt/peeparr/.env` with a random database password, starts everything and prints the address. On Proxmox, use the [Proxmox VE Helper-Scripts](https://community-scripts.github.io/ProxmoxVE/)-style installer instead -- run this in the Proxmox shell for a native (no Docker) LXC:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/infrastructure/proxmox/community-scripts/ct/peeparr.sh)"
```

Open `http://<host>:3000`. The first visit asks you to create the single local admin account; after that, sign-in is required.

**Using TPDB as the catalog?** Whisparr-Eros must then use Peeparr's TPDB metadata proxy instead of its built-in StashDB metadata -- run `scripts/configure-eros.sh --catalog tpdb --peeparr-url http://<host>:3000`. With StashDB, a stock Eros works as-is.

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for all options, Proxmox, updating, backups, password reset and the full Whisparr-Eros explanation.

If catalog Save & Test repeatedly fails with `ETIMEDOUT` on an IPv4-only Docker network, uncomment `NODE_OPTIONS=--no-network-family-autoselection` in `/opt/peeparr/.env` and run `peeparr-update`.

## Updating

```bash
peeparr-update
```

Rebuilds from the latest commits of the deployed branch and restarts. Peeparr applies Prisma migrations automatically when the app container starts.

## Rollback

Deploy an earlier branch or commit from the source checkout (`/opt/peeparr-src`), e.g. `peeparr-update -b <branch>`. Rolling back the app does not roll back database schema changes, so take a backup before updating and restore it if an older build can't start against the migrated schema.

## Backups

Keep `/opt/peeparr/.env`, `/opt/peeparr/compose.yaml` and the Docker volumes `peeparr_postgres_data` and `peeparr_app_data` (generated session secret). A logical database dump:

```bash
cd /opt/peeparr
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > peeparr-backup.sql
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

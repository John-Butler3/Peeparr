<p align="center">
  <img src="docs/assets/logo-animated.svg" width="300" alt="Peeparr logo" />
</p>

<h1 align="center">Peeparr</h1>

<p align="center">
A self-hosted hub for your adult library, alongside Stash and Whisparr: discover scenes, request them, follow the downloads and watch, all in one place.
</p>

<p align="center">
<b>Stash front-end</b> · <b>Whisparr request manager</b> · <b>StashDB / FansDB / ThePornDB discovery</b> · <b>Docker &amp; Proxmox</b>
</p>

<p align="center">

[![Latest release](https://img.shields.io/github/v/release/John-Butler3/Peeparr?display_name=tag&sort=semver&style=for-the-badge)](https://github.com/John-Butler3/Peeparr/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/John-Butler3/Peeparr/ci.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/John-Butler3/Peeparr/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/John-Butler3/Peeparr?&style=for-the-badge)](LICENSE)

</p>

<p align="center">
  <img src="docs/assets/peeparr-ad.gif" alt="Peeparr in use: search for scenes, request them, follow the downloads, and watch, on desktop and on a phone" width="100%" />
</p>

## What is Peeparr?

Peeparr is a free, open-source (GPL-3.0), self-hosted web app for managing and
watching an adult video library. It sits on top of
[Stash](https://github.com/stashapp/stash), the adult media organiser, and
[Whisparr](https://github.com/Whisparr/Whisparr), the adult counterpart of
Sonarr and Radarr: you discover scenes in the StashDB, FansDB or ThePornDB
catalog, request them with one tap, follow each download into your library,
and watch them in a player built for phones as much as desktops.

If you know Overseerr or Jellyseerr for Plex and Jellyfin, Peeparr plays that
part for Stash and Whisparr, and adds the player and library browsing as well.
It runs on your own server (Docker, or a Proxmox LXC); nothing is sent to a
cloud service.

Questions about how it fits with your setup? See **[Common questions](docs/FAQ.md)**.

## How it fits together

| | Peeparr's part |
| --- | --- |
| **Stash** | Your library: Peeparr plays it, browses it and keeps up with what's new. |
| **StashDB, FansDB or ThePornDB** | The catalog (chosen at setup), for discovering scenes, performers and studios. |
| **Whisparr (v2 or Eros)** | Downloads: Peeparr sends requests and follows each one into Stash. |

## Features

**Discover and request**
- Browse the catalog by popular, latest or oldest; filter by tags, studios and favourites.
- Popular scenes, performers and sites from ThePornDB, on Home and as the default order.
- One-tap requests, with each scene's status: requested, downloading, importing, failed or in your library.
- Monitor performers to request their new scenes automatically.
- Acquisition: every request in the pipeline, failures first.
- Upcoming: a calendar of future releases from your requests and favourites.
- Search performers, studios and scenes from one box, with results as you type.

**Watch**
- Plays your Stash library, with previews on hover or while scrolling.
- Video quality for slow connections: original, 1080p, 720p, 480p or 240p (converted by Stash as you watch).
- Resume where you stopped, on any device; continue watching on Home; mark as watched or unwatched.
- Up next and series (from Stash groups), played in order.
- Miniplayer, picture-in-picture, lock-screen controls and AirPlay.
- Optional: scenes that are Pornhub videos (per ThePornDB) stream in Pornhub's embedded player, without being in your library.
- Galleries with a full-resolution, zoomable photo viewer.

**Library and home**
- Home: newest scenes, continue watching, fresh in your library, popular now.
- Library, Galleries and Series browsing with filters.
- Performer and studio pages with favourites.

**Setup and security**
- Guided setup for Stash, Whisparr and the catalog, with connection checks and repair hints.
- One local admin account, password reset from the server.
- Reverse-proxy ready: remote-access option in setup, security headers, cross-site request protection.
- Discreet mode: a plain logo and home-screen icon, per device.
- Works on phones like an app (add to home screen), with swipe gestures.

## Screenshots

| Home | Scene |
| --- | --- |
| ![Peeparr home screen: a banner of new and unwatched scenes, then rows to continue watching](docs/screenshots/home.png) | ![Peeparr scene page: the player, the scene's details, request status and similar scenes](docs/screenshots/scene.png) |
| **Discover** | **Acquisition** |
| ![Browsing the StashDB or ThePornDB catalog with filters and request buttons](docs/screenshots/scenes.png) | ![Every requested scene in the Whisparr pipeline, from requested to in the library](docs/screenshots/acquisition.png) |

<p align="center">
  <img src="docs/screenshots/phone-home.png" width="24%" alt="Peeparr on a phone: home screen" />
  <img src="docs/screenshots/phone-scene.png" width="24%" alt="Peeparr on a phone: watching a scene" />
  <img src="docs/screenshots/phone-scene-docked.png" width="24%" alt="Peeparr on a phone: the scene in the miniplayer while browsing" />
  <img src="docs/screenshots/phone-search.png" width="24%" alt="Peeparr on a phone: search with live results" />
</p>

## What you need

- A Linux machine with Docker, or a Proxmox VE host
- Stash and Whisparr (Eros, or v2 with ThePornDB as the catalog) that Peeparr can reach
- A catalog account: StashDB, FansDB or ThePornDB

## Install

**Proxmox VE** (native LXC, no Docker), in the Proxmox shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/infrastructure/proxmox/community-scripts/ct/peeparr.sh)"
```

**Docker** (Debian/Ubuntu, as root):

```bash
curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/scripts/install.sh | bash
```

Then open `http://<host>:3000` and create the admin account.

- **ThePornDB as the catalog:** Whisparr-Eros needs Peeparr's metadata proxy; setup shows the command.
- **Whisparr v2:** detected and used as it is.
- **From outside your home:** a VPN, or a reverse proxy with HTTPS ([Behind a reverse proxy](docs/DEPLOYMENT.md#behind-a-reverse-proxy)).

All options: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Updating and backups

- **Proxmox LXC:** run `update` in the container (installs the latest release).
- **Docker:** run `peeparr-update`.

Database migrations apply automatically. Back up the database (Docker volumes `peeparr_postgres_data` and `peeparr_app_data`, or PostgreSQL in the LXC) and `/opt/peeparr/.env` before updating; rolling back the app doesn't roll back the database.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

Peeparr is built on [Stasharr Portal](https://github.com/enymawse/stasharr-portal) by [enymawse](https://github.com/enymawse), also released under the GPL-3.0. Its releases are listed at the end of the [changelog](CHANGELOG.md#before-peeparr).

## License

[GPL-3.0](LICENSE)

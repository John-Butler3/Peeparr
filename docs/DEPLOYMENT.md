# Deploying Peeparr

Peeparr is built from source on the machine it runs on. The helper
scripts here do that for you.

| Script | Run on | Does |
| --- | --- | --- |
| [`scripts/install.sh`](../scripts/install.sh) | any Debian/Ubuntu host (or any Linux with Docker) | installs / updates Peeparr |
| [`infrastructure/proxmox/community-scripts/ct/peeparr.sh`](../infrastructure/proxmox/community-scripts/ct/peeparr.sh) | the Proxmox shell | Proxmox VE Helper-Scripts-style LXC install / update (native, no Docker) |
| [`scripts/deploy-container.sh`](../scripts/deploy-container.sh) (`peeparr-update`) | the Peeparr host | rebuilds + restarts from the latest commits |
| [`scripts/configure-eros.sh`](../scripts/configure-eros.sh) | Eros host, Proxmox host or anywhere with SSH | points Whisparr-Eros at the right metadata source |
| [`infrastructure/proxmox/install-whisparr-eros-lxc.sh`](../infrastructure/proxmox/install-whisparr-eros-lxc.sh) | a Proxmox host | installs Eros (community-scripts) and applies the metadata choice |

## Fresh install

### Any Linux machine

As root on a Debian/Ubuntu machine (Docker is installed if missing):

```bash
curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/scripts/install.sh | bash
```

Options (flags or environment variables): `--port 3000`, `--branch
main`, `--install-dir /opt/peeparr`, `--src-dir
/opt/peeparr-src`. It:

- clones the source to `/opt/peeparr-src` and builds `peeparr:custom`
- writes `/opt/peeparr/compose.yaml` (from
  [`infrastructure/compose/compose.selfbuild.yaml`](../infrastructure/compose/compose.selfbuild.yaml))
  and, the first time only, `/opt/peeparr/.env` with a random database
  password (mode 600)
- starts Postgres + Peeparr and waits until the app is healthy
- installs `peeparr-update` and `peeparr-reset-password` into `/usr/local/bin`

Re-running it is safe: your `.env`, database and settings are kept.

### Proxmox (Helper-Scripts style)

Written like the [Proxmox VE Helper-Scripts](https://community-scripts.github.io/ProxmoxVE/)
(`ct/` + `install/` + `json/`, using the community-scripts `build.func`
engine), in [`infrastructure/proxmox/community-scripts`](../infrastructure/proxmox/community-scripts).
In the Proxmox shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/infrastructure/proxmox/community-scripts/ct/peeparr.sh)"
```

You get the familiar Default / Advanced settings dialog (CT ID, hostname,
disk, CPU, RAM, network, storage). Defaults: Debian 13, 2 cores, 3 GB RAM,
8 GB disk, unprivileged. Building the app needs the RAM; you can lower it
afterwards. Inside the container the app runs natively -- no Docker:

| | |
| --- | --- |
| App | `/opt/peeparr` (git checkout of `main`) |
| Settings | `/opt/peeparr/.env` (database URL, session secret, port) |
| Database | PostgreSQL 17 in the container; credentials in `~/peeparr.creds` |
| Service | `systemctl status peeparr`, logs: `journalctl -u peeparr -f` |
| Data | `/var/lib/peeparr` ("Forgot password?" temporary password) |

**Update:** run the same command again *inside the container's console*.
It checks the branch for new commits, rebuilds and restarts; `.env` is kept.
The usual Helper-Scripts `update` shortcut in the container should do the
same (it isn't listed on the community-scripts website, so the shortcut
falls back to this repository's script).

**Backup:** use Proxmox backups of the LXC, or
`sudo -u postgres pg_dump peeparr > peeparr-backup.sql` inside it.

### After installing

1. Open `http://<host>:3000` and create the admin account.
2. Connect the catalog (StashDB, FansDB or TPDB), Stash and Whisparr.
3. If Whisparr-Eros should use TPDB, set it up as in
   [Whisparr-Eros and the catalog choice](#whisparr-eros-and-the-catalog-choice).

## Updating

Docker installs (`install.sh`):

```bash
peeparr-update                     # latest commits of the deployed branch
peeparr-update -b some-branch      # switch branch
```

Proxmox Helper-Scripts installs: run the `ct/peeparr.sh` command (or
`update`) in the container's console.

(On older installs without the helper:
`cd /opt/peeparr-src && ./scripts/deploy-container.sh [-b branch]`.)
Database migrations run automatically when the app starts.

## Forgotten password

Click **Forgot password?** on the sign-in page. That creates a single-use
temporary password (valid 15 minutes) without changing the current one. On
the Peeparr host run:

```bash
peeparr-reset-password
# Docker, without the helper: docker exec <app-container> peeparr-reset-password
```

Signing in with it makes it the account password and opens Settings ›
Account to choose a new one.

## Backups

For Docker installs, keep `/opt/peeparr/.env`, `/opt/peeparr/compose.yaml` and the two Docker
volumes (`peeparr_postgres_data`, `peeparr_app_data`). A logical database
dump:

```bash
cd /opt/peeparr
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > peeparr-backup.sql
```

## Whisparr-Eros and the catalog choice

### What we changed

Peeparr looks scenes up in Whisparr by the **catalog's scene id**. Whisparr
itself never talks to StashDB or TPDB: every scene / performer / studio
search goes to its *metadata service*, the `WhisparrMetadata` URL in Eros'
`config.xml` (default `https://api.whisparr.com/v4/{route}`), and that
service speaks **StashDB ids**.

The original install uses **TPDB** as Peeparr's catalog, so Eros was
changed to use Peeparr's own TPDB-backed metadata proxy instead:

```xml
<WhisparrMetadata>http://<host>:3000/api/whisparr-metadata/{route}</WhisparrMetadata>
```

The proxy ([`apps/sp-api/src/whisparr-metadata`](../apps/sp-api/src/whisparr-metadata))
answers Eros' scene / performer / site routes with TPDB data, putting TPDB ids
where Eros expects its scene id, so the ids Peeparr sends and the ids Eros
stores match. (JAV "movie" routes aren't implemented.)

### What that means for each deployment

| Peeparr catalog | Eros metadata | Do |
| --- | --- | --- |
| **TPDB** | Peeparr's proxy | `configure-eros.sh --catalog tpdb --peeparr-url http://<peeparr>:3000` |
| **StashDB** | Eros built-in (default) | nothing on a fresh Eros, or `configure-eros.sh --catalog stashdb` to undo an override |
| FansDB | — | not supported by Eros' metadata service; requests won't match in Eros |

Things to know when Eros uses the proxy:

- **Peeparr must be running and reachable from Eros**, at the URL you give.
  If Peeparr is down or moves, Eros' searches and metadata refreshes fail.
  If Peeparr's address changes, re-run `configure-eros.sh` with the new URL.
- **Peeparr needs a working TPDB integration** (API key) even if its
  catalog setting is something else. The proxy uses that key; Eros needs no
  key of its own.
- The proxy routes have no login (Eros can't sign in), so keep Peeparr on a
  trusted network rather than exposed to the internet.
- **Don't switch an existing Eros between the two.** Scenes already in Eros
  are stored with the old kind of id; after switching they won't match
  Peeparr's requests or refresh correctly. Pick one per Eros install (switch
  only on an empty / fresh Eros).
- The change is a plain config edit, so Eros updates keep it; a reinstall or
  a reset `config.xml` loses it -- re-run `configure-eros.sh`.

### configure-eros.sh

When ThePornDB is the catalog, Peeparr's setup page (and Settings ›
Integrations) shows these steps with your Peeparr address filled in. The
script needs no checkout of Peeparr's source: download it and run it on the
Eros machine:

```bash
curl -fsSLO https://raw.githubusercontent.com/John-Butler3/Peeparr/main/scripts/configure-eros.sh
bash configure-eros.sh --catalog tpdb --peeparr-url http://<peeparr>:3000
```

Every way to run it:

```bash
# On the Eros machine (community-scripts LXC or any systemd install)
./configure-eros.sh --catalog tpdb --peeparr-url http://<host>:3000
./configure-eros.sh --catalog stashdb
./configure-eros.sh --status

# From the Proxmox host, against an Eros container
./configure-eros.sh --ctid <ctid> --catalog tpdb --peeparr-url http://<host>:3000

# Over SSH, or for Eros in Docker (run on the Docker host)
./configure-eros.sh --ssh root@eros-host --catalog tpdb --peeparr-url http://<host>:3000
./configure-eros.sh --docker whisparr --catalog tpdb --peeparr-url http://<host>:3000
```

For `tpdb` it first checks, from the Eros side, that Peeparr's proxy answers
and that TPDB is set up in Peeparr; it then backs up `config.xml`
(`config.xml.bak.<timestamp>`), sets or removes `<WhisparrMetadata>`, and
restarts Eros.

A new Eros LXC can be installed and configured in one go on Proxmox:

```bash
CATALOG=tpdb PEEPARR_URL=http://<host>:3000 ./infrastructure/proxmox/install-whisparr-eros-lxc.sh
CATALOG=stashdb ./infrastructure/proxmox/install-whisparr-eros-lxc.sh
```

Then, in Eros, add root folders and indexers, and copy its API key
(Settings › General) into Peeparr's Whisparr integration.

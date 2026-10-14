# Peeparr for Proxmox VE (Helper-Scripts style)

Written to the same layout and conventions as the
[Proxmox VE Helper-Scripts](https://github.com/community-scripts/ProxmoxVE)
so it behaves like any other script there and could be submitted upstream:

| File | Role |
| --- | --- |
| `ct/peeparr.sh` | run in the Proxmox shell: creates the LXC (Default / Advanced dialog) and, run inside an existing container, updates it |
| `install/peeparr-install.sh` | runs inside the new LXC: Node.js 22, PostgreSQL 17, builds Peeparr from the `main` branch, systemd service `peeparr` |
| `json/peeparr.json` | website metadata (category 14, *Arr Suite) |

Install:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/John-Butler3/Peeparr/main/infrastructure/proxmox/community-scripts/ct/peeparr.sh)"
```

Both scripts load the shared engine (`build.func`, `install.func`,
`setup_nodejs`, `setup_postgresql`, `fetch_and_deploy_gh_branch`, ...) from
[community-scripts/core](https://github.com/community-scripts/core).
The only difference from an upstream script is the `COMMUNITY_SCRIPTS_URL`
line at the top of `ct/peeparr.sh`, which makes the engine fetch
`install/peeparr-install.sh` from this repository. If the scripts are ever
submitted upstream, drop that line and the files move as-is to `ct/`,
`install/` and `json/` there.

For Whisparr-Eros (installed with the upstream `ct/whisparr-eros.sh`), see
`../install-whisparr-eros-lxc.sh`, `../../../scripts/configure-eros.sh` and
`docs/DEPLOYMENT.md` ("Whisparr-Eros and the catalog choice").

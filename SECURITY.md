# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use
GitHub's **[Report a vulnerability](https://github.com/John-Butler3/Peeparr/security/advisories/new)**
form (Security tab › Advisories). Include what you found, how to reproduce
it and the version you tested. You'll get a reply as soon as possible, and
credit in the fix if you'd like it.

## Supported versions

Fixes go into the latest release. Update with `peeparr-update`.

## Running Peeparr safely

- A VPN is the simplest way to reach Peeparr from outside. Behind a reverse
  proxy, follow [Behind a reverse proxy](docs/DEPLOYMENT.md#behind-a-reverse-proxy):
  create the admin from your own network first, choose Remote access ›
  Through a reverse proxy (setup or Settings › Account), and use HTTPS.
- The ThePornDB metadata address used by Whisparr-Eros
  (`/api/whisparr-metadata/…`) has no login, since Whisparr can't sign in.
  It only answers your private network, never visitors coming through the
  proxy.

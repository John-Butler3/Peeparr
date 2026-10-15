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

- Keep Peeparr on your own network. Use a VPN, or a reverse proxy with its
  own login and HTTPS, to reach it from outside.
- Behind HTTPS, set `SESSION_COOKIE_SECURE=true` in `/opt/peeparr/.env`.
- The ThePornDB metadata address used by Whisparr-Eros
  (`/api/whisparr-metadata/…`) has no login, since Whisparr can't sign in.
  Anyone who can reach it can use your ThePornDB key, so don't expose it.

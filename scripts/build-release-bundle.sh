#!/usr/bin/env bash
# Builds peeparr-<version>.tar.gz: Peeparr already built, for installs
# without Docker (the Proxmox LXC script downloads it from the GitHub
# release). It holds the built API and web app and what's needed to install
# the runtime packages on the target (`pnpm install --prod`), so nothing is
# compiled there.
#
#   scripts/build-release-bundle.sh <version> [output-dir]
#
# Builds the checkout it's in, or PEEPARR_SRC (e.g. an older release's
# checkout, built with this version of the script).
#
# Unpacks to a single peeparr/ folder.
set -euo pipefail

version="${1:?usage: build-release-bundle.sh <version> [output-dir]}"
version="${version#v}"
out_dir="$(mkdir -p "${2:-dist-release}" && cd "${2:-dist-release}" && pwd)"
root="${PEEPARR_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$root"

pnpm install --frozen-lockfile
DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
  pnpm exec prisma generate --schema prisma/schema.prisma
pnpm --filter sp-api build
pnpm --filter sp-web build

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
bundle="$stage/peeparr"
mkdir -p "$bundle/apps/sp-api" "$bundle/apps/sp-web" "$bundle/bin"

# Workspace and lockfile: `pnpm install --prod --frozen-lockfile` on the target.
cp package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts LICENSE "$bundle/"
cp -r prisma "$bundle/"
cp apps/sp-api/package.json "$bundle/apps/sp-api/"
cp -r apps/sp-api/dist "$bundle/apps/sp-api/"
cp apps/sp-web/package.json "$bundle/apps/sp-web/"
cp -r apps/sp-web/dist "$bundle/apps/sp-web/"
cp infrastructure/docker/reset-password.sh "$bundle/bin/peeparr-reset-password"
chmod +x "$bundle/bin/peeparr-reset-password"
echo "$version" >"$bundle/VERSION"

tar -czf "$out_dir/peeparr-${version}.tar.gz" -C "$stage" peeparr
echo "$out_dir/peeparr-${version}.tar.gz"

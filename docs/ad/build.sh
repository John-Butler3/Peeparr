#!/bin/sh
# Makes docs/assets/peeparr-ad.mp4 (1920x1080) and peeparr-ad.gif (README).
#
# Run in a container with the repo at /app and a scratch folder at /work:
#   docker run --rm -v "$PWD":/app -v /tmp/ad:/work -w /work node:22-alpine sh /app/docs/ad/build.sh
#
# 1. Builds the web app, and stand-in pictures and clips (media.sh).
# 2. Records Peeparr on a desktop and a phone, one journey from signing in to
#    watching (record.mjs), against a stand-in server that plays Stash and
#    Whisparr.
# 3. Puts the two side by side, step by step with captions (compose.html,
#    render.mjs), and encodes them.
set -e
apk add --no-cache chromium ffmpeg font-dejavu font-noto >/dev/null
cd /app && corepack enable && pnpm install --frozen-lockfile --filter sp-web --filter . && pnpm --filter sp-web build
mkdir -p /pw /work/node_modules && cd /pw && npm init -y >/dev/null && npm i --silent playwright-core
ln -sfn /pw/node_modules/playwright-core /work/node_modules/playwright-core
cp /app/docs/ad/*.mjs /app/docs/ad/compose.html /work/ && cp /app/docs/assets/logo.svg /work/logo.svg
cd /work && sh /app/docs/ad/media.sh
node record.mjs
node render.mjs
ffmpeg -loglevel error -y -framerate 30 -i frames/%05d.jpg -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart /app/docs/assets/peeparr-ad.mp4
F="fps=12,scale=640:-2:flags=lanczos"
ffmpeg -loglevel error -y -i /app/docs/assets/peeparr-ad.mp4 -vf "$F,palettegen=max_colors=128:stats_mode=diff" p.png
ffmpeg -loglevel error -y -i /app/docs/assets/peeparr-ad.mp4 -i p.png -lavfi "$F[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" /app/docs/assets/peeparr-ad.gif
ls -la /app/docs/assets/peeparr-ad.*

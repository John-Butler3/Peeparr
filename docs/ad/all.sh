#!/bin/sh
set -e
# README: 480 wide, 20 fps, 128 colours.
F="fps=20,scale=480:-2:flags=lanczos"
ffmpeg -loglevel error -y -framerate 20 -i out/%04d.jpg -vf "$F,palettegen=max_colors=128:stats_mode=diff" p.png
ffmpeg -loglevel error -y -framerate 20 -i out/%04d.jpg -i p.png -lavfi "$F[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" peeparr-ad.gif
# Full quality: 1280x720, 20 fps, 256 colours.
ffmpeg -loglevel error -y -framerate 20 -i out/%04d.jpg -vf "fps=20,palettegen=max_colors=256:stats_mode=full" phq.png
ffmpeg -loglevel error -y -framerate 20 -i out/%04d.jpg -i phq.png -lavfi "fps=20[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" peeparr-ad-hq.gif
ffmpeg -loglevel error -y -framerate 20 -i out/%04d.jpg -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart peeparr-ad.mp4
ls -la peeparr-ad.gif peeparr-ad-hq.gif peeparr-ad.mp4

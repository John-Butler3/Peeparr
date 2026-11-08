#!/bin/sh
# Stand-in pictures and clips for the ad (abstract, generated): no real scenes.
set -e
mkdir -p /work/m
C="0x3b1f4a:0xd94f6f 0x14324a:0x3fb8c4 0x3a2a14:0xf2a541 0x1d3b2a:0x7bd389 0x2b1a3d:0x9d6bff 0x3d1414:0xff7a59 0x0f2d3d:0x5ac8fa 0x332211:0xe8c07d 0x1a1a3a:0xff5fa2 0x203a2a:0x4fd1a5 0x3a1f2b:0xf78fb3 0x112233:0x88aaff"
i=0
for pair in $C; do
  a=${pair%%:*}; b=${pair##*:}
  ffmpeg -loglevel error -y -f lavfi -i "gradients=s=1280x720:c0=$a:c1=$b:x0=0:y0=0:x1=1280:y1=720:speed=0.012:d=12:r=24,format=yuv420p" \
    -vf "geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)',drawbox=x=iw*0.62:y=ih*0.18:w=ih*0.5:h=ih*0.5:color=white@0.10:t=fill,boxblur=18:2" \
    -c:v libvpx -b:v 900k -an -t 12 /work/m/v$i.webm
  ffmpeg -loglevel error -y -ss 3 -i /work/m/v$i.webm -frames:v 1 -q:v 3 /work/m/s$i.jpg
  i=$((i+1))
done
ls /work/m | wc -l

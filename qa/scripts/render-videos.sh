#!/usr/bin/env bash
# Turns the raw Playwright recording into a shareable mp4.
set -euo pipefail
cd "$(dirname "$0")/../artifacts"
ffmpeg -loglevel error -y -i videos/fieldkit-demo.webm -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -movflags +faststart videos/fieldkit-demo.mp4
rm -rf raw raw-video
ls -la videos/*.mp4

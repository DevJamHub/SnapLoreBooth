#!/usr/bin/env bash
# Run on the VPS from /opt/snaplorebooth after copying new code in. Data in ./data is kept.
set -euo pipefail
npm ci
npm run build
sudo systemctl restart snaplorebooth
echo "SnaploreBooth updated and restarted."

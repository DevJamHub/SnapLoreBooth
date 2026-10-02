#!/usr/bin/env bash
# Releases a Canon body from macOS and proves gphoto2 can claim it.
#
# macOS launches ptpcamerad the moment a camera is attached and it takes USB interface 0.
# `killall` without root fails silently, and launchd revives the daemon within
# milliseconds, so the kill and the first gphoto2 call have to happen back to back.
set -uo pipefail

echo "── before ──"
pgrep -lx ptpcamerad || echo "ptpcamerad: not running"
gphoto2 --auto-detect 2>&1 | tail -2

echo
echo "── releasing (needs your password) ──"
sudo launchctl kill SIGKILL "gui/$(id -u)/com.apple.ptpcamerad" 2>&1 || echo "nothing to kill"

# No sleep: the daemon comes back on its own, so claim the device immediately.
echo
echo "── claiming ──"
if gphoto2 --summary 2>&1 | head -20; then
  echo
  echo "If you see the camera summary above, the tether is live. Start the booth with:"
  echo "  OPERATOR_PASSWORD=... CAMERA_SOURCE=gphoto2 npm run dev:https"
else
  echo
  echo "Still blocked. Options, in order:"
  echo "  1. sudo launchctl kill SIGKILL gui/$(id -u)/com.apple.ptpcamerad; gphoto2 --summary"
  echo "  2. Run the booth server on a Linux host — no such daemon exists there"
fi

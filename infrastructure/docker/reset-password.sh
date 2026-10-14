#!/bin/sh
# Prints the temporary password issued by "Forgot password?" on the sign-in
# page. Run from the host: docker exec <app-container> stasharr-reset-password
set -eu

reset_file="${APP_DATA_DIR:-/var/lib/stasharr}/password-reset.txt"

if [ ! -f "$reset_file" ]; then
  echo "No password reset is pending. Click \"Forgot password?\" on the sign-in page first." >&2
  exit 1
fi

cat "$reset_file"

#!/usr/bin/env bash
# Upload current app source (including uncommitted edits), never local secrets/data.
set -euo pipefail
app_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
server_ip=${1:?Usage: bash deploy/upload.sh <Droplet IPv4> <SSH private key> [hostname]}
ssh_key=${2:?Pass the SSH private key path}
[[ "$server_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Pass the Droplet IPv4 address'; exit 1; }
domain=${3:-aroundhere-${server_ip//./-}.sslip.io}
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]] || { echo 'Invalid hostname'; exit 1; }
[[ -f "$ssh_key" ]] || { echo 'SSH key is missing'; exit 1; }
archive_dir=$(mktemp -d)
trap 'rm -f "$archive_dir/app.tar.gz"; rmdir "$archive_dir"' EXIT
COPYFILE_DISABLE=1 tar -czf "$archive_dir/app.tar.gz" -C "$app_dir" \
  package.json package-lock.json index.html vite.config.ts eslint.config.js \
  tsconfig.json tsconfig.app.json tsconfig.node.json src public server deploy \
  supabase/migrations supabase/templates supabase/seed.sql supabase/demo-reset.sql supabase/demo
ssh_options=(-i "$ssh_key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
scp "${ssh_options[@]}" "$archive_dir/app.tar.gz" "root@$server_ip:/root/aroundhere-app.tar.gz"
# The hostname is intentionally expanded locally, after validating its characters.
# shellcheck disable=SC2029
ssh "${ssh_options[@]}" "root@$server_ip" "set -e; mkdir -p /opt/aroundhere/app; tar -xzf /root/aroundhere-app.tar.gz -C /opt/aroundhere/app; bash /opt/aroundhere/app/deploy/bootstrap.sh '$domain'"

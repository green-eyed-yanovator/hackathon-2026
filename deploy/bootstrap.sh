#!/usr/bin/env bash
# On a fresh Ubuntu 24.04 Droplet, as root. Source is already in this directory.
set -euo pipefail
umask 077
app_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
domain=${1:?Pass the public hostname}
[[ "$domain" =~ ^[a-z0-9][a-z0-9.-]*[a-z0-9]$ ]] || { echo 'Invalid hostname'; exit 1; }
[[ $(id -u) == 0 ]] || { echo 'Run as root on the Droplet'; exit 1; }
# shellcheck source=/dev/null
source /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { echo 'Requires Ubuntu 24.04'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git xz-utils rsync ufw caddy docker.io docker-compose-v2
systemctl enable --now docker
# Official Node binary, verified against its published SHA256 checksums.
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  node_version=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | sed -n 's/.*  node-\(v[0-9.]*\)-linux-x64.tar.xz$/\1/p')
  [[ "$node_version" =~ ^v22\.[0-9]+\.[0-9]+$ ]] || { echo 'Cannot find Node 22'; exit 1; }
  node_dir=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz" -o "$node_dir/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$node_dir/checksums"
  checksum=$(sed -n "s/  node-$node_version-linux-x64.tar.xz$//p" "$node_dir/checksums")
  printf '%s  %s\n' "$checksum" "$node_dir/node.tar.xz" | sha256sum -c -
  tar -xJf "$node_dir/node.tar.xz" -C /usr/local --strip-components=1
fi
# Swap is a buffer for image startup and the frontend build on the 4 GB plan.
if [[ ! -e /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

stack_dir=/opt/aroundhere/supabase-stack
if [[ ! -d "$stack_dir" ]]; then
  upstream_dir=$(mktemp -d)
  git clone --depth 1 --branch self-hosted/v0.8.2 --filter=blob:none --sparse https://github.com/supabase/supabase.git "$upstream_dir/upstream"
  git -C "$upstream_dir/upstream" sparse-checkout set docker
  [[ $(git -C "$upstream_dir/upstream" rev-parse HEAD) == 564eab8ad7840b13324f68b1bfac074ef8d51c21 ]] || { echo 'Upstream release hash changed'; exit 1; }
  mkdir -p "$stack_dir"
  cp -a "$upstream_dir/upstream/docker/." "$stack_dir/"
  # Services use different container users; upstream configs must be readable.
  chmod -R a+rX "$stack_dir"
fi
cd "$stack_dir"
if [[ ! -f .env ]]; then
  cp .env.example .env
  sh utils/generate-keys.sh --update-env > /dev/null
  sh utils/add-new-auth-keys.sh --update-env > /dev/null
  # The upstream utilities retain backups containing example secrets.
  chmod 600 .env
  [[ ! -f .env.old ]] || chmod 600 .env.old
fi
mkdir -p /var/www/aroundhere
node "$app_dir/deploy/configure.mjs" "$stack_dir" "$app_dir" "$domain"

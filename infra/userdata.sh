#!/bin/bash
# First-boot setup for the instance (runs once as root via cloud-init).
# Output goes to /var/log/cloud-init-output.log. Nothing secret is handled here.
set -euxo pipefail

dnf install -y docker
systemctl enable --now docker

# Docker Compose v2 as a CLI plugin. The download is verified against the checksum published
# with the release. To pin a version, replace "latest/download" with "download/vX.Y.Z".
COMPOSE_URL="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64"
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /tmp/docker-compose "$COMPOSE_URL"
curl -fsSL -o /tmp/docker-compose.sha256 "$COMPOSE_URL.sha256"
echo "$(cut -d' ' -f1 /tmp/docker-compose.sha256)  /tmp/docker-compose" | sha256sum -c -
install -m 0755 /tmp/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
rm -f /tmp/docker-compose /tmp/docker-compose.sha256

# Keep local container logs from filling the disk (the services also ship to CloudWatch).
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
systemctl restart docker

# Install OS security updates automatically.
dnf install -y dnf-automatic
sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer

# Where deploy.sh puts the compose file, Caddyfile and the .env it builds from SSM.
mkdir -p /opt/relay
chmod 700 /opt/relay

#!/usr/bin/env bash
# Runs ON the instance (as root, started by SSM Run Command from the GitHub Actions workflow).
#
#   deploy.sh <image-uri>     deploy that image
#   deploy.sh --rollback      redeploy the previously deployed image
#
# It writes /opt/relay/.env from SSM Parameter Store, starts the stack, waits for the API to
# become healthy, and on failure puts the previous image back. It never prints secret values.
# Database migrations run when the API starts and are additive, so rolling the image back is safe
# as long as migrations stay backward compatible.
set -euo pipefail

cd /opt/relay
SSM_PATH="${SSM_PATH:-/booking-webhook-relay}"
COMPOSE="docker compose -f docker-compose.prod.yml"

# Region from the instance metadata (IMDSv2).
TOKEN="$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
REGION="$(curl -fsS -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)"

CURRENT="$(cat .current-image 2>/dev/null || true)"

if [ "${1:-}" = "--rollback" ]; then
  [ -s .previous-image ] || { echo "No previous image is recorded, so there is nothing to roll back to."; exit 1; }
  IMAGE="$(cat .previous-image)"
  echo "Rolling back to $IMAGE"
else
  IMAGE="${1:?usage: deploy.sh <image-uri> | --rollback}"
fi

write_env() { # $1 = image
  umask 077
  local params
  params="$(aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text)"
  for required in WEBHOOK_SECRET ADMIN_API_KEY POSTGRES_PASSWORD CRM_API_KEY PUBLIC_HOST AWS_REGION LOG_GROUP; do
    if ! grep -q "^$SSM_PATH/$required"$'\t' <<<"$params"; then
      echo "Missing SSM parameter $required. Run infra/set-secrets.sh and apply Terraform first."
      exit 1
    fi
  done
  printf '%s\n' "$params" | while IFS=$'\t' read -r name value; do
    printf '%s=%s\n' "${name##*/}" "$value"
  done > .env.tmp
  printf 'API_IMAGE=%s\n' "$1" >> .env.tmp
  mv .env.tmp .env
}

wait_until_healthy() {
  for _ in $(seq 1 40); do
    if $COMPOSE exec -T api wget -qO- http://localhost:3000/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

start() { # $1 = image
  write_env "$1"
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${1%%/*}" >/dev/null
  $COMPOSE pull
  $COMPOSE up -d --remove-orphans
}

start "$IMAGE"

if wait_until_healthy; then
  if [ -n "$CURRENT" ] && [ "$CURRENT" != "$IMAGE" ]; then
    echo "$CURRENT" > .previous-image
  fi
  echo "$IMAGE" > .current-image
  docker image prune -af --filter "until=168h" >/dev/null || true
  echo "Deployed $IMAGE"
  exit 0
fi

echo "The API did not become healthy. Container status and recent API logs:"
$COMPOSE ps || true
$COMPOSE logs --tail 50 api || true

if [ -n "$CURRENT" ] && [ "$CURRENT" != "$IMAGE" ]; then
  echo "Rolling back to $CURRENT"
  start "$CURRENT"
  if wait_until_healthy; then
    echo "Rollback to $CURRENT succeeded."
  else
    echo "Rollback did not become healthy either. Manual attention needed."
  fi
fi
exit 1

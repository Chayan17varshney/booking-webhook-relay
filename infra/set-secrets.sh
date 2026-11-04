#!/usr/bin/env bash
# Creates the four application secrets in SSM Parameter Store (SecureString) with random values.
# Existing parameters are left unchanged, so it is safe to run again. The values are never
# printed and never stored in Terraform state.
#
#   AWS_REGION=ap-south-1 ./set-secrets.sh
#
# Read one back when you need it (for example to sign webhooks or open the dashboard):
#   aws ssm get-parameter --region ap-south-1 --name /booking-webhook-relay/ADMIN_API_KEY \
#     --with-decryption --query Parameter.Value --output text
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
PROJECT="${PROJECT:-booking-webhook-relay}"

for name in WEBHOOK_SECRET ADMIN_API_KEY POSTGRES_PASSWORD CRM_API_KEY; do
  path="/$PROJECT/$name"
  if aws ssm get-parameter --region "$REGION" --name "$path" >/dev/null 2>&1; then
    echo "$name already exists: left unchanged"
  else
    aws ssm put-parameter --region "$REGION" --name "$path" --type SecureString \
      --value "$(openssl rand -hex 24)" >/dev/null
    echo "$name created"
  fi
done

#!/usr/bin/env bash
# Runs a shell script on the instance through SSM Run Command, waits for it, and prints its output.
# Used by the GitHub Actions deploy workflow (credentials come from the OIDC role).
#
#   ssm-run.sh <instance-id> <region> <script-file>
set -euo pipefail

INSTANCE="${1:?instance id}"
REGION="${2:?region}"
SCRIPT="${3:?script file}"

PARAMS="$(jq -n --rawfile script "$SCRIPT" '{commands: [$script], executionTimeout: ["900"]}')"

COMMAND_ID="$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript --comment "booking-webhook-relay deploy" \
  --parameters "$PARAMS" --query Command.CommandId --output text)"
echo "SSM command $COMMAND_ID sent to $INSTANCE"

STATUS="Pending"
for _ in $(seq 1 180); do
  STATUS="$(aws ssm get-command-invocation --region "$REGION" --command-id "$COMMAND_ID" \
    --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success | Failed | Cancelled | TimedOut) break ;;
  esac
  sleep 5
done

echo "----- output -----"
aws ssm get-command-invocation --region "$REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE" \
  --query StandardOutputContent --output text || true
echo "----- errors -----"
aws ssm get-command-invocation --region "$REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE" \
  --query StandardErrorContent --output text || true

if [ "$STATUS" != "Success" ]; then
  echo "SSM command finished with status: $STATUS" >&2
  exit 1
fi

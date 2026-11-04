# Deploying to AWS (single EC2 host)

This folder and `deploy/` set up one small EC2 instance that runs the whole stack with Docker Compose behind Caddy (automatic HTTPS). GitHub Actions builds the image, pushes it to ECR, tells the instance to deploy it through SSM, smoke-tests the public URL, and rolls back if that fails.

**Status: written and checked with `terraform validate` (it passes), but never applied.** None of this has been run against a real AWS account. Expect to fix small things on the first `terraform apply` and the first deploy.

**Cost:** roughly $10-20 a month while it runs (instance, disk, public IP). Prices and free-tier rules change, so check the AWS pricing pages and your billing console. Destroy it when you are done demoing (see the end).

```
GitHub Actions --OIDC--> IAM role (this repo + "production" environment only)
   | build image, push to ECR (tag = git SHA)
   | SSM Run Command: deploy.sh <image>
   v
EC2 (Amazon Linux 2023, no SSH, only ports 80/443)
   caddy -> api (API + /dashboard) -> postgres, redis, mock-crm
Secrets: SSM Parameter Store.   Logs: CloudWatch.   Cost alert: AWS Budgets.
```

## Before you start

- A GitHub repository with this code, and CI that has run at least once.
- An AWS account where you work as an IAM or Identity Center user (not root), with MFA on root.
- AWS CLI v2 configured for that user, and Terraform 1.5 or newer.
- Only synthetic data. This is a demo box.
- If the repository will be public, scrub the leaked Brevo key first (see your resume checklist notes).

## 1. Create the infrastructure

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars    # edit: github_repo, budget_email, optional domain/IP restriction
terraform init
terraform plan
terraform apply
```

Terraform creates: an ECR repository, a security group (80/443 only), the instance role, the instance with an Elastic IP, a CloudWatch log group, non-secret settings in SSM, a GitHub OIDC role, and a monthly AWS Budget with email alerts. Confirm the budget email subscription if AWS sends one.

If your account already has a GitHub OIDC provider, set `existing_oidc_provider_arn` (an account can only have one).

If you set `domain_name`, create an A record pointing at the `elastic_ip` output before the first deploy, so Caddy can get a certificate. Without a domain you get a free `<ip>.sslip.io` name.

## 2. Create the secrets (once)

```bash
AWS_REGION=ap-south-1 ./set-secrets.sh
```

This creates `WEBHOOK_SECRET`, `ADMIN_API_KEY`, `POSTGRES_PASSWORD` and `CRM_API_KEY` as encrypted SSM parameters with random values. They are not printed and never pass through Terraform state. To read one when you need it:

```bash
aws ssm get-parameter --region ap-south-1 --name /booking-webhook-relay/ADMIN_API_KEY --with-decryption --query Parameter.Value --output text
```

## 3. Configure GitHub

1. Repository settings, Environments, create **production**. Optionally add yourself as a required reviewer so every deploy waits for your approval.
2. In that environment add these as **variables** (not secrets) from `terraform output github_environment_variables`: `AWS_ROLE_ARN`, `AWS_REGION`, `ECR_REPOSITORY`, `INSTANCE_ID`, `PUBLIC_HOST`.

## 4. Deploy

Run the **Deploy** workflow by hand (Actions tab, Run workflow). After that it runs automatically when CI passes on `main`.

It builds and pushes the image, deploys it, runs `scripts/smoke.sh` against `https://<PUBLIC_HOST>`, and rolls back to the previous image if the smoke test fails.

Then open `https://<PUBLIC_HOST>/dashboard/` and sign in with the `ADMIN_API_KEY`.

## Looking around

```bash
aws ssm start-session --target <instance_id>        # shell, no SSH needed
sudo docker compose -f /opt/relay/docker-compose.prod.yml ps
sudo docker compose -f /opt/relay/docker-compose.prod.yml logs --tail 50 api
sudo tail -n 50 /var/log/cloud-init-output.log      # first-boot setup output
```

Container logs also go to the CloudWatch log group `/booking-webhook-relay`.

## Security notes

- **No access keys** exist for CI. The role trusts only `repo:<owner>/<repo>:environment:production`, and can only push to this ECR repository, run a command on this one instance, and read two parameters for the smoke test.
- **No SSH.** The security group allows only 80 and 443. IMDSv2 is required with hop limit 1, so containers cannot reach the instance credentials. The disk is encrypted. OS security updates install automatically.
- **Secrets** live in SSM and are written to a root-only `.env` on the instance during deploy. They are not in the repo, the image, Terraform state or workflow logs.
- To keep the demo private, set `ingress_cidrs = ["<your-ip>/32"]`. Note that Let's Encrypt must still reach port 80, so restricting to your own IP blocks certificate issuance; use a domain with DNS validation (not set up here) or keep the box open but protected by the admin key.
- The "CRM" is a mock container. This service is a demo, not a production system.

## Known limits (be honest about them)

- One host: if it dies, the service is down. Postgres data is on the instance's disk and is lost on `terraform destroy`. There are no automated backups.
- Docker Compose is installed from the latest release at first boot (checksum verified). Pin a version in `userdata.sh` for repeatable builds.
- Rolling back the image does not undo database migrations. Keep migrations backward compatible.
- Forwarding to the CRM runs inside the API process (recovered after crashes by the sweep). At higher volume, use a queue and separate workers.

## Tear down

```bash
cd infra
terraform destroy
```

This removes the instance, disk, Elastic IP, ECR repository (and images), roles, log group, parameters created by Terraform and the budget. Delete the four secret parameters yourself:

```bash
for n in WEBHOOK_SECRET ADMIN_API_KEY POSTGRES_PASSWORD CRM_API_KEY; do
  aws ssm delete-parameter --region ap-south-1 --name /booking-webhook-relay/$n
done
```

Then check the billing console the next day to confirm nothing is still running.

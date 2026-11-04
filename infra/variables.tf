variable "region" {
  description = "AWS region. Mumbai is closest for India."
  type        = string
  default     = "ap-south-1"
}

variable "project" {
  description = "Name used for tags, resource names and the SSM parameter path (/<project>/...). deploy/deploy.sh expects the default."
  type        = string
  default     = "booking-webhook-relay"
}

variable "github_repo" {
  description = "GitHub repository allowed to deploy, as OWNER/REPO (for example ChayanVarshney/booking-webhook-relay)."
  type        = string
}

variable "github_environment" {
  description = "GitHub environment the deploy job runs in. The IAM role only trusts this environment."
  type        = string
  default     = "production"
}

variable "budget_email" {
  description = "Email address for AWS Budgets alerts."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget in USD. Alerts at 80% actual and 100% forecast."
  type        = number
  default     = 10
}

variable "instance_type" {
  description = "x86_64 instance type. t3.small (2 GB) is enough for the API, Postgres, Redis and Caddy."
  type        = string
  default     = "t3.small"
}

variable "root_volume_gb" {
  description = "Size of the encrypted root disk. Postgres data lives on it, so it is deleted with the instance."
  type        = number
  default     = 20
}

variable "domain_name" {
  description = "Hostname for HTTPS. Leave empty to use a free <ip>.sslip.io name. If you set a domain, point its A record at the elastic_ip output."
  type        = string
  default     = ""
}

variable "ingress_cidrs" {
  description = "Who may reach ports 80 and 443. Use [\"<your-ip>/32\"] to keep the demo private."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "existing_oidc_provider_arn" {
  description = "ARN of an existing GitHub OIDC provider in this account (an account can only have one). Leave empty to create it."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps container logs."
  type        = number
  default     = 14
}

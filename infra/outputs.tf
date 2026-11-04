output "public_url" {
  description = "Where the service will be reachable once deployed."
  value       = "https://${local.public_host}"
}

output "elastic_ip" {
  description = "Point your domain's A record here if you set domain_name."
  value       = aws_eip.relay.public_ip
}

output "instance_id" {
  description = "Use with: aws ssm start-session --target <id>"
  value       = aws_instance.relay.id
}

output "ecr_repository_url" {
  value = aws_ecr_repository.relay.repository_url
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "github_environment_variables" {
  description = "Add these as VARIABLES (not secrets) to the GitHub environment named in github_environment."
  value = {
    AWS_ROLE_ARN   = aws_iam_role.github_deploy.arn
    AWS_REGION     = var.region
    ECR_REPOSITORY = aws_ecr_repository.relay.name
    INSTANCE_ID    = aws_instance.relay.id
    PUBLIC_HOST    = local.public_host
  }
}

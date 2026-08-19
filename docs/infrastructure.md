# Infrastructure as Code

The `infra/terraform/` directory contains a Terraform module that provisions
the full production stack on AWS.

## Components

| Component | Service | Notes |
|-----------|---------|-------|
| API backend | ECS Fargate | Auto-scaling, container insights |
| Database | RDS PostgreSQL 16 | Encrypted, automated backups 7d |
| Cache / queues | ElastiCache Redis 7 | 1-day snapshot retention |
| Frontend | Vercel | Zero-config Next.js deployment |
| TLS | ACM + Route53 | Wildcard cert auto-renewed |
| Secrets | AWS Secrets Manager | Injected into ECS tasks |

## First deploy

```bash
cd infra/terraform
terraform init
terraform plan -var="domain_name=yourcompany.com"
terraform apply
```

## Database user setup

After `terraform apply`, run `scripts/create-api-role.sql` against the RDS
instance to create the low-privilege `affiliate_api` role and then update
`DATABASE_URL` in Secrets Manager to use that role instead of the superuser.

## Staging environment

Create a `terraform.tfvars` file:

```hcl
environment      = "staging"
db_instance_class = "db.t4g.micro"
domain_name      = "staging.yourcompany.com"
```

Then: `terraform workspace new staging && terraform apply`

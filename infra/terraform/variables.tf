variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Application name prefix for all resources"
  type        = string
  default     = "affiliate"
}

variable "environment" {
  description = "Deployment environment (production, staging)"
  type        = string
  default     = "production"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.small"
}

variable "backend_cpu" {
  description = "Fargate CPU units for backend task"
  type        = number
  default     = 512
}

variable "backend_memory" {
  description = "Fargate memory (MiB) for backend task"
  type        = number
  default     = 1024
}

variable "domain_name" {
  description = "Root domain for the platform (e.g. example.com)"
  type        = string
}

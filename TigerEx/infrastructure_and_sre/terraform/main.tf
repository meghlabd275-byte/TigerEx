# TigerEx Terraform Infrastructure
# AWS Production Setup

terraform {
  required_version = ">= 1.5"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "tigerex-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "TigerEx"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# =============================================================================
# Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

# =============================================================================
# VPC
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  
  tags = {
    Name = "tigerex-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  
  tags = {
    Name = "tigerex-igw"
  }
}

# Public Subnets
resource "aws_subnet" "public" {
  count                   = 3
  vpc_id                  = aws_vpc.main.id
  cidr_block             = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  
  tags = {
    Name = "tigerex-public-${count.index + 1}"
    Type = "public"
  }
}

# Private Subnets
resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  tags = {
    Name = "tigerex-private-${count.index + 1}"
    Type = "private"
  }
}

# Database Subnets
resource "aws_subnet" "database" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 20)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  
  tags = {
    Name = "tigerex-database-${count.index + 1}"
    Type = "database"
  }
}

# =============================================================================
# EKS Cluster
# =============================================================================

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 19.0"
  
  cluster_name    = "tigerex-cluster"
  cluster_version = "1.28"
  
  vpc_id     = aws_vpc.main.id
  subnet_ids = concat(aws_subnet.public[*].id, aws_subnet.private[*].id)
  
  eks_managed_node_groups = {
    general = {
      min_size       = 3
      max_size       = 20
      desired_size  = 5
      
      instance_types = ["m6i.xlarge"]
      
      labels = {
        NodeGroup = "general"
      }
    }
    
    # Low-latency matching engine nodes
    matching = {
      min_size       = 3
      max_size       = 10
      desired_size  = 3
      
      instance_types = ["r6i.2xlarge"]
      
      labels = {
        NodeGroup = "matching"
      }
      
      taints = [{
        key    = "workload"
        value  = "matching"
        effect = "NO_SCHEDULE"
      }]
    }
    
    # GPU nodes for ML
    ml = {
      min_size       = 0
      max_size       = 5
      desired_size  = 0
      
      instance_types = ["g5.xlarge"]
      
      labels = {
        NodeGroup = "ml"
      }
      
      taints = [{
        key    = "workload"
        value  = "ml"
        effect = "NO_SCHEDULE"
      }]
    }
  }
}

# =============================================================================
# RDS PostgreSQL
# =============================================================================

resource "aws_db_instance" "main" {
  identifier = "tigerex-postgres"
  
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = "db.r6g.xlarge"
  
  allocated_storage     = 500
  max_allocated_storage = 2000
  storage_encrypted    = true
  
  db_name  = "tigerex"
  username = "tigerex"
  password = var.db_password
  
  vpc_security_group_ids = [aws_security_group.database.id]
  
  db_subnet_group_name = aws_db_subnet_group.main.name
  
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"
  
  deletion_protection = true
  skip_final_snapshot  = false
  final_snapshot_identifier = "tigerex-final-snapshot"
  
  tags = {
    Name = "tigerex-postgres"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "tigerex-db-subnet"
  subnet_ids = aws_subnet.database[*].id
}

# =============================================================================
# ElastiCache Redis
# =============================================================================

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "tigerex-redis"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = "cache.r6g.xlarge"
  num_cache_nodes      = 3
  
  parameter_group_name = "default.redis7"
  
  port                 = 6379
  
  security_group_ids = [aws_security_group.redis.id]
  
  subnet_group_name = aws_elasticache_subnet_group.main.name
  
  auto_minor_version_upgrade = true
  automatic_failover_enabled  = true
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  
  tags = {
    Name = "tigerex-redis"
  }
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "tigerex-redis-subnet"
  subnet_ids = aws_subnet.database[*].id
}

# =============================================================================
# MSK Kafka
# =============================================================================

resource "aws_msk_cluster" "main" {
  cluster_name           = "tigerex-kafka"
  kafka_version         = "3.6.0"
  number_of_broker_nodes = 3
  
  broker_node_group_info {
    instance_type   = "kafka.m7g.large"
    client_subnets = aws_subnet.private[*].id
    
    storage_info {
      ebs_storage_info {
        volume_size = 500
      }
    }
  }
  
  encryption_info {
    encryption_in_transit {
      client_broker_plaintext = false
      client_broker_ssl       = true
    }
  }
  
  logging_info {
    broker_logs {
      cloudwatch_logs {
        enabled   = true
        log_group = "/aws/msk/tigerex"
      }
    }
  }
  
  tags = {
    Name = "tigerex-kafka"
  }
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "database" {
  name        = "tigerex-database"
  description = "Security group for RDS"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "redis" {
  name        = "tigerex-redis"
  description = "Security group for ElastiCache"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
}

# =============================================================================
# ALB
# =============================================================================

resource "aws_lb" "main" {
  name               = "tigerex-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = aws_subnet.public[*].id
  
  enable_deletion_protection = true
  
  tags = {
    Name = "tigerex-alb"
  }
}

resource "aws_security_group" "alb" {
  name        = "tigerex-alb"
  description = "Security group for ALB"
  vpc_id      = aws_vpc.main.id
  
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# =============================================================================
# Secrets Manager
# =============================================================================

resource "aws_secretsmanager_secret" "db_password" {
  name        = "tigerex/db-password"
  description = "Database password"
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "tigerex/jwt-secret"
  description = "JWT signing secret"
}

# =============================================================================
# CloudWatch
# =============================================================================

resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/tigerex-cluster"
  retention_in_days = 7
}

# =============================================================================
# Outputs
# =============================================================================

output "vpc_id" {
  value = aws_vpc.main.id
}

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "database_endpoint" {
  value = aws_db_instance.main.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.main.configuration_endpoint.address
}

output "kafka_brokers" {
  value = aws_msk_cluster.main.bootstrap_brokers_tls
}
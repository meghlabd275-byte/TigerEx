# TigerEx Deployment Guide

## Pre-Launch Checklist

### Infrastructure Required

1. **Cloud Provider** (Select One)
   - AWS (Recommended)
   - Google Cloud Platform
   - Microsoft Azure
   - Digital Ocean

2. **Required Services**
   - Kubernetes Cluster (EKS/GKE/AKS)
   - PostgreSQL Database (RDS)
   - Redis Cache (ElastiCache)
   - Kafka/Event Store
   - S3-compatible Storage

### Missing Components

| Component | Status | Action Required |
|-----------|--------|----------------|
| **Entry Point** | ❌ Missing | Create Express server entry |
| **Database Migrations** | ⚠️ Schema exists | Run migrations |
| **Environment Config** | ⚠️ Template only | Configure production .env |
| **SSL Certificates** | ❌ Missing | Setup via cert-manager |
| **Load Balancer** | ❌ Missing | Configure ALB/NLB |
| **CDN** | ❌ Missing | Deploy CloudFront/Cloudflare |
| **DNS** | ❌ Missing | Configure Route53 |
| **Monitoring** | ⚠️ Logs exist | Deploy Prometheus/Grafana |

## Quick Deploy (Development)

```bash
# Clone and setup
git clone https://github.com/meghlabd275-byte/TigerEx.git
cd TigerEx

# Copy environment template
cp .env.example .env

# Start services
docker-compose up -d

# Access
open http://localhost:3000
```

## Production Deploy (AWS)

### Step 1: Infrastructure

```bash
# Create EKS cluster
eksctl create cluster --name tigerex-prod --region us-east-1

# Deploy PostgreSQL
aws rds create-db-instance \
  --db-instance-identifier tigerex-db \
  --db-instance-class db.r6g.large \
  --engine postgres \
  --allocated-storage 100
```

### Step 2: Build & Push Image

```bash
docker build -t tigerex/api:latest .
docker push your-registry/tigerex/api:latest
```

### Step 3: Deploy to Kubernetes

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### Step 4: SSL & DNS

```bash
# Get SSL certificate
aws acm request-certificate \
  --domain-name api.tigerex.com \
  --validation-method DNS

# Configure Route53 alias record
aws route53 change-resource-record-sets \
  --hosted-zone-id Z1234567890 \
  --change-batch file://dns.json
```

## Required Environment Variables

```
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/tigerex

# Redis
REDIS_URL=redis://host:6379

# JWT Secrets
JWT_SECRET=your-production-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret

# API Keys (ThParty Services)
STRIPE_SECRET_KEY=sk_live_xxx
TWILIO_ACCOUNT_SID=ACxxx
CLOUDINARY_CLOUD_NAME=xxx
CLOUDINARY_API_KEY=xxx

# Crypto Nodes
BTC_NODE_URL=https://btc-node.example.com
ETH_NODE_URL=https://eth-node.example.com
```

## Health Check Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Basic health |
| `GET /health/ready` | Readiness probe |
| `GET /health/live` | Liveness probe |
| `GET /api/v1/status` | API status |

## Performance Tuning

- Enable Redis caching
- Configure connection pooling
- Set up horizontal pod autoscaling
- Enable CDN for static assets

## Security Hardening

- Enable WAF rules
- Configure security headers
- Enable DDoS protection
- Set up audit logging

## Launch Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| **Day 1** | 4 hours | Infrastructure setup |
| **Day 2** | 4 hours | Database & migrations |
| **Day 3** | 4 hours | Build & deploy |
| **Day 4** | 4 hours | Testing & QA |
| **Day 5** | 4 hours | DNS & SSL |
| **Day 6** | 4 hours | Load testing |
| **Day 7** | 4 hours | Go Live! 🚀 |
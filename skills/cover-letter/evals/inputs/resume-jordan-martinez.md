# Jordan Martinez

jordan.martinez@example.com | +1 415 555 0142 | San Francisco, CA
github.com/jmartinez | linkedin.com/in/jmartinez

## Summary

Senior backend engineer, 7 years across payments, search, and developer platforms. Strongest in Go, distributed systems, and turning production incidents into durable fixes.

## Experience

### Stripe - Senior Software Engineer (2022 - present)

- Owned the billing gateway rewrite in Go; cut p99 latency on invoice creation from 420ms to 95ms by moving pricing lookups into a Redis-backed cache with versioned invalidation
- Led a 4-person pod through a zero-downtime migration of the subscription renewal system; processed 18M active subscriptions without revenue impact
- Authored the internal on-call runbook now used by the payments org (60+ engineers); cut MTTR on gateway incidents from 42 to 11 minutes
- Designed and shipped the idempotency key system used by three external APIs; hit 99.997% duplicate-suppression accuracy in production

### Shopify - Software Engineer (2019 - 2022)

- Migrated the order service from a PostgreSQL-only architecture to Kafka-backed event sourcing; the service now handles 2M events/day with 99.99% uptime
- Built the internal search service using Elasticsearch; reduced merchant search p95 latency from 1.8s to 280ms across 1.2M catalogs
- Mentored three junior engineers through their first year; all three were promoted within 18 months
- Introduced a deterministic replay framework for debugging order state bugs; adopted by four teams

### Crunchbase - Software Engineer (2018 - 2019)

- Built the company-enrichment pipeline in Python; processed 8M company records weekly with a hand-rolled dedup layer hitting 96% F1

## Skills

- Languages: Go (expert, 5 years), Python (4 years), TypeScript (3 years), Rust (reading-level)
- Systems: Kafka, Postgres, Redis, Elasticsearch, gRPC, Protocol Buffers
- Platforms: AWS (primary), GCP (working knowledge), Docker, Kubernetes
- Practices: distributed tracing, idempotency, event sourcing, chaos testing

## Education

BS Computer Science, UC Berkeley, 2018

# Pawtropolis Tech - Project Overview

> Auto-generated project documentation | 2026-03-01 | Exhaustive Scan

## Executive Summary

**Pawtropolis Tech** (v5.1.1) is a production-grade Discord bot backend for the Pawtropolis server, built as a monolithic TypeScript application. It serves as a community gatekeeping, moderation, and engagement platform with sophisticated application review workflows, event tracking, artist coordination, and security auditing capabilities.

The bot is actively deployed on an Ubuntu EC2 instance (`34.193.75.138`) managed via PM2, with automated deployment via custom shell scripts and CI/CD through GitHub Actions.

## Quick Reference

| Property | Value |
|----------|-------|
| **Version** | 5.1.1 |
| **Repository Type** | Monolith |
| **Primary Language** | TypeScript 5.5 |
| **Runtime** | Node.js 20+ (ESM) |
| **Framework** | Discord.js 14.16.3 |
| **Database** | SQLite (better-sqlite3 12.4.1) |
| **Architecture** | Event-driven, modular features |
| **Entry Point** | `src/index.ts` → `dist/index.js` |
| **License** | ANW-1.0 |

## Technology Stack Summary

| Category | Technology | Version |
|----------|-----------|---------|
| Language & Runtime | TypeScript, Node.js | 5.5, 20+ |
| Discord Integration | discord.js | 14.16.3 |
| Database | better-sqlite3, SQLite | 12.4.1 |
| Web Server | Fastify | - |
| Image Processing | canvas, sharp | 3.2.0, 0.34.4 |
| Error Tracking | @sentry/node | 10.20.0 |
| Logging | pino | 10.0.0 |
| External APIs | @google-cloud/vision | 5.3.4 |
| Validation | zod | 3.23.8 |
| Bundler | tsup | 8.1.0 |
| Testing | vitest | 3.x |
| Linting | eslint, prettier | 9.x, 3.x |

## Architecture Classification

- **Repository Type**: Monolith (single unified codebase)
- **Project Type**: Backend (Discord bot with event-driven architecture)
- **Architecture Pattern**: Modular feature-based with event-driven routing
- **Database Pattern**: Direct SQL with prepared statements (no ORM)
- **Configuration**: Zod-validated environment variables + per-guild database config

## Core Feature Areas

### 1. Application Gatekeeping
Multi-page questionnaire modals for new member verification with draft recovery, reviewer dashboards, claim-based review workflow, and automated role assignment.

### 2. Moderation System
Modmail (DM-to-thread routing), moderator performance analytics, security audit snapshots, flagging system, and comprehensive action logging.

### 3. Event Management
Movie night and game night tracking with voice channel attendance monitoring, qualification thresholds, tier-based role rewards, and manual credit/adjustment support.

### 4. Artist Rotation
Queue-based artist assignment system with rotation tracking, job management, leaderboards, and assignment history.

### 5. Content Safety
Google Cloud Vision integration for avatar NSFW detection, multiple AI content detection APIs (Hive, SightEngine, RapidAI, Optic), and configurable thresholds.

### 6. Analytics & Observability
Activity heatmaps, moderator statistics, approval rate tracking, structured logging via Pino, and Sentry error/performance monitoring.

### 7. Scheduled Background Tasks
7 schedulers for event timeouts, security audits, byte multiplier expiration, disk space monitoring, stale application cleanup, moderator metrics, and health checks.

## Project Statistics

| Metric | Value |
|--------|-------|
| TypeScript Source Files | 120+ |
| Slash Commands | 37 |
| Feature Modules | 20+ |
| Database Migrations | 45 |
| Database Tables | 30+ |
| Background Schedulers | 7 |
| State Stores | 9 |
| Test Files | 100+ |
| Existing Documentation Files | 67+ |

## Links to Detailed Documentation

- [Architecture](./architecture.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [API Contracts (Commands & Interactions)](./api-contracts.md)
- [Data Models (Database Schema)](./data-models.md)
- [Development Guide](./development-guide.md)
- [Existing Architecture Overview](./architecture/system-overview.md)
- [Existing Database Schema Reference](./reference/database-schema.md)
- [Operations & Deployment](./operations/deployment-config.md)
- [Troubleshooting](./operations/troubleshooting.md)

## Getting Started

```bash
# Clone and install
git clone https://github.com/watchthelight/pawtropolis-tech.git
cd pawtropolis-tech && npm install

# Configure environment
cp .env.example .env
# Edit .env with your Discord bot token and credentials

# Development
npm run dev          # Hot reload development server

# Build & Test
npm run build        # tsup build
npm test             # vitest
npm run check        # typecheck + lint + format + test

# Deploy
./deploy.sh          # Full deploy (test + build + upload + restart)
./deploy.sh --fast   # Skip tests
```

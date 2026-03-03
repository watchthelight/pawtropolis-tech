# Pawtropolis Tech - Documentation Index

> Auto-generated master index | 2026-03-01 | Exhaustive Scan

## Project Overview

- **Type:** Monolith (single unified codebase)
- **Primary Language:** TypeScript 5.5
- **Architecture:** Event-driven modular backend (Discord.js 14 + SQLite)
- **Version:** 5.1.1

## Quick Reference

- **Runtime:** Node.js 20+ (ESM modules)
- **Framework:** Discord.js 14.16.3
- **Database:** SQLite (better-sqlite3 12.4.1) with WAL mode
- **Entry Point:** `src/index.ts` → `dist/index.js`
- **Server:** `ubuntu@34.193.75.138` (SSH alias: `bash-ec2`)
- **PM2 Process:** `pawtropolis`
- **License:** ANW-1.0

## Generated Documentation

- [Project Overview](./project-overview.md) - Executive summary, tech stack, feature areas, statistics
- [Architecture](./architecture.md) - System design, patterns, decisions, deployment architecture
- [Source Tree Analysis](./source-tree-analysis.md) - Complete annotated directory tree with annotations
- [API Contracts](./api-contracts.md) - All 37 slash commands, button/modal/select interactions, event listeners, HTTP endpoints
- [Data Models](./data-models.md) - Complete database schema (30+ tables, 45 migrations), data flows, indexes
- [Development Guide](./development-guide.md) - Setup, build, test, deploy, database management, CI/CD, troubleshooting

## Existing Documentation

### Architecture
- [System Overview](./architecture/system-overview.md) - Detailed system architecture, components, design decisions

### Staff Guides
- [Bot Handbook](./BOT-HANDBOOK.md) - Comprehensive command reference for all staff roles (2,687 lines)
- [Mod Handbook](./MOD-HANDBOOK.md) - Staff policies, moderation rules, verification procedures (1,287 lines)
- [Mod Quick Reference](./MOD-QUICKREF.md) - Cheat sheet for daily moderation work
- [Admin Guide](./ADMIN-GUIDE.md) - Administration tasks for Admins and Senior Admins
- [Moderator Guide](./MODERATOR-GUIDE.md) - Core moderation responsibilities
- [Gatekeeper Guide](./GATEKEEPER-GUIDE.md) - Essential gatekeeper and Junior Mod tasks
- [Leadership Guide](./LEADERSHIP-GUIDE.md) - Strategic responsibilities for CM, CDL, Server Owner

### Technical Reference
- [Slash Commands](./SLASH-COMMANDS.md) - Command system documentation and deployment
- [Permissions Matrix](./PERMS-MATRIX.md) - Permission requirements per command
- [Database Schema](./reference/database-schema.md) - SQLite table definitions and relationships
- [Gate Review Flow](./reference/gate-review-flow.md) - Application review workflow
- [Modmail System](./reference/modmail-system.md) - DM-to-thread routing
- [Logging & ModStats](./reference/logging-and-modstats.md) - Audit logging and moderator statistics
- [Send Command](./reference/send-command.md) - Anonymous staff messaging
- [Command Patterns](./reference/command-patterns.md) - Design patterns and conventions
- [Command Checklist](./reference/command-checklist.md) - Checklist for adding new commands
- [Command Refactor Checklist](./reference/command-refactor-checklist.md) - Refactoring guidelines

### Operations
- [Deployment Config](./operations/deployment-config.md) - Comprehensive deployment setup and configuration
- [Troubleshooting](./operations/troubleshooting.md) - Common problems and solutions
- [Deploy Agent](./operations/DEPLOY-AGENT.md) - Bot deployment procedures

### How-To Guides
- [Modmail Guide](./how-to/modmail-guide.md) - Step-by-step modmail usage
- [Backfill Activity](./how-to/backfill-activity.md) - Historical data backfill instructions

### Overview
- [Executive Summary](./overview/executive-summary.md) - Business-level overview
- [License FAQ](./overview/license-faq.md) - ANW-1.0 license Q&A

### Audits & Security
- [Security Audit Flow](./audit-security-flow.md) - Security audit workflow
- [Incidents Log](./INCIDENTS.md) - Production incidents and resolutions
- [Audit Final Report](./audits/AUDIT-FINAL-20260112.md) - Comprehensive codebase audit

### Internal Server Info
- [Roles](./internal-info/ROLES.md) - Complete server role list
- [Channels](./internal-info/CHANNELS.md) - All channels with permissions
- [Hierarchy](./internal-info/HIERARCHY.md) - Role and permission hierarchy
- [Conflicts](./internal-info/CONFLICTS.md) - Permission conflicts
- [Server Info](./internal-info/SERVER-INFO.md) - Server metadata

### Roadmap
- [Future Ideas](./roadmap/THINK_ABOUT_LATER.md) - Features to consider
- [Rejected Features](./roadmap/REJECTED.md) - Evaluated and rejected features with reasoning

### Root-Level Documentation
- [README](../README.md) - Project introduction and quick start
- [CLAUDE.md](../CLAUDE.md) - AI assistant project instructions
- [CHANGELOG](../CHANGELOG.md) - Version history
- [TODO](../TODO.md) - Task tracking

## Getting Started

### For Developers
1. Read the [Development Guide](./development-guide.md) for setup instructions
2. Review the [Architecture](./architecture.md) for system design
3. Check the [Source Tree](./source-tree-analysis.md) to find your way around
4. Reference [Command Patterns](./reference/command-patterns.md) when adding features

### For Staff
1. Start with the [Bot Handbook](./BOT-HANDBOOK.md) for command reference
2. Check your role-specific guide (Admin, Moderator, Gatekeeper, or Leadership)
3. Use the [Mod Quick Reference](./MOD-QUICKREF.md) for daily tasks

### For AI-Assisted Development
1. This `index.md` is your primary entry point
2. Reference [Architecture](./architecture.md) + [Data Models](./data-models.md) for understanding the system
3. Reference [API Contracts](./api-contracts.md) for all interaction entry points
4. Point PRD workflows to this file as the project knowledge source

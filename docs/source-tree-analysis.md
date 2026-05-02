# Source Tree Analysis

> Auto-generated project documentation | 2026-03-01 | Exhaustive Scan

## Directory Overview

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/` | TypeScript source code | `index.ts` (entry point, ~2143 lines) |
| `src/commands/` | Slash command handlers | 70+ files across subdirectories |
| `src/features/` | Core feature modules | 70+ files (gate, review, modmail, events, etc.) |
| `src/lib/` | Shared utilities | 40+ modules (logger, sentry, config, etc.) |
| `src/db/` | Database layer | `db.ts`, `ensure.ts` |
| `src/scheduler/` | Background schedulers | 7 scheduler modules |
| `src/store/` | State management | 9 store modules |
| `src/web/` | Web endpoints | `linkedRoles.ts`, `statusEndpoint.ts` |
| `scripts/` | Build, deploy, utility | 40+ scripts |
| `migrations/` | Database migrations | 45 versioned migration files |
| `tests/` | Test suite | 100+ test files mirroring src/ |
| `docs/` | Documentation | 67+ markdown files |

## Complete Annotated Source Tree

```
pawtropolis-tech/
├── src/                                         # TypeScript source
│   ├── index.ts                    [ENTRY]      # Main bot entry (~2143 lines) - Discord client, interaction routing
│   ├── config.ts                   [CONFIG]     # Core configuration
│   │
│   ├── commands/                                # Slash command handlers
│   │   ├── registry.ts             [CONFIG]     # Command registry
│   │   ├── buildCommands.ts                     # Command builder utility
│   │   ├── art.ts                               # Art management (~1283 lines)
│   │   ├── artistqueue.ts                       # Artist queue management
│   │   ├── attendance.ts                        # Event attendance tracking
│   │   ├── audit.ts                             # Audit reporting (~1684 lines)
│   │   ├── backfill.ts                          # Data backfill utilities
│   │   ├── database.ts                          # Database management
│   │   ├── developer.ts                         # Developer utilities
│   │   ├── flag.ts                              # Feature flag management
│   │   ├── gate.ts                              # Gate command dispatcher
│   │   ├── health.ts                            # Health check
│   │   ├── isitreal.ts                          # AI content verification
│   │   ├── listopen.ts                          # List open applications
│   │   ├── movie.ts                             # Movie night (deprecated)
│   │   ├── panic.ts                             # Emergency shutdown
│   │   ├── poke.ts                              # Poke feature
│   │   ├── purge.ts                             # Message purge
│   │   ├── redeemreward.ts                      # Reward redemption
│   │   ├── report.ts                            # User reports
│   │   ├── resetdata.ts                         # Data reset
│   │   ├── review-set-listopen-output.ts        # Configure listopen output
│   │   ├── roles.ts                             # Role management
│   │   ├── sample.ts                            # Sample data generation
│   │   ├── search.ts                            # Application search (~444 lines)
│   │   ├── send.ts                              # Anonymous messaging
│   │   ├── skullmode.ts                         # Skull mode toggle
│   │   ├── sync.ts                              # Command sync
│   │   ├── test.ts                              # Testing utilities
│   │   ├── unblock.ts                           # Unblock users
│   │   ├── update.ts                            # Force update
│   │   ├── usebyte.ts                           # Byte token usage
│   │   │
│   │   ├── config/                              # Configuration subcommands
│   │   │   ├── index.ts                         # Config main handler
│   │   │   ├── get.ts                           # Get config values
│   │   │   ├── shared.ts          [LIB]         # Shared config utilities
│   │   │   ├── setChannels.ts                   # Channel config
│   │   │   ├── setRoles.ts                      # Role config
│   │   │   ├── setFeatures.ts                   # Feature flags
│   │   │   ├── setAdvanced.ts                   # Advanced settings
│   │   │   ├── artist.ts                        # Artist rotation config
│   │   │   ├── game.ts                          # Game night config
│   │   │   ├── movie.ts                         # Movie night config
│   │   │   ├── poke.ts                          # Poke config
│   │   │   ├── data.ts                          # Config data queries
│   │   │   ├── isitreal.ts                      # AI detection config
│   │   │   └── toggleapis.ts                    # API toggles
│   │   │
│   │   ├── event/                               # Event management
│   │   │   ├── index.ts                         # Event command handler
│   │   │   ├── game.ts                          # Game night events
│   │   │   ├── movie.ts                         # Movie night events
│   │   │   └── data.ts                          # Event data queries
│   │   │
│   │   ├── gate/                                # Gatekeeping subcommands
│   │   │   ├── index.ts                         # Gate subcommand registry
│   │   │   ├── gateMain.ts                      # Main gate submission handler
│   │   │   ├── accept.ts                        # Application acceptance
│   │   │   ├── reject.ts                        # Application rejection
│   │   │   ├── kick.ts                          # Member kick
│   │   │   ├── unclaim.ts                       # Release claim
│   │   │   └── shared.ts         [LIB]          # Shared gate utilities
│   │   │
│   │   ├── help/                                # Help system
│   │   │   ├── index.ts                         # Main help command
│   │   │   ├── registry.ts                      # Help content registry
│   │   │   ├── cache.ts                         # Help cache
│   │   │   ├── autocomplete.ts                  # Autocomplete
│   │   │   ├── data.ts                          # Help content
│   │   │   ├── embeds.ts                        # Embed builders
│   │   │   ├── components.ts                    # UI components
│   │   │   └── metadata.ts                      # Command metadata
│   │   │
│   │   ├── review/                              # Review config subcommands
│   │   │   ├── getNotifyConfig.ts               # Get notification settings
│   │   │   └── setNotifyConfig.ts               # Set notification settings
│   │   │
│   │   └── stats/                               # Statistics subcommands
│   │       ├── index.ts                         # Stats main handler
│   │       ├── activity.ts                      # Activity stats
│   │       ├── approvalRate.ts                  # Approval rate
│   │       ├── data.ts                          # Stats queries
│   │       ├── export.ts                        # Data export
│   │       ├── history.ts                       # Historical data
│   │       ├── leaderboard.ts                   # Leaderboard
│   │       ├── reset.ts                         # Stats reset
│   │       ├── shared.ts         [LIB]          # Shared stats utilities
│   │       └── user.ts                          # User-specific stats
│   │
│   ├── config/                                  # Configuration modules
│   │   ├── flaggerStore.ts       [CONFIG]       # Feature flag store
│   │   └── loggingStore.ts       [CONFIG]       # Logging config store
│   │
│   ├── constants/                               # Application constants
│   │   └── sampleData.ts                        # Sample/template data
│   │
│   ├── db/                                      # Database layer
│   │   ├── db.ts                 [DB]           # SQLite connection (~386 lines)
│   │   └── ensure.ts             [DB]           # Schema validation/creation
│   │
│   ├── events/                                  # Discord event listeners
│   │   └── forumPostNotify.ts                   # Forum post notifications
│   │
│   ├── features/                                # Core feature modules
│   │   ├── gate.ts               [FEATURE]      # Gatekeeping (~1391 lines)
│   │   ├── review.ts             [FEATURE]      # Review mechanics
│   │   ├── modmail.ts            [FEATURE]      # Modmail dispatcher
│   │   ├── movieNight.ts         [FEATURE]      # Movie night management
│   │   ├── activityTracker.ts    [FEATURE]      # Activity tracking
│   │   ├── avatarScan.ts         [FEATURE]      # Avatar scanning
│   │   ├── avatarNsfwMonitor.ts  [FEATURE]      # NSFW avatar detection
│   │   ├── bannerSync.ts         [FEATURE]      # Banner synchronization
│   │   ├── botDetection.ts       [FEATURE]      # Bot detection
│   │   ├── byteTokenHandler.ts   [FEATURE]      # Byte token management
│   │   ├── dbRecovery.ts         [FEATURE]      # Database recovery
│   │   ├── dbRecoveryButtons.ts                 # Recovery UI buttons
│   │   ├── googleVision.ts       [FEATURE]      # Google Vision API
│   │   ├── levelRewards.ts       [FEATURE]      # Level-based rewards
│   │   ├── logger.ts             [FEATURE]      # Feature logging
│   │   ├── messageActivityLogger.ts [FEATURE]   # Message logging
│   │   ├── metricsEpoch.ts       [FEATURE]      # Metrics epoch
│   │   ├── modPerformance.ts     [FEATURE]      # Moderator performance
│   │   ├── notifyConfig.ts       [FEATURE]      # Notification config
│   │   ├── opsHealth.ts          [FEATURE]      # Health monitoring
│   │   ├── panicStore.ts         [FEATURE]      # Panic mode state
│   │   ├── reviewActions.ts      [FEATURE]      # Review action tracking
│   │   ├── roleAutomation.ts     [FEATURE]      # Automatic roles
│   │   ├── securityDiff.ts       [FEATURE]      # Security diffs
│   │   ├── serverAuditDocs.ts    [FEATURE]      # Audit documentation
│   │   ├── statusStore.ts        [FEATURE]      # Bot status
│   │   ├── welcome.ts            [FEATURE]      # Welcome messages
│   │   ├── appLookup.ts          [FEATURE]      # Application lookup
│   │   │
│   │   ├── aiDetection/                         # AI detection systems
│   │   │   ├── index.ts                         # Unified interface
│   │   │   ├── types.ts                         # Type definitions
│   │   │   ├── health.ts                        # Health monitoring
│   │   │   ├── optic.ts                         # Optic API
│   │   │   ├── hive.ts                          # Hive AI
│   │   │   ├── rapidai.ts                       # RapidAI
│   │   │   └── sightengine.ts                   # SightEngine API
│   │   │
│   │   ├── analytics/                           # Analytics & metrics
│   │   │   ├── queries.ts                       # Analytics queries (~528 lines)
│   │   │   ├── approvalRate.ts                  # Approval rate analytics
│   │   │   ├── approvalRateCommand.ts           # Approval rate command
│   │   │   └── command.ts                       # Command analytics
│   │   │
│   │   ├── artJobs/                             # Art job management
│   │   │   ├── index.ts                         # Art jobs main
│   │   │   ├── store.ts                         # Job store
│   │   │   └── types.ts                         # Type definitions
│   │   │
│   │   ├── artistRotation/                      # Artist rotation
│   │   │   ├── index.ts                         # Rotation main
│   │   │   ├── constants.ts                     # Constants
│   │   │   ├── handlers.ts                      # Event handlers
│   │   │   ├── queue.ts                         # Queue management
│   │   │   ├── roleSync.ts                      # Role sync
│   │   │   └── types.ts                         # Type definitions
│   │   │
│   │   ├── events/                              # Event system
│   │   │   ├── index.ts                         # Events main
│   │   │   ├── gameNight.ts                     # Game night
│   │   │   ├── gameQualification.ts             # Qualification logic
│   │   │   └── types.ts                         # Type definitions
│   │   │
│   │   ├── gate/                                # Gate submodules
│   │   │   └── questions.ts                     # Gate questions
│   │   │
│   │   ├── modmail/                             # Modmail system
│   │   │   ├── index.ts                         # Modmail main
│   │   │   ├── commands.ts                      # Modmail commands
│   │   │   ├── handlers.ts                      # Event handlers
│   │   │   ├── routing.ts                       # Message routing
│   │   │   ├── threadOpen.ts                    # Thread creation
│   │   │   ├── threadClose.ts                   # Thread closure
│   │   │   ├── threadReopen.ts                  # Thread reopening
│   │   │   ├── threadState.ts                   # Thread state
│   │   │   ├── threadPerms.ts                   # Thread permissions
│   │   │   ├── threads.ts                       # Thread queries
│   │   │   ├── tickets.ts                       # Ticket management
│   │   │   ├── transcript.ts                    # Transcripts
│   │   │   └── types.ts                         # Type definitions
│   │   │
│   │   ├── modstats/                            # Moderator statistics
│   │   │   └── reset.ts                         # Stats reset
│   │   │
│   │   ├── report/                              # Report system
│   │   │   ├── index.ts                         # Report main
│   │   │   ├── handlers.ts                      # Report handlers
│   │   │   └── types.ts                         # Type definitions
│   │   │
│   │   └── review/                              # Application review
│   │       ├── index.ts                         # Review main
│   │       ├── card.ts                          # Review card builder
│   │       ├── claims.ts                        # Claim management
│   │       ├── handlers.ts                      # Event handlers
│   │       ├── queries.ts                       # Review queries
│   │       ├── types.ts                         # Type definitions
│   │       ├── welcome.ts                       # Welcome flow
│   │       ├── flows/                           # Decision flows
│   │       │   ├── index.ts                     # Flows dispatcher
│   │       │   ├── approve.ts                   # Approval flow
│   │       │   ├── reject.ts                    # Rejection flow
│   │       │   └── kick.ts                      # Kick flow
│   │       └── handlers/                        # Interaction handlers
│   │           ├── index.ts                     # Handlers dispatcher
│   │           ├── actionRunners.ts             # Action execution
│   │           ├── buttons.ts                   # Button interactions
│   │           ├── claimHandlers.ts             # Claim handling
│   │           ├── helpers.ts    [LIB]          # Helper functions
│   │           └── modals.ts                    # Modal interactions
│   │
│   ├── lib/                                     # Shared utilities
│   │   ├── logger.ts             [LIB]          # Pino logging (~164 lines)
│   │   ├── sentry.ts             [LIB]          # Sentry integration
│   │   ├── env.ts                [LIB]          # Environment validation (Zod)
│   │   ├── config.ts             [LIB]          # Configuration utilities
│   │   ├── cmdWrap.ts            [LIB]          # Command wrapper/decorator
│   │   ├── eventWrap.ts          [LIB]          # Event handler wrapper
│   │   ├── buildInfo.ts          [LIB]          # Build metadata
│   │   ├── errorCard.ts          [LIB]          # Error message cards
│   │   ├── errorCardV2.ts        [LIB]          # Error cards v2
│   │   ├── errors.ts             [LIB]          # Error definitions
│   │   ├── ids.ts                [LIB]          # ID/snowflake utilities
│   │   ├── dt.ts                 [LIB]          # DateTime utilities
│   │   ├── time.ts               [LIB]          # Time utilities
│   │   ├── timefmt.ts            [LIB]          # Time formatting
│   │   ├── csv.ts                [LIB]          # CSV generation
│   │   ├── roles.ts              [LIB]          # Role utilities
│   │   ├── owner.ts              [LIB]          # Owner/admin checks
│   │   ├── constants.ts          [LIB]          # App constants
│   │   ├── lruCache.ts           [LIB]          # LRU cache
│   │   ├── rateLimiter.ts        [LIB]          # Rate limiting
│   │   ├── notifyLimiter.ts      [LIB]          # Notification limiter
│   │   ├── retry.ts              [LIB]          # Retry logic
│   │   ├── secureCompare.ts      [LIB]          # Secure string compare
│   │   ├── percentiles.ts        [LIB]          # Percentile calculations
│   │   ├── anomaly.ts            [LIB]          # Anomaly detection
│   │   ├── autoDelete.ts         [LIB]          # Auto-delete messages
│   │   ├── activityHeatmap.ts    [LIB]          # Activity visualization
│   │   ├── leaderboardImage.ts   [LIB]          # Leaderboard images
│   │   ├── configCard.ts         [LIB]          # Config UI cards
│   │   ├── permissionCard.ts     [LIB]          # Permission UI cards
│   │   ├── modalPatterns.ts      [LIB]          # Modal patterns
│   │   ├── commandSync.ts        [LIB]          # Discord command sync
│   │   ├── dbHealthCheck.ts      [LIB]          # DB health checking
│   │   ├── syncMarker.ts         [LIB]          # Sync marker
│   │   ├── traceStore.ts         [LIB]          # Trace/debug store
│   │   ├── typeGuards.ts         [LIB]          # TypeScript guards
│   │   ├── reqctx.ts             [LIB]          # Request context
│   │   ├── pm2.ts                [LIB]          # PM2 integration
│   │   ├── schedulerHealth.ts    [LIB]          # Scheduler health
│   │   ├── wideEvent.ts          [LIB]          # Wide event system
│   │   └── wideEventEmitter.ts   [LIB]          # Wide event emitter
│   │
│   ├── listeners/                               # Discord event listeners
│   │   ├── messageDadMode.ts                    # Dad joke listener
│   │   └── messageSkullMode.ts                  # Skull mode listener
│   │
│   ├── logging/                                 # Logging system
│   │   ├── embeds.ts                            # Log embed builders
│   │   └── pretty.ts                            # Pretty-printed logs
│   │
│   ├── ops/                                     # Operational tools
│   │   └── dbRecoverCli.ts                      # Database recovery CLI
│   │
│   ├── scheduler/                               # Scheduled tasks
│   │   ├── byteMultiplierScheduler.ts           # Byte multiplier expiry
│   │   ├── diskSpaceScheduler.ts                # Disk space monitoring
│   │   ├── eventTimeoutScheduler.ts             # Event timeout (12hr auto-end)
│   │   ├── modMetricsScheduler.ts               # Mod metrics aggregation
│   │   ├── opsHealthScheduler.ts                # Health checks
│   │   ├── securityAuditScheduler.ts            # Security audit scheduling
│   │   └── staleApplicationCheck.ts             # Stale app cleanup
│   │
│   ├── store/                                   # State management
│   │   ├── acknowledgedSecurityStore.ts         # Security acknowledgments
│   │   ├── aiDetectionToggles.ts                # AI detection flags
│   │   ├── auditFindingsStore.ts                # Audit findings
│   │   ├── auditSessionStore.ts                 # Audit sessions
│   │   ├── byteMultiplierStore.ts               # Byte multipliers
│   │   ├── flagsStore.ts                        # Feature flags
│   │   ├── gameConfigStore.ts                   # Game config
│   │   ├── nsfwFlagsStore.ts                    # NSFW flags
│   │   └── securitySnapshotStore.ts             # Security snapshots
│   │
│   ├── ui/                                      # UI components
│   │   ├── dbRecoveryCard.ts                    # Recovery UI
│   │   └── reviewCard.ts                        # Review card UI
│   │
│   └── web/                                     # Web endpoints
│       ├── linkedRoles.ts                       # Discord OAuth2 linked roles
│       └── statusEndpoint.ts                    # Health/status API
│
├── scripts/                                     # Build & utility scripts
│   ├── deploy.sh                                # Full deployment script
│   ├── start.sh                                 # Unix start/stop
│   ├── start.cmd                                # Windows start
│   ├── switch.sh                                # Environment switching
│   ├── smoke-test.sh                            # Smoke tests
│   ├── commands.ts                              # Slash command registration
│   ├── deploy-commands.ts                       # Command deployment
│   ├── print-commands.ts                        # Debug: print commands
│   ├── inject-build-info.ts                     # Build metadata injection
│   ├── migrate.ts                               # Migration runner
│   ├── migrate-remote.js                        # Remote migration
│   ├── verify-db-integrity.js                   # DB integrity checks
│   ├── scan-legacy.ts                           # Legacy code scanner
│   ├── auth-check.ts                            # Auth verification
│   ├── backfill-app-mappings.ts                 # App mapping backfill
│   ├── backfill-message-activity.ts             # Activity backfill
│   ├── audit-server-full.ts                     # Full server audit
│   ├── record-audit-findings.ts                 # Record audit results
│   ├── batch-acknowledge-security.ts            # Security acknowledgments
│   ├── check-bot-permissions.ts                 # Permission verification
│   ├── check-channel-access.ts                  # Channel access check
│   ├── cleanup-test-data.ts                     # Test data cleanup
│   ├── diagnostic-activity.ts                   # Activity diagnostics
│   ├── fetch-channel.ts                         # Channel info fetch
│   ├── fetch-role-data.ts                       # Role data fetch
│   ├── fetch-roles.ts                           # All roles fetch
│   ├── lookup-users.ts                          # User lookup
│   ├── generate-badge-metrics.js                # Badge generation
│   ├── register-role-metadata.ts                # Discord role metadata
│   ├── test-heatmap.ts                          # Heatmap testing
│   └── sqlpeek.cjs                              # SQLite CLI utility
│
├── migrations/                                  # Database migrations (45 files)
│   ├── lib/helpers.ts            [DB]           # Migration utilities
│   ├── 001_add_logging_channel_id.ts            # Logging channel
│   ├── 002_create_mod_metrics.ts                # Moderator metrics
│   ├── 003_create_user_cache.ts                 # User cache
│   ├── 004_metrics_epoch_and_joins.ts           # Metrics epoch
│   ├── 005_flags_config.ts                      # Feature flags
│   ├── 008_manual_flags.ts                      # Manual flags
│   ├── 010_limit_questions_to_5.ts              # Question limits
│   ├── 011_add_custom_status_column.ts          # Custom status
│   ├── 012_add_db_backups_table.ts              # Backup tracking
│   ├── 013_add_health_alerts_table.ts           # Health alerts
│   ├── 017_add_notify_config.ts                 # Notifications
│   ├── 018_add_ping_dev_on_app.ts               # Dev ping
│   ├── 019_add_app_short_codes_table.ts         # HEX6 shortcodes
│   ├── 020_add_message_activity_table.ts        # Message activity
│   ├── 021_add_modmail_message_content.ts       # Modmail content
│   ├── 022_transcript_index.ts                  # Transcript index
│   ├── 023_user_activity_indexes.ts             # Activity indexes
│   ├── 024_review_action_index.ts               # Review indexes
│   ├── 025_role_automation.ts                   # Role automation
│   ├── 026_sync_marker.ts                       # Sync tracking
│   ├── 027_standardize_timestamps.ts            # Timestamp fix
│   ├── 028_review_action_free_text.ts           # Free-text actions
│   ├── 029_add_movie_threshold.ts               # Movie threshold
│   ├── 030_add_support_channel_id.ts            # Support channel
│   ├── 031_add_configurable_settings.ts         # Config settings
│   ├── 032_nsfw_flags.ts                        # NSFW detection
│   ├── 033_audit_sessions.ts                    # Audit sessions
│   ├── 034_add_performance_indexes.ts           # Performance indexes
│   ├── 035_drop_unused_tables.ts                # Cleanup tables
│   ├── 036_movie_session_persistence.ts         # Session persistence
│   ├── 037_ai_detection_toggles.ts              # AI toggles
│   ├── 038_add_critical_indexes.ts              # Critical indexes
│   ├── 039_fix_art_job_unique.ts                # Art job constraint
│   ├── 040_event_attendance_unification.ts      # Event unification
│   ├── 041_acknowledged_security_issues.ts      # Security ack
│   ├── 042_security_audit_snapshots.ts          # Audit snapshots
│   ├── 043_audit_findings.ts                    # Audit findings
│   ├── 044_active_byte_multipliers.ts           # Byte multipliers
│   └── 045_report_forum_config.ts               # Forum config
│
├── tests/                                       # Test suite (mirrors src/)
│   ├── commands/                                # Command tests
│   │   ├── gate/                                # Gate tests (6 files)
│   │   ├── help/                                # Help tests (8 files)
│   │   ├── stats/                               # Stats tests (4 files)
│   │   ├── review/                              # Review tests (3 files)
│   │   └── poke.test.ts
│   ├── config/                                  # Config tests (2 files)
│   ├── db/                                      # Database tests
│   ├── events/                                  # Event tests
│   ├── features/                                # Feature tests (50+ files)
│   │   ├── aiDetection/                         # AI detection tests
│   │   ├── analytics/                           # Analytics tests
│   │   ├── artistRotation/                      # Artist rotation tests
│   │   ├── artJobs/                             # Art jobs tests
│   │   ├── events/                              # Event system tests
│   │   ├── gate/                                # Gate tests
│   │   ├── modmail/                             # Modmail tests (11 files)
│   │   ├── report/                              # Report tests
│   │   └── review/                              # Review tests (11 files)
│   ├── lib/                                     # Library tests (30+ files)
│   ├── listeners/                               # Listener tests
│   ├── logging/                                 # Logging tests
│   ├── scheduler/                               # Scheduler tests
│   ├── store/                                   # Store tests
│   ├── ui/                                      # UI tests
│   └── web/                                     # Web endpoint tests
│
├── docs/                                        # Documentation
│   ├── architecture/                            # Architecture docs
│   ├── audits/                                  # Audit reports
│   ├── how-to/                                  # How-to guides
│   ├── internal-info/                           # Internal reference
│   ├── operations/                              # Operations guides
│   ├── overview/                                # Overview docs
│   ├── reference/                               # Reference docs
│   ├── roadmap/                                 # Roadmap
│   └── _archive/                                # Deprecated docs
│
├── audit/                                       # Command audit reports
│   └── commands/                                # Per-command audits (40+ files)
│
├── context/                                     # AI context documents
├── assets/                                      # Images, banners
├── authentication/                              # PEM keys (gitignored)
├── data/                                        # SQLite databases (gitignored)
│
├── .github/workflows/                           # CI/CD pipelines
│   ├── ci.yml                                   # Typecheck, lint, test, build
│   └── update-badges.yml                        # Badge generation
│
├── package.json                  [CONFIG]       # Dependencies & scripts
├── tsconfig.json                 [CONFIG]       # TypeScript config
├── tsup.config.ts                [CONFIG]       # Build config
├── vitest.config.ts              [CONFIG]       # Test config
├── eslint.config.js              [CONFIG]       # Linting config
├── .env.example                  [CONFIG]       # Environment template
├── deploy.sh                     [ENTRY]        # Deployment script
├── CLAUDE.md                     [CONFIG]       # Project instructions
├── README.md                                    # Project overview
├── CHANGELOG.md                                 # Version history
├── TODO.md                                      # Task tracking
└── LICENSE                                      # ANW-1.0
```

## Critical Folders Summary

| Folder | Role | Key Patterns |
|--------|------|-------------|
| `src/commands/` | All 37 slash command handlers | Modular per-command files, subcommand directories |
| `src/features/` | Business logic for all features | Self-contained modules with types, queries, handlers |
| `src/features/review/` | Core review system with flows and handlers | Decision flows (approve/reject/kick), button/modal handlers |
| `src/features/modmail/` | Complete modmail system | Thread lifecycle (open/close/reopen), DM routing, transcripts |
| `src/lib/` | 40+ shared utilities | Logging, error handling, rate limiting, caching |
| `src/scheduler/` | 7 background schedulers | Event timeouts, security audits, metrics, cleanup |
| `src/store/` | 9 state stores | Feature flags, multipliers, security snapshots |
| `migrations/` | 45 versioned schema changes | Incremental database evolution from v1 to current |

---

## See Also

- [Architecture](./architecture.md): design rationale and tech stack
- [Project Overview](./project-overview.md): high-level project summary
- [Development Guide](./development-guide.md): how to actually work in the tree
- [Slash Commands System](./SLASH-COMMANDS.md): how `src/commands/` is organized and registered
- [Database Schema](./reference/database-schema.md): what `migrations/` builds toward

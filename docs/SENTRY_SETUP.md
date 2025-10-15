# Sentry Error Tracking Setup

This guide explains how to set up Sentry error tracking for Pawtropolis Tech Gatekeeper.

## Overview

Sentry is integrated to provide:
- **Real-time error tracking** with full stack traces
- **Performance monitoring** for command execution
- **Breadcrumb tracking** for debugging context
- **User context** to see which users encountered errors
- **Release tracking** for version-specific issues
- **Automatic error capture** from logger errors and uncaught exceptions

## Quick Start

### 1. Create a Sentry Account

1. Go to [sentry.io](https://sentry.io) and create a free account
2. Create a new project for Node.js
3. Copy your DSN (Data Source Name) from the project settings

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
# Required: Your Sentry DSN
SENTRY_DSN=https://your-key@your-org.ingest.sentry.io/your-project-id

# Optional: Environment name (defaults to NODE_ENV)
SENTRY_ENVIRONMENT=production

# Optional: Performance sampling rate (0.0 to 1.0, default: 0.1)
# 0.1 = 10% of transactions are sent to Sentry
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### 3. Deploy and Monitor

That's it! Sentry will now automatically capture:
- Errors logged via `logger.error()` or `logger.fatal()`
- Uncaught exceptions
- Unhandled promise rejections
- Command execution failures

## Features

### Automatic Error Capture

All errors logged through the Pino logger are automatically sent to Sentry:

```typescript
logger.error({ err }, "Something went wrong");
// → Automatically captured in Sentry with full stack trace
```

### Command Execution Tracking

Every command execution is tracked with breadcrumbs:

```
1. "Executing command: /gate"
2. "Database query executed"
3. "Command completed: /gate"
```

If an error occurs, you'll see the full execution path leading up to the error.

### User Context

When a user executes a command, their Discord ID and username are automatically attached to any errors:

```typescript
// Automatically set for each interaction
setUser({
  id: interaction.user.id,
  username: interaction.user.username,
});
```

### Release Tracking

Errors are tagged with the bot version from `package.json`:

```
release: pawtropolis-tech@0.1.0
```

This lets you track which version introduced a bug.

### Sensitive Data Protection

The integration automatically:
- **Redacts Discord tokens** from error messages using regex
- **Scrubs environment variables** before sending to Sentry
- **Filters specific error types** (Discord API errors, network timeouts)

## Sentry API Usage

### Manual Error Capture

```typescript
import { captureException, captureMessage } from "./lib/sentry.js";

try {
  // Your code
} catch (err) {
  captureException(err, {
    customContext: "Additional debugging info",
    userId: user.id,
  });
}
```

### Adding Breadcrumbs

```typescript
import { addBreadcrumb } from "./lib/sentry.js";

addBreadcrumb({
  message: "User started application process",
  category: "application",
  level: "info",
  data: {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  },
});
```

### Setting Custom Tags

```typescript
import { setTag, setContext } from "./lib/sentry.js";

// Add tags for filtering in Sentry dashboard
setTag("feature", "gate_system");
setTag("guild_id", guildId);

// Add context for additional debugging info
setContext("guild_config", {
  hasReviewChannel: !!config.review_channel_id,
  cooldownHours: config.reapply_cooldown_hours,
});
```

## Performance Monitoring

Sentry automatically tracks:
- Command execution duration
- Database query performance (via Node profiling)
- HTTP requests to Discord API

View performance data in the Sentry dashboard under "Performance".

### Sampling Rate

The `SENTRY_TRACES_SAMPLE_RATE` controls what percentage of transactions are sent to Sentry:

- `0.0` = No performance monitoring (errors only)
- `0.1` = 10% of transactions (recommended for production)
- `1.0` = 100% of transactions (use for development/debugging)

Lower rates reduce Sentry quota usage while still providing statistical insights.

## Troubleshooting

### Errors Not Appearing in Sentry

1. **Check DSN is set**: Run `echo $SENTRY_DSN` to verify
2. **Check logs**: Look for "Sentry initialized" in application logs
3. **Test manually**:
   ```typescript
   import { captureMessage } from "./lib/sentry.js";
   captureMessage("Test message", "info");
   ```
4. **Verify network**: Ensure bot can reach `*.ingest.sentry.io`

### Disable Sentry

Simply remove or comment out `SENTRY_DSN` from your `.env` file:

```env
# SENTRY_DSN=https://...
```

The bot will log: "Sentry DSN not configured, error tracking disabled"

### High Quota Usage

1. **Reduce sample rate**: Lower `SENTRY_TRACES_SAMPLE_RATE` to 0.05 or 0.01
2. **Add error filters**: Edit `ignoreErrors` in [src/lib/sentry.ts](../src/lib/sentry.ts)
3. **Check for error loops**: Look for repetitive errors in Sentry dashboard

## Graceful Shutdown

When the bot shuts down (SIGTERM/SIGINT), Sentry automatically:
1. Flushes any pending events to Sentry servers
2. Waits up to 2 seconds for upload to complete
3. Logs success or failure

This ensures errors aren't lost during deployment or crashes.

## Best Practices

### ✅ Do

- Leave Sentry enabled in production for monitoring
- Set `SENTRY_ENVIRONMENT` to distinguish prod/staging/dev
- Review Sentry dashboard weekly for trends
- Create alerts for critical errors
- Use breadcrumbs to add debugging context

### ❌ Don't

- Log sensitive user data in breadcrumbs or contexts
- Use sample rate of 1.0 in production (expensive)
- Ignore Sentry alerts (they indicate real problems)
- Capture expected errors (e.g., validation failures)

## Sentry Dashboard Tips

### Viewing Errors

1. Go to **Issues** tab
2. Filter by environment: `environment:production`
3. Sort by frequency or recency
4. Click an issue to see:
   - Stack trace
   - Breadcrumbs (execution path)
   - User context
   - Tags and custom context

### Performance Insights

1. Go to **Performance** tab
2. View transaction types:
   - `/gate` command
   - `/health` command
3. Identify slow operations
4. Drill down into specific transactions

### Creating Alerts

1. Go to **Alerts** tab
2. Create rule: "Send email when error count > 10 in 1 hour"
3. Configure Slack/Discord webhook for notifications

## Cost Management

Sentry's free tier includes:
- 5,000 errors per month
- 10,000 performance transactions per month

For a typical Discord bot:
- **10% sample rate** = ~300 transactions/day for 100 commands/day
- **Error rate** varies (usually < 1% of commands)

If you exceed limits, consider:
1. Lowering `SENTRY_TRACES_SAMPLE_RATE`
2. Upgrading to paid tier ($26/month)
3. Using Sentry only in production

## Security Note

**Never commit your Sentry DSN to version control!**

The DSN is not as sensitive as your Discord token (it only allows sending errors, not reading them), but:
- Anyone with the DSN can send fake errors to your project
- It counts against your quota
- It's considered bad practice

Always use environment variables and keep `.env` in `.gitignore`.

## Support

- **Sentry Docs**: https://docs.sentry.io/platforms/node/
- **Sentry Support**: support@sentry.io
- **Bot Issues**: https://github.com/watchthelight/pawtropolis-tech/issues

---

**Last Updated**: 2025-10-15
**Sentry SDK Version**: @sentry/node v10.20.0

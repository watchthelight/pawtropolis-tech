/**
 * Pawtropolis Tech — scripts/fetch-channel.ts
 * WHAT: Fetch messages from any Discord channel, thread, or forum and save to markdown
 * WHY: Archive channel content for documentation, reference, or debugging
 * USAGE:
 *   npx dotenvx run -- tsx scripts/fetch-channel.ts <channel_or_thread_id> [output_file] [--limit N]
 *
 * EXAMPLES:
 *   # Fetch a thread to default docs/ location
 *   npx dotenvx run -- tsx scripts/fetch-channel.ts 1459188472505172143
 *
 *   # Fetch with custom output file
 *   npx dotenvx run -- tsx scripts/fetch-channel.ts 1234567890 ./archive/thread.md
 *
 *   # Fetch with message limit (0 = no limit)
 *   npx dotenvx run -- tsx scripts/fetch-channel.ts 1234567890 output.md --limit 1000
 *
 *   # Output to stdout (use - as filename)
 *   npx dotenvx run -- tsx scripts/fetch-channel.ts 1234567890 -
 *
 * SUPPORTED CHANNEL TYPES:
 *   - Text channels: Fetches all messages
 *   - Announcement channels: Fetches all messages
 *   - Threads (public/private): Fetches all messages in the thread
 *   - Forum channels: Fetches all posts (threads) and their messages
 */

import {
  Client,
  GatewayIntentBits,
  TextChannel,
  ChannelType,
  ForumChannel,
  ThreadChannel,
  type Message,
  type AnyThreadChannel,
  NewsChannel,
} from "discord.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Parse arguments
const args = process.argv.slice(2);
const channelId = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--limit"));
const limitArg = args.find((a, i) => args[i - 1] === "--limit");
const messageLimit = limitArg ? parseInt(limitArg, 10) : 0; // 0 = no limit

// Find output file (second positional arg that's not the channel ID)
const positionalArgs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");
const outputArg = positionalArgs[1];
const outputFile = outputArg || `docs/channel-${channelId}.md`;
const useStdout = outputFile === "-";

if (!channelId) {
  console.error(`Usage: npx dotenvx run -- tsx scripts/fetch-channel.ts <channel_or_thread_id> [output_file] [--limit N]

Options:
  channel_or_thread_id  The Discord channel, thread, or forum ID to fetch
  output_file           Output file path (default: docs/channel-<id>.md, use "-" for stdout)
  --limit N             Maximum messages to fetch (0 = no limit, default: 0)

Examples:
  # Fetch a thread
  npx dotenvx run -- tsx scripts/fetch-channel.ts 1459188472505172143

  # Fetch to custom file with 500 message limit
  npx dotenvx run -- tsx scripts/fetch-channel.ts 1234567890 ./archive.md --limit 500

  # Output to stdout (pipe to other tools)
  npx dotenvx run -- tsx scripts/fetch-channel.ts 1234567890 - | less
`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

/**
 * Format a single message to markdown
 */
function formatMessage(msg: Message): string {
  const timestamp = msg.createdAt.toISOString();
  const author = msg.author.tag;
  const content = msg.content || "(no text content)";

  let entry = `### ${author} — ${timestamp}\n\n${content}`;

  // Include embeds
  if (msg.embeds.length > 0) {
    for (const embed of msg.embeds) {
      entry += "\n\n**[Embed]**";
      if (embed.title) entry += `\n**Title:** ${embed.title}`;
      if (embed.url) entry += ` (${embed.url})`;
      if (embed.description) entry += `\n${embed.description}`;
      if (embed.fields.length > 0) {
        for (const field of embed.fields) {
          entry += `\n**${field.name}:** ${field.value}`;
        }
      }
      if (embed.image) entry += `\n**Image:** ${embed.image.url}`;
      if (embed.footer) entry += `\n*${embed.footer.text}*`;
    }
  }

  // Include attachments
  if (msg.attachments.size > 0) {
    entry += "\n\n**Attachments:**";
    for (const [, att] of msg.attachments) {
      entry += `\n- [${att.name}](${att.url})`;
    }
  }

  // Include reactions if any
  if (msg.reactions.cache.size > 0) {
    const reactions = msg.reactions.cache.map((r) => `${r.emoji} (${r.count})`).join(" ");
    entry += `\n\n*Reactions: ${reactions}*`;
  }

  // Note if message is a reply
  if (msg.reference?.messageId) {
    entry = `> *Reply to message*\n\n${entry}`;
  }

  return entry;
}

/**
 * Fetch all messages from a text-based channel or thread
 */
async function fetchMessagesFromChannel(
  channel: TextChannel | ThreadChannel | NewsChannel,
  limit: number = 0
): Promise<string[]> {
  const messages: string[] = [];
  let lastId: string | undefined;
  let fetchedCount = 0;

  // Log progress for long fetches
  const logProgress = () => {
    if (!useStdout) {
      process.stdout.write(`\r  Fetched ${fetchedCount} messages...`);
    }
  };

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(lastId ? { before: lastId } : {}),
    });

    if (fetched.size === 0) break;

    fetchedCount += fetched.size;
    logProgress();

    // Sort by timestamp (oldest first for this batch)
    const sorted = [...fetched.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    for (const msg of sorted) {
      messages.unshift(formatMessage(msg));
    }

    lastId = fetched.last()?.id;

    // Check limit
    if (limit > 0 && fetchedCount >= limit) {
      if (!useStdout) console.log(`\n  Reached ${limit} message limit`);
      break;
    }
  }

  if (!useStdout && fetchedCount > 0) console.log(""); // Newline after progress

  // Reverse to get chronological order
  messages.reverse();
  return messages;
}

/**
 * Build metadata header for the output
 */
function buildHeader(
  name: string,
  type: string,
  guildName: string,
  messageCount: number,
  extraInfo?: Record<string, string>
): string {
  let header = `# ${type}: ${name}

**Channel ID:** ${channelId}
**Guild:** ${guildName}
**Fetched:** ${new Date().toISOString()}
**Total messages:** ${messageCount}`;

  if (extraInfo) {
    for (const [key, value] of Object.entries(extraInfo)) {
      header += `\n**${key}:** ${value}`;
    }
  }

  header += "\n\n---\n\n";
  return header;
}

/**
 * Output the content to file or stdout
 */
function outputContent(content: string): void {
  if (useStdout) {
    console.log(content);
  } else {
    const outputPath = join(process.cwd(), outputFile);
    writeFileSync(outputPath, content);
    console.log(`\nSaved to ${outputFile}`);
  }
}

client.once("ready", async () => {
  if (!useStdout) console.log(`Logged in as ${client.user?.tag}`);

  try {
    const channel = await client.channels.fetch(channelId);

    if (!channel) {
      console.error(`Channel ${channelId} not found`);
      process.exit(1);
    }

    // Handle threads (public or private)
    if (channel.isThread()) {
      const thread = channel as AnyThreadChannel;
      if (!useStdout) console.log(`Fetching messages from thread: ${thread.name}...`);

      const messages = await fetchMessagesFromChannel(thread, messageLimit);

      const extraInfo: Record<string, string> = {};
      if (thread.createdAt) extraInfo["Created"] = thread.createdAt.toISOString();
      if (thread.archived) extraInfo["Status"] = "Archived";
      if (thread.parentId) extraInfo["Parent Channel"] = thread.parentId;
      if (thread.ownerId) extraInfo["Thread Owner"] = thread.ownerId;

      const output =
        buildHeader(
          thread.name,
          "Thread",
          thread.guild?.name || "Unknown",
          messages.length,
          extraInfo
        ) + messages.join("\n\n---\n\n");

      outputContent(output);
      client.destroy();
      process.exit(0);
    }

    // Handle forum channels
    if (channel.type === ChannelType.GuildForum) {
      const forum = channel as ForumChannel;
      if (!useStdout) console.log(`Fetching threads from forum: #${forum.name}...`);

      // Fetch all threads (active and archived)
      const activeThreads = await forum.threads.fetchActive();
      const archivedThreads = await forum.threads.fetchArchived();

      const allThreads = [
        ...activeThreads.threads.values(),
        ...archivedThreads.threads.values(),
      ];

      if (!useStdout) console.log(`Found ${allThreads.length} threads`);

      const threadContents: string[] = [];
      let totalMessages = 0;

      for (const thread of allThreads) {
        if (!useStdout) console.log(`  Reading thread: ${thread.name}`);
        const threadMessages = await fetchMessagesFromChannel(thread, messageLimit);
        totalMessages += threadMessages.length;

        const threadHeader = `## Thread: ${thread.name}

**Created:** ${thread.createdAt?.toISOString() || "Unknown"}
**Status:** ${thread.archived ? "Archived" : "Active"}
**Message count:** ${threadMessages.length}

`;
        threadContents.push(threadHeader + threadMessages.join("\n\n---\n\n"));
      }

      const output =
        buildHeader(`#${forum.name}`, "Forum", forum.guild.name, totalMessages, {
          "Total threads": String(allThreads.length),
        }) + threadContents.join("\n\n===\n\n");

      outputContent(output);
      client.destroy();
      process.exit(0);
    }

    // Handle regular text/announcement channels
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement
    ) {
      console.error(
        `Unsupported channel type: ${ChannelType[channel.type] || channel.type}`
      );
      console.error(
        "Supported types: Text, Announcement, Thread, Forum"
      );
      process.exit(1);
    }

    const textChannel = channel as TextChannel | NewsChannel;
    if (!useStdout) console.log(`Fetching messages from #${textChannel.name}...`);

    const messages = await fetchMessagesFromChannel(textChannel, messageLimit);

    const output =
      buildHeader(
        `#${textChannel.name}`,
        "Channel",
        textChannel.guild.name,
        messages.length
      ) + messages.join("\n\n---\n\n");

    outputContent(output);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN);

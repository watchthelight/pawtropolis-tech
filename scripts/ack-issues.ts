/**
 * One-time script to acknowledge all current security issues after hash fix deployment
 */
import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { analyzeSecurityOnly } from '../src/features/serverAuditDocs.js';
import { acknowledgeIssue, getAcknowledgedIssues } from '../src/store/acknowledgedSecurityStore.js';

dotenv.config();

const GUILD_ID = '896070888594759740';
const MY_USER_ID = '600968933293424640'; // Bash

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', async () => {
  console.log('Bot ready, fetching guild...');

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log('Guild not found');
    process.exit(1);
  }

  console.log('Fetching current security issues...');
  const issues = await analyzeSecurityOnly(guild);
  console.log(`Found ${issues.length} issues`);

  // Get already acknowledged
  const existing = getAcknowledgedIssues(guild.id);
  console.log(`Already acknowledged: ${existing.size}`);

  // Acknowledge all active issues
  let acknowledged = 0;

  for (const issue of issues) {
    const existingAck = existing.get(issue.issueKey);
    if (!existingAck || existingAck.permissionHash !== issue.permissionHash) {
      console.log(`Acknowledging: ${issue.id} - ${issue.title}`);
      acknowledgeIssue({
        guildId: guild.id,
        issueKey: issue.issueKey,
        severity: issue.severity,
        title: issue.title,
        permissionHash: issue.permissionHash,
        acknowledgedBy: MY_USER_ID,
        reason: 'Batch acknowledged after hash fix deployment',
      });
      acknowledged++;
    } else {
      console.log(`Already acked: ${issue.id} - ${issue.title}`);
    }
  }

  console.log(`\nAcknowledged ${acknowledged} issues`);
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);

import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from 'discord.js';
import 'dotenv/config';
import { writeFileSync } from 'node:fs';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const GUILD_ID = process.env.GUILD_ID || '896070888594759740';
const CATEGORY_ID = '1103734436291412099';
const TICKET_TOOL_BOT_ID = '557628352828014614'; // Ticket Tool#4843

client.once('ready', async () => {
  console.log('Logged in as', client.user.tag);
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  await guild.roles.fetch();

  const out = {
    guild: { name: guild.name, id: guild.id },
    fetched: new Date().toISOString(),
    art_channel_metadata: [],
    candidate_log_channels: [],
    ticket_tool_member: null,
    role_summary: [],
    panel_embed: null,
  };

  // 1. Topics + permission overwrites of every art* channel
  const cat = guild.channels.cache.get(CATEGORY_ID);
  if (cat) {
    for (const [, ch] of guild.channels.cache) {
      if (ch.parentId !== CATEGORY_ID) continue;
      const overwrites = ch.permissionOverwrites?.cache
        ? [...ch.permissionOverwrites.cache.values()].map((po) => ({
            id: po.id,
            type: po.type === 0 ? 'role' : 'member',
            allow: po.allow.toArray(),
            deny: po.deny.toArray(),
          }))
        : [];
      out.art_channel_metadata.push({
        id: ch.id,
        name: ch.name,
        topic: ch.topic || null,
        position: ch.position,
        rate_limit: ch.rateLimitPerUser,
        overwrites,
      });
    }
  }

  // 2. Hunt for Ticket Tool log / transcript channels
  for (const [, ch] of guild.channels.cache) {
    if (ch.type !== ChannelType.GuildText) continue;
    const n = ch.name.toLowerCase();
    if (n.includes('ticket') || n.includes('transcript') || n.includes('mod-log') || n.includes('modlog')) {
      out.candidate_log_channels.push({ id: ch.id, name: ch.name, topic: ch.topic || null });
    }
  }

  // 3. Ticket Tool member / permissions
  try {
    const tt = await guild.members.fetch(TICKET_TOOL_BOT_ID).catch(() => null);
    if (tt) {
      out.ticket_tool_member = {
        id: tt.id,
        roles: tt.roles.cache.map((r) => ({ id: r.id, name: r.name })),
        permissions: tt.permissions.toArray(),
      };
    }
  } catch {}

  // 4. Role summary of mentioned roles in greeting embeds (896070888762535967, 987662057069482024)
  const interesting = ['896070888762535967', '987662057069482024'];
  for (const rid of interesting) {
    const r = guild.roles.cache.get(rid);
    if (r) out.role_summary.push({ id: r.id, name: r.name, color: r.hexColor, position: r.position, members_count: r.members.size });
  }

  // 5. Panel embed: read latest messages in 1103728856294236160 directly
  try {
    const panelCh = await client.channels.fetch('1103728856294236160');
    if (panelCh) {
      const msgs = await panelCh.messages.fetch({ limit: 10 });
      const ttMsgs = [...msgs.values()].filter((m) => m.author.bot);
      out.panel_embed = ttMsgs.map((m) => ({
        id: m.id,
        author: m.author.tag,
        author_id: m.author.id,
        embeds: m.embeds.map((e) => ({
          title: e.title,
          description: e.description,
          color: e.hexColor,
          fields: e.fields,
          footer: e.footer,
        })),
        components: m.components.map((row) => ({
          type: row.type,
          components: row.components.map((c) => ({
            type: c.type,
            style: c.style,
            label: c.label,
            emoji: c.emoji ? `${c.emoji.name}${c.emoji.id ? ':' + c.emoji.id : ''}` : null,
            customId: c.customId,
          })),
        })),
      }));
    }
  } catch (e) {
    out.panel_embed_error = e.message;
  }

  writeFileSync('_recon/ticket-tool-config.json', JSON.stringify(out, null, 2));
  console.log('Saved _recon/ticket-tool-config.json');
  console.log('art channels:', out.art_channel_metadata.length);
  console.log('candidate log channels:', out.candidate_log_channels.length);
  console.log('panel messages:', (out.panel_embed || []).length);

  await client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);

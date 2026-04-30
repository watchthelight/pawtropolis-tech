import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import 'dotenv/config';
import { writeFileSync } from 'node:fs';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const CATEGORY_ID = process.argv[2];
const SAMPLE_LIMIT = parseInt(process.argv[3] || '15', 10);

if (!CATEGORY_ID) {
  console.error('Usage: node scripts/recon-category.mjs <category_id> [sample_limit_per_channel]');
  process.exit(1);
}

function fmt(msg) {
  const ts = msg.createdAt.toISOString();
  const author = msg.author.tag + (msg.author.bot ? ' [BOT]' : '');
  let body = msg.content || '';
  if (msg.embeds.length) {
    for (const e of msg.embeds) {
      if (e.title) body += `\n  [embed.title] ${e.title}`;
      if (e.description) body += `\n  [embed.desc] ${e.description.slice(0, 300)}`;
      for (const f of e.fields || []) body += `\n  [${f.name}] ${String(f.value).slice(0, 200)}`;
    }
  }
  if (msg.attachments.size) {
    for (const [, a] of msg.attachments) body += `\n  [attach] ${a.name} ${a.url}`;
  }
  return `### ${author} — ${ts}\n${body.trim() || '(empty)'}`;
}

async function fetchMessages(ch, limit) {
  const out = [];
  let lastId;
  let count = 0;
  while (count < limit) {
    const batch = await ch.messages.fetch({ limit: Math.min(100, limit - count), ...(lastId ? { before: lastId } : {}) });
    if (batch.size === 0) break;
    const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    for (const m of sorted) out.unshift(fmt(m));
    lastId = batch.last()?.id;
    count += batch.size;
  }
  out.reverse();
  return out;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  try {
    const cat = await client.channels.fetch(CATEGORY_ID);
    if (!cat || cat.type !== ChannelType.GuildCategory) {
      console.error('Not a category');
      process.exit(1);
    }
    const guild = cat.guild;
    console.log(`Category: ${cat.name}  Guild: ${guild.name}`);

    await guild.channels.fetch();
    const children = [...guild.channels.cache.values()]
      .filter((c) => c.parentId === CATEGORY_ID)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

    // Active threads under category children
    const activeThreads = await guild.channels.fetchActiveThreads().catch(() => null);
    const threadsByParent = new Map();
    if (activeThreads) {
      for (const t of activeThreads.threads.values()) {
        if (!threadsByParent.has(t.parentId)) threadsByParent.set(t.parentId, []);
        threadsByParent.get(t.parentId).push(t);
      }
    }

    let md = `# Recon: Category "${cat.name}" (${CATEGORY_ID})\n\n`;
    md += `**Guild:** ${guild.name}\n**Fetched:** ${new Date().toISOString()}\n**Direct children:** ${children.length}\n\n---\n\n## Children Overview\n\n`;

    const summary = [];
    for (const c of children) {
      const typeName = ChannelType[c.type] || c.type;
      summary.push({ id: c.id, name: c.name, type: typeName, position: c.position, topic: c.topic || '' });
      md += `- \`${c.id}\` **#${c.name}** — ${typeName}${c.topic ? ` — _${c.topic.slice(0, 100)}_` : ''}\n`;
    }

    md += `\n---\n\n## Per-Channel Sample (last ${SAMPLE_LIMIT} msgs)\n\n`;

    for (const c of children) {
      md += `\n### #${c.name} (\`${c.id}\`) — ${ChannelType[c.type]}\n\n`;
      if (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) {
        try {
          const msgs = await fetchMessages(c, SAMPLE_LIMIT);
          md += msgs.length ? msgs.join('\n\n') : '_(no messages or no read access)_';
        } catch (e) {
          md += `_(error: ${e.message})_`;
        }
        // Threads under this channel
        try {
          const archThreads = await c.threads.fetchArchived({ limit: 20 }).catch(() => null);
          const actThreads = threadsByParent.get(c.id) || [];
          const allT = [...actThreads, ...(archThreads ? archThreads.threads.values() : [])];
          if (allT.length) {
            md += `\n\n**Threads under #${c.name}:** ${allT.length}\n`;
            for (const t of allT) {
              md += `- \`${t.id}\` **${t.name}** — ${t.archived ? 'archived' : 'active'}${t.locked ? ' locked' : ''}\n`;
            }
          }
        } catch {}
      } else if (c.type === ChannelType.GuildForum) {
        try {
          const active = await c.threads.fetchActive();
          const archived = await c.threads.fetchArchived({ limit: 30 });
          md += `Forum threads — active: ${active.threads.size}, archived (recent 30): ${archived.threads.size}\n`;
          for (const t of [...active.threads.values(), ...archived.threads.values()]) {
            md += `- \`${t.id}\` **${t.name}** — ${t.archived ? 'archived' : 'active'}\n`;
          }
        } catch (e) {
          md += `_(forum error: ${e.message})_`;
        }
      } else {
        md += `_(skipped: type ${ChannelType[c.type]})_`;
      }
      md += '\n';
    }

    const out = `_recon/category-${CATEGORY_ID}.md`;
    writeFileSync(out, md);
    console.log(`\nSaved to ${out}`);
    console.log(`Children: ${children.length}`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_TOKEN);

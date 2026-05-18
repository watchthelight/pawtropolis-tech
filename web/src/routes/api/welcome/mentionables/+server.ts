import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hasMinTier } from '$lib/server/roles';
import { db } from '$lib/server/db';

interface ChannelRow {
	channel_id: string;
	name: string;
	type: number;
	parent_id: string | null;
}

interface RoleRow {
	role_id: string;
	name: string;
	color: number;
	position: number;
	mentionable: number;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Not authenticated');
	if (!hasMinTier(locals.user.tier, 'admin')) error(403, 'Insufficient permissions');
	if (!process.env.GUILD_ID) throw new Error('GUILD_ID environment variable is required');

	const guildId = process.env.GUILD_ID;

	// Only surface channel types that can actually be linked in a welcome
	// message: text (0), announcement/news (5), forum (15), media (16).
	// Excludes categories, voice, stage, threads, directory entries which
	// either can't be referenced with <#id> or render as garbage.
	const LINKABLE_CHANNEL_TYPES = [0, 5, 15, 16];

	const placeholders = LINKABLE_CHANNEL_TYPES.map(() => '?').join(',');
	const channelRows = db()
		.prepare(
			`SELECT channel_id, name, type, parent_id FROM channel_cache
			 WHERE guild_id = ? AND type IN (${placeholders})
			 ORDER BY name`
		)
		.all(guildId, ...LINKABLE_CHANNEL_TYPES) as ChannelRow[];

	const roleRows = db()
		.prepare(
			`SELECT role_id, name, color, position, mentionable FROM role_cache
			 WHERE guild_id = ? AND name != '@everyone'
			 ORDER BY position DESC`
		)
		.all(guildId) as RoleRow[];

	const channels = channelRows.map((r) => ({
		id: r.channel_id,
		name: r.name,
		type: r.type,
		parentId: r.parent_id
	}));

	const roles = roleRows.map((r) => ({
		id: r.role_id,
		name: r.name,
		color: r.color,
		position: r.position,
		mentionable: r.mentionable === 1
	}));

	return json({ success: true, data: { channels, roles } });
};

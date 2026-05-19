import { getAuditSessions, getActiveAuditSession } from "$lib/server/queries/auditSystems";
import type { PageServerLoad } from "./$types";

const GUILD_ID = process.env.GUILD_ID!;

export const load: PageServerLoad = async () => {
  const activeMember = getActiveAuditSession(GUILD_ID, "members");
  const activeNsfw = getActiveAuditSession(GUILD_ID, "nsfw");
  const sessions = getAuditSessions(GUILD_ID, 20);

  return { activeMember, activeNsfw, sessions };
};

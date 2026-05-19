import { listTickets, listTicketTypeKeys, type TicketStatus } from "$lib/server/queries/tickets";
import { hasMinTier } from "$lib/server/roles";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = locals.user!;
  const restrictReports = !hasMinTier(user.tier, "mod");

  const typeKey = url.searchParams.get("type") || undefined;
  const statusRaw = url.searchParams.get("status");
  const status: TicketStatus | undefined =
    statusRaw === "open" ? "open" : statusRaw === "closed" ? "closed" : undefined;
  const search = url.searchParams.get("search") || undefined;
  const cursorRaw = url.searchParams.get("cursor");
  const cursor = cursorRaw ? Number.parseInt(cursorRaw, 10) : undefined;

  const result = listTickets({
    typeKey,
    status,
    search,
    restrictReports,
    cursor: Number.isFinite(cursor) ? cursor : undefined,
  });

  const typeKeys = listTicketTypeKeys(restrictReports);

  return {
    ...result,
    typeKeys,
    filters: { typeKey, status, search },
    restrictReports,
  };
};

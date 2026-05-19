import { getAuditRuns } from "$lib/server/queries/auditSystems";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const runs = getAuditRuns();
  return { runs };
};

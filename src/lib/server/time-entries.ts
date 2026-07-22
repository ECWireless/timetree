import "server-only";

import type { TimeEntryCursor } from "@/lib/time-entries/contracts";
import { requireAuthorizedSession } from "@/lib/server/authorization";
import { getNodeEntriesForUser } from "@/lib/server/time-entry-service";

export async function getNodeEntries(nodeId: string, cursor?: TimeEntryCursor) {
  const session = await requireAuthorizedSession();
  return getNodeEntriesForUser(session.user.id, nodeId, cursor);
}

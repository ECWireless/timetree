import "server-only";

import { requireAuthorizedSession } from "@/lib/server/authorization";
import { getDashboardDataForUser } from "@/lib/server/node-service";

export async function getDashboardData() {
  const session = await requireAuthorizedSession();
  const dashboard = await getDashboardDataForUser(session.user.id);

  return {
    user: {
      name: session.user.name,
      email: session.user.email,
    },
    ...dashboard,
  };
}

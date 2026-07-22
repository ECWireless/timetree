import "server-only";

import { requireAuthorizedSession } from "@/lib/server/authorization";
import { getDashboardDataForUser } from "@/lib/server/node-service";
import type { DashboardPeriodInput } from "@/lib/time-entries/period";

export async function getDashboardData(period?: DashboardPeriodInput) {
  const session = await requireAuthorizedSession();
  const dashboard = await getDashboardDataForUser(session.user.id, period);

  return {
    user: {
      name: session.user.name,
      email: session.user.email,
    },
    ...dashboard,
  };
}

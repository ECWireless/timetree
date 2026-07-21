import "server-only";

import { requireAuthorizedSession } from "@/lib/server/authorization";

export async function getEmptyDashboard() {
  const session = await requireAuthorizedSession();

  return {
    user: {
      name: session.user.name,
      email: session.user.email,
    },
  };
}

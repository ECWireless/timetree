import "server-only";

import { getCanonicalTimeTreeOrigin } from "@/lib/agent/setup";
import { getServerEnv } from "@/lib/server/env";

export function getTimeTreeCanonicalOrigin() {
  return getCanonicalTimeTreeOrigin(getServerEnv().BETTER_AUTH_URL);
}

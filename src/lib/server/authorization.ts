import "server-only";

import { headers } from "next/headers";

import { assertAuthorizedSession } from "@/lib/auth/policy";
import { getAllowedEmail } from "@/lib/server/allowed-email";
import { auth } from "@/lib/server/auth";

export async function requireAuthorizedSession(requestHeaders?: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders ?? (await headers()),
  });

  return assertAuthorizedSession(session, getAllowedEmail());
}

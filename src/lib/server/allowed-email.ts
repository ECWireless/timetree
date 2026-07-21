import "server-only";

import { allowedEmailSchema } from "@/lib/env-schema";

export function getAllowedEmail() {
  return allowedEmailSchema.parse(process.env.ALLOWED_EMAIL);
}

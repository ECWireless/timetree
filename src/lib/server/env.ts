import "server-only";

import { serverEnvSchema, type ServerEnv } from "@/lib/env-schema";

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= serverEnvSchema.parse(process.env);
  return cachedEnv;
}

import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getServerEnv } from "@/lib/server/env";

import { schema } from "./schema";

const globalForDatabase = globalThis as typeof globalThis & {
  timeTreePool?: Pool;
};

export const pool =
  globalForDatabase.timeTreePool ??
  new Pool({
    connectionString: getServerEnv().DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.timeTreePool = pool;
}

export const db = drizzle(pool, { schema });

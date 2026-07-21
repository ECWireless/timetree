import "server-only";

import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";

import { db } from "@/db/client";
import { authSchema, user as userTable } from "@/db/schema";
import { isAllowedIdentity, normalizeEmail } from "@/lib/auth/policy";
import { getAllowedEmail } from "@/lib/server/allowed-email";
import { getServerEnv } from "@/lib/server/env";

const env = getServerEnv();

function rejectIdentity(): never {
  throw new APIError("FORBIDDEN", {
    code: "ACCOUNT_NOT_ALLOWED",
    message: "account not allowed",
  });
}

export const auth = betterAuth({
  appName: "TimeTree",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  account: {
    encryptOAuthTokens: true,
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
  },
  databaseHooks: {
    account: {
      create: {
        before: async (account) => ({
          data: {
            ...account,
            idToken: null,
          },
        }),
      },
      update: {
        before: async (account) => ({
          data: {
            ...account,
            idToken: null,
          },
        }),
      },
    },
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedIdentity(user, getAllowedEmail())) {
            rejectIdentity();
          }

          return {
            data: {
              ...user,
              email: normalizeEmail(user.email),
            },
          };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const [sessionUser] = await db
            .select({
              email: userTable.email,
              emailVerified: userTable.emailVerified,
            })
            .from(userTable)
            .where(eq(userTable.id, session.userId))
            .limit(1);

          if (!sessionUser || !isAllowedIdentity(sessionUser, getAllowedEmail())) {
            rejectIdentity();
          }

          return { data: session };
        },
      },
    },
  },
});

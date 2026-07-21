import { z } from "zod";

export const allowedEmailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const serverEnvSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_URL_UNPOOLED: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.url().optional(),
  ),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: allowedEmailSchema,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

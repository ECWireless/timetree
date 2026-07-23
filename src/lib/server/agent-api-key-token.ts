import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const tokenPattern =
  /^ttk_v1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const hashPattern = /^[0-9a-f]{64}$/;

export type ParsedAgentApiKey = {
  credentialId: string;
  secretBytes: Buffer;
};

export function hashAgentApiKeySecret(secretBytes: Uint8Array) {
  return createHash("sha256").update(secretBytes).digest("hex");
}

export function generateAgentApiKey() {
  const credentialId = randomUUID();
  const secretBytes = randomBytes(32);
  const secret = secretBytes.toString("base64url");

  return {
    credentialId,
    apiKey: `ttk_v1.${credentialId}.${secret}`,
    secretHash: hashAgentApiKeySecret(secretBytes),
  };
}

export function parseAgentApiKey(value: string): ParsedAgentApiKey | null {
  const match = tokenPattern.exec(value);
  if (!match) {
    return null;
  }

  const secretBytes = Buffer.from(match[2], "base64url");
  if (secretBytes.length !== 32 || secretBytes.toString("base64url") !== match[2]) {
    return null;
  }

  return {
    credentialId: match[1],
    secretBytes,
  };
}

export function verifyAgentApiKeySecret(secretBytes: Uint8Array, storedHash: string) {
  if (!hashPattern.test(storedHash)) {
    return false;
  }

  const actualHash = createHash("sha256").update(secretBytes).digest();
  const expectedHash = Buffer.from(storedHash, "hex");
  return timingSafeEqual(actualHash, expectedHash);
}

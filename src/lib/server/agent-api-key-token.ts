import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const tokenPattern =
  /^ttk_(v1|v2)\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const hashPattern = /^[0-9a-f]{64}$/;
const v2HashDomain = Buffer.from("timetree-agent-api-key:v2\0", "utf8");

export type AgentApiKeyVersion = "v1" | "v2";

export type ParsedAgentApiKey = {
  version: AgentApiKeyVersion;
  credentialId: string;
  secretBytes: Buffer;
};

export function hashAgentApiKeySecret(
  version: AgentApiKeyVersion,
  secretBytes: Uint8Array,
) {
  const hash = createHash("sha256");
  if (version === "v2") {
    hash.update(v2HashDomain);
  }
  return hash.update(secretBytes).digest("hex");
}

export function generateAgentApiKey() {
  const credentialId = randomUUID();
  const secretBytes = randomBytes(32);
  const secret = secretBytes.toString("base64url");

  return {
    credentialId,
    apiKey: `ttk_v2.${credentialId}.${secret}`,
    secretHash: hashAgentApiKeySecret("v2", secretBytes),
  };
}

export function parseAgentApiKey(value: string): ParsedAgentApiKey | null {
  const match = tokenPattern.exec(value);
  if (!match) {
    return null;
  }

  const secretBytes = Buffer.from(match[3], "base64url");
  if (secretBytes.length !== 32 || secretBytes.toString("base64url") !== match[3]) {
    return null;
  }

  return {
    version: match[1] as AgentApiKeyVersion,
    credentialId: match[2],
    secretBytes,
  };
}

export function verifyAgentApiKeySecret(
  version: AgentApiKeyVersion,
  secretBytes: Uint8Array,
  storedHash: string,
) {
  if (!hashPattern.test(storedHash)) {
    return false;
  }

  const actualHash = Buffer.from(hashAgentApiKeySecret(version, secretBytes), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return timingSafeEqual(actualHash, expectedHash);
}

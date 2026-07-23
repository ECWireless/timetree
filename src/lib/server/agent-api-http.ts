import "server-only";

import { z } from "zod";

import type {
  AgentApiErrorCode,
  AgentApiErrorResponse,
} from "@/lib/agent/contracts";
import { AgentApiError } from "@/lib/server/agent-api-errors";

const maximumBodyBytes = 8_192;

export type BufferedAgentJson =
  | { ok: true; raw: string }
  | { ok: false; fields: Record<string, string[]> };

const errorMessages: Record<AgentApiErrorCode, string> = {
  "invalid-request": "Check the request and try again.",
  "invalid-key": "The agent API key is missing or invalid.",
  "not-found": "The requested resource is not available.",
  "node-completed": "The node is completed.",
  "parent-completed": "The parent node is completed.",
  "node-id-conflict": "Use a new randomly generated node identifier.",
  "position-conflict": "The node position changed. Try again.",
  "timer-too-long": "The active timer is too long to record.",
  "internal-error": "The request could not be completed.",
};

const statusByCode: Record<AgentApiErrorCode, number> = {
  "invalid-request": 400,
  "invalid-key": 401,
  "not-found": 404,
  "node-completed": 409,
  "parent-completed": 409,
  "node-id-conflict": 409,
  "position-conflict": 409,
  "timer-too-long": 409,
  "internal-error": 500,
};

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store",
  };
}

function validationFields(error: z.ZodError) {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0]?.toString() ?? "body";
    fields[field] = [...(fields[field] ?? []), issue.message];
  }
  return fields;
}

export async function bufferAgentJson(
  request: Request,
): Promise<BufferedAgentJson> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json") {
    return {
      ok: false,
      fields: { body: ["Use the application/json content type."] },
    };
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > maximumBodyBytes)
  ) {
    return {
      ok: false,
      fields: { body: ["Use a smaller JSON request body."] },
    };
  }

  if (!request.body) {
    return {
      ok: false,
      fields: { body: ["Provide a JSON request body."] },
    };
  }

  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBodyBytes) {
        await reader.cancel();
        return {
          ok: false,
          fields: { body: ["Use a smaller JSON request body."] },
        };
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      raw: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return {
      ok: false,
      fields: { body: ["Provide a valid UTF-8 JSON request body."] },
    };
  }
}

export function parseAgentJson<T extends z.ZodType>(
  buffered: BufferedAgentJson,
  schema: T,
): z.output<T> {
  if (!buffered.ok) {
    throw new AgentApiError("invalid-request", buffered.fields);
  }

  let value: unknown;
  try {
    value = JSON.parse(buffered.raw);
  } catch {
    throw new AgentApiError("invalid-request", {
      body: ["Provide a valid JSON request body."],
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AgentApiError(
      "invalid-request",
      validationFields(parsed.error),
    );
  }
  return parsed.data;
}

export function getAgentAuthorizationHeader(request: Request) {
  return request.headers.get("authorization");
}

export async function handleAgentApiRequest(
  operation: () => Promise<unknown>,
) {
  try {
    const result = await operation();
    return Response.json(result, {
      status: 200,
      headers: noStoreHeaders(),
    });
  } catch (error) {
    const apiError =
      error instanceof AgentApiError
        ? error
        : new AgentApiError("internal-error");
    const body: AgentApiErrorResponse = {
      code: apiError.code,
      message: errorMessages[apiError.code],
      ...(apiError.fields ? { fields: apiError.fields } : {}),
    };
    return Response.json(body, {
      status: statusByCode[apiError.code],
      headers: {
        ...noStoreHeaders(),
        ...(apiError.code === "invalid-key"
          ? { "WWW-Authenticate": 'Bearer realm="TimeTree Agent API"' }
          : {}),
      },
    });
  }
}

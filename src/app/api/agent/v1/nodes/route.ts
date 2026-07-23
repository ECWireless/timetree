import { z } from "zod";

import { withAuthorizedAgentKey } from "@/lib/server/agent-api-authorization";
import {
  bufferAgentJson,
  getAgentAuthorizationHeader,
  handleAgentApiRequest,
  parseAgentJson,
} from "@/lib/server/agent-api-http";
import { createAgentNode } from "@/lib/server/agent-api-service";

export const dynamic = "force-dynamic";

const createNodeSchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid(),
    title: z
      .string()
      .trim()
      .min(1, "Enter a title.")
      .max(200, "Use 200 characters or fewer."),
  })
  .strict();

export async function POST(request: Request) {
  const body = await bufferAgentJson(request);
  return handleAgentApiRequest(() =>
    withAuthorizedAgentKey(
      getAgentAuthorizationHeader(request),
      async (context) =>
        createAgentNode(
          context,
          parseAgentJson(body, createNodeSchema),
        ),
    ),
  );
}

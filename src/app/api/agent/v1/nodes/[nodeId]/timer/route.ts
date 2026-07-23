import { z } from "zod";

import { isValidIanaTimeZone } from "@/lib/agent/time-zone";
import { withAuthorizedAgentKey } from "@/lib/server/agent-api-authorization";
import { AgentApiError } from "@/lib/server/agent-api-errors";
import {
  bufferAgentJson,
  getAgentAuthorizationHeader,
  handleAgentApiRequest,
  parseAgentJson,
} from "@/lib/server/agent-api-http";
import {
  startAgentTimer,
  stopAgentTimer,
} from "@/lib/server/agent-api-service";

export const dynamic = "force-dynamic";

const nodeIdSchema = z.uuid();
const startTimerSchema = z
  .object({
    timeZone: z
      .string()
      .refine(isValidIanaTimeZone, "Use a valid IANA time zone."),
  })
  .strict();

type TimerRouteContext = {
  params: Promise<{ nodeId: string }>;
};

async function parseNodeId(context: TimerRouteContext) {
  const parsed = nodeIdSchema.safeParse((await context.params).nodeId);
  if (!parsed.success) {
    throw new AgentApiError("invalid-request", {
      nodeId: parsed.error.issues.map(() => "Use a valid node identifier."),
    });
  }
  return parsed.data;
}

export async function PUT(request: Request, routeContext: TimerRouteContext) {
  const body = await bufferAgentJson(request);
  return handleAgentApiRequest(() =>
    withAuthorizedAgentKey(
      getAgentAuthorizationHeader(request),
      async (context) =>
        startAgentTimer(
          context,
          await parseNodeId(routeContext),
          parseAgentJson(body, startTimerSchema),
        ),
    ),
  );
}

export async function DELETE(
  request: Request,
  routeContext: TimerRouteContext,
) {
  return handleAgentApiRequest(() =>
    withAuthorizedAgentKey(
      getAgentAuthorizationHeader(request),
      async (context) =>
        stopAgentTimer(context, await parseNodeId(routeContext)),
    ),
  );
}

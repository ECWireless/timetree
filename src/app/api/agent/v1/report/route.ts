import { isValidWorkDate } from "@/lib/time-entries/dates";
import { withAuthorizedAgentKey } from "@/lib/server/agent-api-authorization";
import { AgentApiError } from "@/lib/server/agent-api-errors";
import {
  getAgentAuthorizationHeader,
  handleAgentApiRequest,
} from "@/lib/server/agent-api-http";
import { getAgentReport } from "@/lib/server/agent-api-service";

export const dynamic = "force-dynamic";

function parseReportRange(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const fromValues = searchParams.getAll("from");
  const toValues = searchParams.getAll("to");
  const from = fromValues.length === 1 ? fromValues[0] : null;
  const to = toValues.length === 1 ? toValues[0] : null;
  const fields: Record<string, string[]> = {};

  if (from === null || !isValidWorkDate(from)) {
    fields.from = ["Use one valid date in YYYY-MM-DD format."];
  }
  if (to === null || !isValidWorkDate(to)) {
    fields.to = ["Use one valid date in YYYY-MM-DD format."];
  }
  if (from !== null && to !== null && isValidWorkDate(from) && isValidWorkDate(to) && from >= to) {
    fields.to = ["Choose a date after from."];
  }
  if (Object.keys(fields).length > 0) {
    throw new AgentApiError("invalid-request", fields);
  }

  return { from: from as string, to: to as string };
}

export async function GET(request: Request) {
  return handleAgentApiRequest(() =>
    withAuthorizedAgentKey(
      getAgentAuthorizationHeader(request),
      (context) => {
        const range = parseReportRange(request);
        return getAgentReport(context, range.from, range.to);
      },
    ),
  );
}

import { withAuthorizedAgentKey } from "@/lib/server/agent-api-authorization";
import {
  getAgentAuthorizationHeader,
  handleAgentApiRequest,
} from "@/lib/server/agent-api-http";
import { getAgentTree } from "@/lib/server/agent-api-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleAgentApiRequest(() =>
    withAuthorizedAgentKey(
      getAgentAuthorizationHeader(request),
      getAgentTree,
    ),
  );
}

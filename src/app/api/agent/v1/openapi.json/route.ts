import { timeTreeAgentOpenApiDocument } from "@/lib/agent/openapi";

export const dynamic = "force-static";

export function GET() {
  return Response.json(timeTreeAgentOpenApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}

import "server-only";

import type { AgentApiErrorCode } from "@/lib/agent/contracts";

export class AgentApiError extends Error {
  constructor(
    public readonly code: AgentApiErrorCode,
    public readonly fields?: Record<string, string[]>,
  ) {
    super(code);
    this.name = "AgentApiError";
  }
}

export type AgentApiKeyMetadata = {
  id: string;
  createdAt: string;
};

export type CreateAgentApiKeyInput = {
  nodeId: string;
};

export type RotateAgentApiKeyInput = {
  nodeId: string;
  credentialId: string;
};

export type RevokeAgentApiKeyInput = RotateAgentApiKeyInput;

export type AgentApiKeySecretActionResult =
  | {
      ok: true;
      credential: AgentApiKeyMetadata;
      apiKey: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export type RevokeAgentApiKeyActionResult =
  | {
      ok: true;
      credentialId: string;
    }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export type AgentActiveTimer = {
  startedAt: string;
  workDate: string;
};

export type AgentNode = {
  id: string;
  parentId: string | null;
  title: string;
  description: string | null;
  completedAt: string | null;
  activeTimer: AgentActiveTimer | null;
};

export type AgentTreeResponse = {
  rootId: string;
  nodes: AgentNode[];
};

export type CreateAgentNodeInput = {
  id: string;
  parentId: string;
  title: string;
};

export type CreateAgentNodeResponse = {
  status: "created" | "existing";
  node: AgentNode;
};

export type StartAgentTimerInput = {
  timeZone: string;
};

export type StartAgentTimerResponse = {
  nodeId: string;
  status: "started" | "already-running";
  activeTimer: AgentActiveTimer;
};

export type StopAgentTimerResponse = {
  nodeId: string;
  status: "stopped" | "not-running";
};

export type AgentApiErrorCode =
  | "invalid-request"
  | "invalid-key"
  | "not-found"
  | "node-completed"
  | "parent-completed"
  | "node-id-conflict"
  | "position-conflict"
  | "timer-too-long"
  | "internal-error";

export type AgentApiErrorResponse = {
  code: AgentApiErrorCode;
  message: string;
  fields?: Record<string, string[]>;
};

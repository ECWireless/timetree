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

export type CreateNodeInput = {
  title: string;
  parentId?: string | null;
};

export type UpdateNodeInput = {
  id: string;
  title?: string;
  description?: string | null;
  hourlyRateCents?: number | null;
};

export type MoveNodeInput = {
  id: string;
  parentId: string | null;
  position?: number;
};

export type NodeIdInput = {
  id: string;
};

export type NodeActionResult =
  | { ok: true; nodeId: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      blockingNodeIds?: readonly string[];
    };

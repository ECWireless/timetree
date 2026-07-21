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

export type NodeActionResult =
  | { ok: true; nodeId: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

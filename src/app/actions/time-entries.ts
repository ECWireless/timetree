"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  CreateTimeEntryInput,
  DeleteTimeEntryActionResult,
  DeleteTimeEntryInput,
  LoadTimeEntriesActionResult,
  TimeEntryActionResult,
  TimeEntryCursor,
  UpdateTimeEntryInput,
} from "@/lib/time-entries/contracts";
import { isValidWorkDate } from "@/lib/time-entries/dates";
import { parseDuration } from "@/lib/time-entries/duration";
import { requireAuthorizedSession } from "@/lib/server/authorization";
import {
  createTimeEntryForUser,
  deleteTimeEntryForUser,
  getNodeEntriesForUser,
  type PreparedTimeEntryInput,
  type PreparedTimeEntryUpdate,
  TimeEntryMutationError,
  updateTimeEntryForUser,
} from "@/lib/server/time-entry-service";

const maximumRateCents = 2_147_483_647;
const maximumDurationSeconds = 2_147_483_647;
const uuidSchema = z.uuid();
const workDateSchema = z.string().refine(isValidWorkDate, "Choose a valid work date.");
const notesSchema = z
  .string()
  .trim()
  .max(4_000, "Use 4,000 characters or fewer.")
  .nullable()
  .optional()
  .transform((value) => value || null);
const rateSchema = z.int().min(0).max(maximumRateCents, "The hourly rate is too large.").nullable().optional();
const durationSchema = z.string().refine((value) => parseDuration(value) !== null, {
  message: "Enter a positive duration such as 1h 30m, 90m, or 1.5h.",
});
const dateTimeSchema = z.iso.datetime({ offset: true });

const commonShape = {
  nodeId: uuidSchema,
  notes: notesSchema,
  hourlyRateCents: rateSchema,
};
const createRangeSchema = z
  .object({
    ...commonShape,
    mode: z.literal("range"),
    workDate: workDateSchema,
    startedAt: dateTimeSchema,
    endedAt: dateTimeSchema,
  })
  .refine((input) => input.workDate === input.startedAt.slice(0, 10), {
    path: ["workDate"],
    message: "Work date must match the local start date.",
  })
  .refine((input) => new Date(input.endedAt) > new Date(input.startedAt), {
    path: ["endedAt"],
    message: "End must be later than start.",
  })
  .refine(
    (input) => {
      const difference =
        new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime();
      return difference <= 0 || difference >= 1_000;
    },
    {
      path: ["endedAt"],
      message: "The range must be at least one second.",
    },
  )
  .refine(
    (input) =>
      new Date(input.endedAt).getTime() - new Date(input.startedAt).getTime() <=
      maximumDurationSeconds * 1_000,
    {
      path: ["endedAt"],
      message: "The time range is too large.",
    },
  );
const createSchema = z.discriminatedUnion("mode", [
  z.object({
    ...commonShape,
    mode: z.literal("duration"),
    workDate: workDateSchema,
    duration: durationSchema,
  }),
  createRangeSchema,
]);
const preserveTimestampSchema = z.object({ kind: z.literal("preserve") });
const replaceStartSchema = z
  .object({ kind: z.literal("replace"), value: dateTimeSchema, workDate: workDateSchema })
  .refine((input) => input.workDate === input.value.slice(0, 10), {
    path: ["workDate"],
    message: "Work date must match the local start date.",
  });
const replaceEndSchema = z.object({ kind: z.literal("replace"), value: dateTimeSchema });
const updateSchema = z.discriminatedUnion("mode", [
  createSchema.options[0].extend({ id: uuidSchema }),
  z.object({
    ...commonShape,
    id: uuidSchema,
    mode: z.literal("range"),
    start: z.union([preserveTimestampSchema, replaceStartSchema]),
    end: z.union([preserveTimestampSchema, replaceEndSchema]),
  }),
]);
const deleteSchema = z.object({ id: uuidSchema });
const cursorSchema = z.object({ createdAt: dateTimeSchema, id: uuidSchema });
const loadSchema = z.object({ nodeId: uuidSchema, cursor: cursorSchema });

function validationFailure(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const rawField = issue.path[0]?.toString() ?? "form";
    const field = rawField === "start" ? "startedAt" : rawField === "end" ? "endedAt" : rawField;
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  return { ok: false as const, message: "Check the highlighted fields.", fieldErrors };
}

function mutationFailure(error: unknown) {
  if (error instanceof TimeEntryMutationError) {
    return {
      ok: false as const,
      message:
        error.reason === "entry-not-found"
          ? "That time entry is no longer available."
          : error.reason === "invalid-range"
            ? "The corrected time range is invalid or exceeds the supported duration."
          : "That node is no longer available.",
    };
  }
  throw error;
}

function prepareCreateInput(input: z.infer<typeof createSchema>): PreparedTimeEntryInput {
  const common = {
    nodeId: input.nodeId,
    workDate: input.workDate,
    notes: input.notes,
    ...(input.hourlyRateCents !== undefined
      ? { hourlyRateCents: input.hourlyRateCents }
      : {}),
  };
  if (input.mode === "duration") {
    return {
      ...common,
      startedAt: null,
      endedAt: null,
      durationSeconds: parseDuration(input.duration)!,
    };
  }
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  return {
    ...common,
    startedAt,
    endedAt,
    durationSeconds: Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000),
  };
}

function prepareUpdateInput(input: z.infer<typeof updateSchema>): PreparedTimeEntryUpdate {
  const common = {
    nodeId: input.nodeId,
    notes: input.notes,
    ...(input.hourlyRateCents !== undefined
      ? { hourlyRateCents: input.hourlyRateCents }
      : {}),
  };
  if (input.mode === "duration") {
    return {
      ...common,
      mode: "duration",
      workDate: input.workDate,
      durationSeconds: parseDuration(input.duration)!,
    };
  }
  return {
    ...common,
    mode: "range",
    start:
      input.start.kind === "preserve"
        ? input.start
        : {
            kind: "replace",
            value: new Date(input.start.value),
            workDate: input.start.workDate,
          },
    end:
      input.end.kind === "preserve"
        ? input.end
        : { kind: "replace", value: new Date(input.end.value) },
  };
}

export async function createTimeEntry(
  input: CreateTimeEntryInput,
): Promise<TimeEntryActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  try {
    const entry = await createTimeEntryForUser(session.user.id, prepareCreateInput(parsed.data));
    revalidatePath("/");
    return { ok: true, entry };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function updateTimeEntry(
  input: UpdateTimeEntryInput,
): Promise<TimeEntryActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  try {
    const entry = await updateTimeEntryForUser(
      session.user.id,
      parsed.data.id,
      prepareUpdateInput(parsed.data),
    );
    revalidatePath("/");
    return { ok: true, entry };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function deleteTimeEntry(
  input: DeleteTimeEntryInput,
): Promise<DeleteTimeEntryActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  try {
    const entryId = await deleteTimeEntryForUser(session.user.id, parsed.data.id);
    revalidatePath("/");
    return { ok: true, entryId };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function loadTimeEntriesPage(
  nodeId: string,
  cursor: TimeEntryCursor,
): Promise<LoadTimeEntriesActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = loadSchema.safeParse({ nodeId, cursor });
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  try {
    return {
      ok: true,
      page: await getNodeEntriesForUser(session.user.id, parsed.data.nodeId, parsed.data.cursor),
    };
  } catch (error) {
    return mutationFailure(error);
  }
}

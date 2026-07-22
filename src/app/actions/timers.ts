"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAuthorizedSession } from "@/lib/server/authorization";
import {
  startTimerForUser,
  stopTimerForUser,
  TimerMutationError,
} from "@/lib/server/timer-service";
import { isValidWorkDate } from "@/lib/time-entries/dates";
import type {
  StartTimerInput,
  StopTimerActionResult,
  StopTimerInput,
  TimerActionResult,
} from "@/lib/timers/contracts";

const startSchema = z.object({
  nodeId: z.uuid(),
  workDate: z.string().refine(isValidWorkDate, "Choose a valid work date."),
});
const stopSchema = z.object({ timerId: z.uuid() });

function validationFailure(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0]?.toString() ?? "form";
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  return { ok: false as const, message: "Check the highlighted fields.", fieldErrors };
}

function mutationMessage(error: TimerMutationError) {
  switch (error.reason) {
    case "already-running":
      return "A timer is already running on that node.";
    case "node-completed":
      return "Reopen this node before starting a timer.";
    case "node-not-found":
      return "That node is no longer available.";
    case "timer-too-long":
      return "This timer is too long to save.";
    case "timer-not-found":
      return "That timer is no longer running.";
  }
}

export async function startTimer(input: StartTimerInput): Promise<TimerActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  try {
    const timer = await startTimerForUser(
      session.user.id,
      parsed.data.nodeId,
      parsed.data.workDate,
    );
    revalidatePath("/");
    return { ok: true, timer };
  } catch (error) {
    if (error instanceof TimerMutationError) {
      return { ok: false, message: mutationMessage(error) };
    }
    throw error;
  }
}

export async function stopTimer(input: StopTimerInput): Promise<StopTimerActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = stopSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }
  try {
    const stopped = await stopTimerForUser(session.user.id, parsed.data.timerId);
    revalidatePath("/");
    return { ok: true, ...stopped };
  } catch (error) {
    if (error instanceof TimerMutationError) {
      return { ok: false, message: mutationMessage(error) };
    }
    throw error;
  }
}

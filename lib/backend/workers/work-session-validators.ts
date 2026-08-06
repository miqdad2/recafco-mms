import "server-only";

import { z } from "zod";

// Work Session Time Tracking and Labor Cost Calculation Unit 8, Task 2/3/5.
export const WORK_SESSION_STATUSES = ["Active", "Paused", "Completed", "Cancelled"] as const;
export type WorkSessionStatus = (typeof WORK_SESSION_STATUSES)[number];

export const startWorkSessionSchema = z.object({
  workOrderId: z.string().uuid(),
  workerAssignmentId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});
export type StartWorkSessionInput = z.infer<typeof startWorkSessionSchema>;

export const pauseOrStopWorkSessionSchema = z.object({
  workOrderId: z.string().uuid(),
  workerAssignmentId: z.string().uuid(),
});
export type PauseOrStopWorkSessionInput = z.infer<typeof pauseOrStopWorkSessionSchema>;

export const manualTimeEntrySchema = z
  .object({
    workOrderId: z.string().uuid(),
    workerAssignmentId: z.string().uuid(),
    startedAt: z.string().trim().min(1),
    stoppedAt: z.string().trim().min(1),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => new Date(v.stoppedAt).getTime() > new Date(v.startedAt).getTime(), {
    message: "Stop time must be after start time.",
    path: ["stoppedAt"],
  });
export type ManualTimeEntryInput = z.infer<typeof manualTimeEntrySchema>;

export const editWorkSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    startedAt: z.string().trim().min(1),
    stoppedAt: z.string().trim().min(1),
    correctionReason: z.string().trim().min(5).max(500),
  })
  .refine((v) => new Date(v.stoppedAt).getTime() > new Date(v.startedAt).getTime(), {
    message: "Stop time must be after start time.",
    path: ["stoppedAt"],
  });
export type EditWorkSessionInput = z.infer<typeof editWorkSessionSchema>;

export const cancelWorkSessionSchema = z.object({
  sessionId: z.string().uuid(),
  correctionReason: z.string().trim().min(5).max(500),
});
export type CancelWorkSessionInput = z.infer<typeof cancelWorkSessionSchema>;

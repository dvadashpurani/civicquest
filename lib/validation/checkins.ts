// Validation for the partner and Leader check-in actions. Every schema is
// `.strict()`, so unknown fields are rejected. The client only ever sends an
// id or a scanned token; hours, status, and approver are set by the RPCs.

import { z } from "zod";

export const opportunityIdSchema = z.object({ opportunityId: z.uuid() }).strict();
export const checkinIdSchema = z.object({ checkinId: z.uuid() }).strict();
export const approveAllSchema = z
  .object({ opportunityId: z.uuid(), checkinIds: z.array(z.uuid()).min(1).max(200) })
  .strict();

/** A scanned QR token: a non-empty, bounded string of hex characters. */
export const scanSchema = z
  .object({ token: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/) })
  .strict();

import "server-only";

import type { Prisma } from "@prisma/client";

import { runInTransactionScope, withConnectionRecovery } from "@/lib/db/connection-recovery";
import { prisma } from "@/lib/db/prisma";

export type BackendTransaction = Prisma.TransactionClient;

export async function withBackendTransaction<T>(actorId: string | null, operation: (tx: BackendTransaction) => Promise<T>) {
  // A lost connection (e.g. after a database restart) is retried ONLY while
  // the operation has not started: opening the transaction or setting the
  // actor failed, so nothing of the operation reached the database. Once the
  // operation has started, a failure is never retried here — its outcome
  // could be uncertain, and callers keep their own safeguards (Job Card
  // submission id, closure status checks).
  let operationStarted = false;
  return withConnectionRecovery(
    () =>
      prisma.$transaction(
        async (tx) => {
          if (actorId) {
            await tx.$executeRaw`select set_config('app.current_profile_id', ${actorId}, true)`;
          }
          operationStarted = true;
          // Reads inside the operation are not retried on their own.
          return runInTransactionScope(() => operation(tx));
        },
        {
          maxWait: 5000,
          timeout: 15000
        }
      ),
    { canRetry: () => !operationStarted }
  );
}

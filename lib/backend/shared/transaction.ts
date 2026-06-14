import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type BackendTransaction = Prisma.TransactionClient;

export async function withBackendTransaction<T>(actorId: string | null, operation: (tx: BackendTransaction) => Promise<T>) {
  return prisma.$transaction(
    async (tx) => {
      if (actorId) {
        await tx.$executeRaw`select set_config('app.current_profile_id', ${actorId}, true)`;
      }

      return operation(tx);
    },
    {
      maxWait: 5000,
      timeout: 15000
    }
  );
}

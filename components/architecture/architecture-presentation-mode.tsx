import Link from "next/link";
import { X } from "lucide-react";

import { DatabaseModel } from "@/components/architecture/database-model";
import { DeploymentArchitecture } from "@/components/architecture/deployment-architecture";
import { HighLevelArchitecture } from "@/components/architecture/high-level-architecture";
import { NotificationArchitecture } from "@/components/architecture/notification-architecture";
import { SecurityModel } from "@/components/architecture/security-model";

export function ArchitecturePresentationMode() {
  return (
    <div className="min-h-screen bg-[#F3F5F8] p-5 lg:p-8">
      <div className="mb-6 flex items-center justify-between gap-4 rounded-md border border-[#111827] bg-[#111827] p-5 text-white">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Technical presentation</p>
          <h1 className="mt-1 text-3xl font-black">RECAFCO System Architecture</h1>
        </div>
        <Link href="/admin/architecture" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-4 text-sm font-black text-[#111827] hover:bg-gray-100">
          <X className="h-4 w-4" />
          Exit
        </Link>
      </div>
      <div className="space-y-8">
        <HighLevelArchitecture />
        <SecurityModel />
        <DatabaseModel />
        <NotificationArchitecture />
        <DeploymentArchitecture />
      </div>
    </div>
  );
}

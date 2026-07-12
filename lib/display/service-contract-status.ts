export type ContractStatusMeta = {
  label: string;
  tone: "green" | "amber" | "red" | "gray";
  days: number;
};

export function computeContractStatus(
  endDate: Date | string,
  contractStatus: string
): ContractStatusMeta {
  if (contractStatus !== "Active") {
    return { label: contractStatus, tone: "gray", days: 0 };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(endDate);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days < 0)   return { label: "Expired",       tone: "red",   days };
  if (days <= 30) return { label: "Expiring Soon", tone: "amber", days };
  return           { label: "Active",          tone: "green", days };
}

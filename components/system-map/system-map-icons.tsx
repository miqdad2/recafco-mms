import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Crown,
  Download,
  FileLock2,
  FileText,
  Gauge,
  GitBranch,
  Landmark,
  LucideIcon,
  Map,
  MonitorPlay,
  Network,
  Package,
  PackageCheck,
  PackageSearch,
  PencilRuler,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  QrCode,
  Users,
  Warehouse,
  Wrench
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Crown,
  Download,
  FileLock2,
  FileText,
  Gauge,
  GitBranch,
  Landmark,
  Map,
  MonitorPlay,
  Network,
  Package,
  PackageCheck,
  PackageSearch,
  PencilRuler,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  QrCode,
  Users,
  Warehouse,
  Wrench
};

export function getSystemMapIcon(name: string) {
  return icons[name] ?? Activity;
}

export const toneStyles = {
  blue: {
    border: "border-blue-200",
    bg: "bg-blue-50",
    text: "text-blue-700",
    solid: "bg-[#2563EB]",
    ring: "ring-blue-100"
  },
  amber: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-700",
    solid: "bg-[#F59E0B]",
    ring: "ring-amber-100"
  },
  green: {
    border: "border-green-200",
    bg: "bg-green-50",
    text: "text-green-700",
    solid: "bg-[#16A34A]",
    ring: "ring-green-100"
  },
  red: {
    border: "border-red-200",
    bg: "bg-red-50",
    text: "text-red-700",
    solid: "bg-[#ED1C24]",
    ring: "ring-red-100"
  },
  gray: {
    border: "border-gray-200",
    bg: "bg-gray-50",
    text: "text-gray-700",
    solid: "bg-gray-500",
    ring: "ring-gray-100"
  }
};

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ClipboardCheck,
  ClipboardList,
  Crown,
  FileText,
  LockKeyhole,
  LocateFixed,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  MousePointer2,
  PackageCheck,
  PencilRuler,
  RotateCcw,
  Settings2,
  ShoppingCart,
  Split,
  Warehouse,
  Wrench,
  ZoomIn,
  ZoomOut
} from "lucide-react";

import { Button } from "@/components/ui/button";

type Tone = "blue" | "purple" | "orange" | "yellow" | "teal" | "red" | "green" | "gray" | "pink";

type EditableNode = {
  id: string;
  title: string;
  role: string;
  description: string;
  href: string;
  tone: "green" | "amber" | "red" | "blue" | "gray";
  x: number;
  y: number;
  width: number;
  height: number;
};

type EditableEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

type EditableNote = {
  id: string;
  title: string;
  body: string;
  x: number;
  y: number;
};

type EditableDiagram = {
  schemaVersion: 1;
  title: string;
  updatedFrom: "official-system-map";
  nodes: EditableNode[];
  edges: EditableEdge[];
  notes: EditableNote[];
};

type WorkflowMapEditorProps = {
  initialDiagram: EditableDiagram;
  officialDiagram: EditableDiagram;
  activeVersion: {
    title: string;
    version_number: number;
    status: string;
    updated_at: string;
  } | null;
  versions: Array<{
    id: string;
    title: string;
    version_number: number;
    status: string;
    updated_at: string;
  }>;
  saveAction: (formData: FormData) => void;
};

type NodeInfo = {
  id: string;
  label: string;
  type: string;
  role: string;
  actions: string[];
  next: string;
  reject: string;
  clarification: string;
  notification: string;
  audit: string;
  tone: Tone;
  icon: LucideIcon;
};

type WorkflowGraphNode = NodeInfo & {
  x: number;
  y: number;
  width: number;
  summary: string;
};

type WorkflowGraphEdge = {
  from: string;
  to: string;
  label?: string;
  tone?: Tone;
};

const toneClasses: Record<Tone, { border: string; bg: string; text: string; solid: string }> = {
  blue: { border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-700", solid: "bg-[#2563EB]" },
  purple: { border: "border-purple-200", bg: "bg-purple-50", text: "text-purple-700", solid: "bg-purple-600" },
  orange: { border: "border-orange-200", bg: "bg-orange-50", text: "text-orange-700", solid: "bg-orange-500" },
  yellow: { border: "border-yellow-200", bg: "bg-yellow-50", text: "text-yellow-700", solid: "bg-yellow-500" },
  teal: { border: "border-teal-200", bg: "bg-teal-50", text: "text-teal-700", solid: "bg-teal-600" },
  red: { border: "border-red-200", bg: "bg-red-50", text: "text-red-700", solid: "bg-[#ED1C24]" },
  green: { border: "border-green-200", bg: "bg-green-50", text: "text-green-700", solid: "bg-[#16A34A]" },
  gray: { border: "border-gray-200", bg: "bg-gray-50", text: "text-gray-700", solid: "bg-gray-500" },
  pink: { border: "border-pink-200", bg: "bg-pink-50", text: "text-pink-700", solid: "bg-pink-500" }
};

const workflows = [
  "Maintenance Work Order Workflow",
  "Construction / Project Request Workflow",
  "Inventory / Store Subflow",
  "Purchase / PO Subflow",
  "Emergency Flow"
];

const maintenanceNodes = [
  "Maintenance Data Entry",
  "Work Order Draft",
  "Submit Work Order",
  "Maintenance Manager Review",
  "System Inventory Check",
  "Store Keeper Confirmation",
  "Parts Available",
  "Parts Not Available",
  "Store Issue Parts",
  "Production Manager Approval",
  "Factory Manager Approval",
  "Purchase Manager Approval",
  "Finance Manager Approval",
  "CEO Final Approval",
  "Approved for Purchase",
  "Purchase Officer PO Create",
  "PO Issued",
  "Waiting for Parts",
  "Parts Received",
  "Ready for Assignment",
  "Maintenance Team Assignment",
  "Auto Team",
  "Mechanical Team",
  "Electrical Team",
  "Work In Progress",
  "Completed by Team",
  "Supervisor Verification",
  "Maintenance Manager Closure",
  "Work Order Closed",
  "Rejected",
  "Clarification Required"
];

const constructionNodes = [
  "Project Data Entry",
  "Project Request Submit",
  "Project Manager Approval",
  "Construction Manager Approval",
  "Purchase Manager Approval",
  "Finance Manager Approval",
  "CEO Final Approval",
  "Project Approved for Purchase",
  "Project PO Create",
  "Project PO Issued",
  "Waiting / Ready / Received",
  "Project Execution",
  "Project Closed"
];

const systemNodes = [
  "Workflow Engine",
  "Permission Engine",
  "Notification Engine",
  "Audit Log Engine",
  "Real-Time Dashboard Engine",
  "File Attachment Service",
  "Inventory Movement Engine"
];

const workflowGraphNodes: WorkflowGraphNode[] = [
  {
    id: "maintenance-data-entry",
    label: "Maintenance Data Entry",
    type: "Entry",
    role: "Maintenance Data Entry",
    actions: ["Create draft", "Submit work order"],
    next: "Work Order Draft",
    reject: "Not applicable",
    clarification: "Respond to clarification",
    notification: "Creator receives status updates",
    audit: "Required",
    tone: "blue",
    icon: ClipboardList,
    x: 60,
    y: 120,
    width: 220,
    summary: "Creates the maintenance request."
  },
  {
    id: "work-order-draft",
    label: "Work Order Draft",
    type: "Draft",
    role: "Maintenance Data Entry",
    actions: ["Save draft", "Submit"],
    next: "Submit Work Order",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "None until submitted",
    audit: "Required",
    tone: "blue",
    icon: ClipboardList,
    x: 340,
    y: 120,
    width: 220,
    summary: "Editable draft before workflow starts."
  },
  {
    id: "submit-work-order",
    label: "Submit Work Order",
    type: "Workflow event",
    role: "System",
    actions: ["Start workflow instance"],
    next: "Maintenance Manager Review",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Manager approval required",
    audit: "Required",
    tone: "gray",
    icon: Settings2,
    x: 620,
    y: 120,
    width: 220,
    summary: "Starts backend-controlled status routing."
  },
  {
    id: "maintenance-manager-review",
    label: "Maintenance Manager Review",
    type: "Approval",
    role: "Maintenance Manager",
    actions: ["Approve", "Reject", "Request Clarification", "Mark urgent"],
    next: "System Inventory Check",
    reject: "Rejected -> Maintenance Data Entry",
    clarification: "Clarification Required -> Same Manager Review Step",
    notification: "Normal, high if urgent",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 900,
    y: 120,
    width: 240,
    summary: "First approval authority for maintenance."
  },
  {
    id: "system-inventory-check",
    label: "System Inventory Check",
    type: "Automation",
    role: "Inventory Engine",
    actions: ["Check stock digitally"],
    next: "Store Keeper Confirmation",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Store queue update",
    audit: "Required",
    tone: "gray",
    icon: Settings2,
    x: 1210,
    y: 120,
    width: 230,
    summary: "Digital availability check."
  },
  {
    id: "store-keeper-confirmation",
    label: "Store Keeper Confirmation",
    type: "Inventory decision",
    role: "Store Keeper",
    actions: ["Confirm stock", "Issue parts", "Confirm shortage"],
    next: "Parts Available or Parts Not Available",
    reject: "Not applicable",
    clarification: "Clarification Required -> Maintenance Manager Review",
    notification: "Store queue and manager update",
    audit: "Required",
    tone: "orange",
    icon: Warehouse,
    x: 1210,
    y: 330,
    width: 230,
    summary: "Confirms physical stock."
  },
  {
    id: "parts-available",
    label: "Parts Available",
    type: "Decision",
    role: "Store Keeper",
    actions: ["Route to issue"],
    next: "Store Issue Parts",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Ready for store issue",
    audit: "Required",
    tone: "green",
    icon: PackageCheck,
    x: 920,
    y: 520,
    width: 210,
    summary: "Fast operational path."
  },
  {
    id: "store-issue-parts",
    label: "Store Issue Parts",
    type: "Store action",
    role: "Store Keeper",
    actions: ["Issue parts", "Record movement"],
    next: "Ready for Assignment",
    reject: "Not applicable",
    clarification: "Clarification Required -> Maintenance Manager",
    notification: "Parts issued",
    audit: "Required",
    tone: "orange",
    icon: Warehouse,
    x: 640,
    y: 520,
    width: 220,
    summary: "Issues parts from stock."
  },
  {
    id: "ready-for-assignment",
    label: "Ready for Assignment",
    type: "Queue",
    role: "Maintenance Manager",
    actions: ["Assign team"],
    next: "Maintenance Team Assignment",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Assignment queue update",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 360,
    y: 520,
    width: 220,
    summary: "Work can be assigned."
  },
  {
    id: "maintenance-team-assignment",
    label: "Team Assignment",
    type: "Assignment",
    role: "Maintenance Manager",
    actions: ["Assign Auto", "Assign Mechanical", "Assign Electrical"],
    next: "Team execution",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Team assigned",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 80,
    y: 520,
    width: 220,
    summary: "Routes work to the correct team."
  },
  {
    id: "auto-team",
    label: "Auto Team",
    type: "Execution",
    role: "Maintenance Team",
    actions: ["Start work", "Add notes", "Complete"],
    next: "Work In Progress",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Work assigned",
    audit: "Required",
    tone: "green",
    icon: Wrench,
    x: 60,
    y: 720,
    width: 180,
    summary: "Vehicle and auto jobs."
  },
  {
    id: "mechanical-team",
    label: "Mechanical Team",
    type: "Execution",
    role: "Maintenance Team",
    actions: ["Start work", "Add notes", "Complete"],
    next: "Work In Progress",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Work assigned",
    audit: "Required",
    tone: "green",
    icon: Wrench,
    x: 270,
    y: 720,
    width: 180,
    summary: "Mechanical jobs."
  },
  {
    id: "electrical-team",
    label: "Electrical Team",
    type: "Execution",
    role: "Maintenance Team",
    actions: ["Start work", "Add notes", "Complete"],
    next: "Work In Progress",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Work assigned",
    audit: "Required",
    tone: "green",
    icon: Wrench,
    x: 480,
    y: 720,
    width: 180,
    summary: "Electrical jobs."
  },
  {
    id: "work-in-progress",
    label: "Work In Progress",
    type: "Execution",
    role: "Maintenance Teams",
    actions: ["Update job", "Request parts", "Complete"],
    next: "Completed by Team",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Job started",
    audit: "Required",
    tone: "green",
    icon: Wrench,
    x: 730,
    y: 720,
    width: 210,
    summary: "Active maintenance execution."
  },
  {
    id: "completed-by-team",
    label: "Completed by Team",
    type: "Execution event",
    role: "Maintenance Teams",
    actions: ["Submit completion"],
    next: "Supervisor Verification",
    reject: "Not applicable",
    clarification: "Return to work in progress",
    notification: "Verification required",
    audit: "Required",
    tone: "green",
    icon: PackageCheck,
    x: 1000,
    y: 720,
    width: 210,
    summary: "Team marks work complete."
  },
  {
    id: "supervisor-verification",
    label: "Supervisor Verification",
    type: "Verification",
    role: "Supervisor / Manager",
    actions: ["Verify", "Return for correction"],
    next: "Maintenance Manager Closure",
    reject: "Return to team",
    clarification: "Return to team",
    notification: "Closure queue update",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 1260,
    y: 720,
    width: 220,
    summary: "Confirms completed work."
  },
  {
    id: "maintenance-manager-closure",
    label: "Manager Closure",
    type: "Closure",
    role: "Maintenance Manager",
    actions: ["Close work order"],
    next: "Work Order Closed",
    reject: "Return to verification",
    clarification: "Return to verification",
    notification: "Work order closed",
    audit: "Required",
    tone: "green",
    icon: PackageCheck,
    x: 1260,
    y: 910,
    width: 220,
    summary: "Final operational closure."
  },
  {
    id: "work-order-closed",
    label: "Work Order Closed",
    type: "Final state",
    role: "System",
    actions: ["Update history", "Notify requester"],
    next: "Asset history updated",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Closure notification",
    audit: "Required",
    tone: "green",
    icon: PackageCheck,
    x: 980,
    y: 910,
    width: 220,
    summary: "Final closed status."
  },
  {
    id: "parts-not-available",
    label: "Parts Not Available",
    type: "Decision",
    role: "Store Keeper",
    actions: ["Confirm shortage"],
    next: "Production Manager Approval",
    reject: "Not applicable",
    clarification: "Clarification Required -> Store Keeper",
    notification: "Inventory shortage confirmed",
    audit: "Required",
    tone: "orange",
    icon: Split,
    x: 1210,
    y: 520,
    width: 230,
    summary: "Purchase approval path begins."
  },
  {
    id: "production-manager-approval",
    label: "Production Manager",
    type: "Approval",
    role: "Production Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Factory Manager Approval",
    reject: "Rejected -> Creator/Data Entry",
    clarification: "Clarification Required -> Same approval step",
    notification: "Approval required",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 1500,
    y: 520,
    width: 220,
    summary: "Approves unavailable-parts maintenance request."
  },
  {
    id: "factory-manager-approval",
    label: "Factory Manager",
    type: "Approval",
    role: "Factory Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Purchase Manager Approval",
    reject: "Rejected -> Creator/Data Entry",
    clarification: "Clarification Required -> Same approval step",
    notification: "Approval required",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 1780,
    y: 520,
    width: 220,
    summary: "Factory approval for unavailable parts."
  },
  {
    id: "purchase-manager-approval",
    label: "Purchase Manager",
    type: "Approval",
    role: "Purchase Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Finance Manager Approval",
    reject: "Rejected -> Creator/Data Entry",
    clarification: "Clarification Required -> Same approval step",
    notification: "Purchase approval required",
    audit: "Required",
    tone: "yellow",
    icon: ShoppingCart,
    x: 2060,
    y: 520,
    width: 220,
    summary: "Reviews purchase-related request."
  },
  {
    id: "finance-manager-approval",
    label: "Finance Manager",
    type: "Approval",
    role: "Finance Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "CEO Final Approval",
    reject: "Rejected -> Creator/Data Entry",
    clarification: "Clarification Required -> Same finance step",
    notification: "Finance approval required",
    audit: "Required",
    tone: "teal",
    icon: ClipboardCheck,
    x: 2340,
    y: 520,
    width: 220,
    summary: "Budget and finance approval."
  },
  {
    id: "ceo-final-approval",
    label: "CEO Final Approval",
    type: "Approval",
    role: "CEO",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Approved for Purchase",
    reject: "Rejected -> Creator/Data Entry",
    clarification: "Clarification Required -> Same CEO Approval Step",
    notification: "High priority if urgent",
    audit: "Required",
    tone: "red",
    icon: Crown,
    x: 2620,
    y: 520,
    width: 220,
    summary: "Final approval before PO."
  },
  {
    id: "approved-for-purchase",
    label: "Approved for Purchase",
    type: "Decision",
    role: "System",
    actions: ["Release to purchase officer"],
    next: "Purchase Officer PO Create",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "PO creation required",
    audit: "Required",
    tone: "yellow",
    icon: ShoppingCart,
    x: 2620,
    y: 720,
    width: 220,
    summary: "Request can become a PO."
  },
  {
    id: "purchase-officer-po-create",
    label: "Purchase Officer PO Create",
    type: "PO action",
    role: "Purchase Officer",
    actions: ["Create PO", "Attach supplier documents", "Issue PO"],
    next: "PO Issued",
    reject: "Not applicable after CEO approval",
    clarification: "Clarification Required -> Purchase Manager Approval",
    notification: "PO creation required",
    audit: "Required",
    tone: "yellow",
    icon: FileText,
    x: 2340,
    y: 720,
    width: 220,
    summary: "PO is created after CEO approval."
  },
  {
    id: "po-issued",
    label: "PO Issued",
    type: "Purchase event",
    role: "Purchase Officer",
    actions: ["Issue PO"],
    next: "Waiting for Parts",
    reject: "Not applicable",
    clarification: "Clarification Required -> Purchase Officer",
    notification: "PO issued",
    audit: "Required",
    tone: "yellow",
    icon: FileText,
    x: 2060,
    y: 720,
    width: 220,
    summary: "Supplier order issued."
  },
  {
    id: "waiting-for-parts",
    label: "Waiting for Parts",
    type: "Waiting state",
    role: "Store / Purchase",
    actions: ["Track delivery"],
    next: "Parts Received",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Waiting queue update",
    audit: "Required",
    tone: "orange",
    icon: Warehouse,
    x: 1780,
    y: 720,
    width: 220,
    summary: "Job waits for delivery."
  },
  {
    id: "parts-received",
    label: "Parts Received",
    type: "Store action",
    role: "Store Keeper",
    actions: ["Receive parts", "Update stock"],
    next: "Ready for Assignment",
    reject: "Not applicable",
    clarification: "Clarification Required -> Purchase Officer",
    notification: "Parts received",
    audit: "Required",
    tone: "green",
    icon: PackageCheck,
    x: 1500,
    y: 720,
    width: 220,
    summary: "Stock received and ready."
  },
  {
    id: "rejected",
    label: "Rejected",
    type: "Exception",
    role: "Approver",
    actions: ["Reject with reason"],
    next: "Creator/Data Entry",
    reject: "Final rejection path",
    clarification: "Not applicable",
    notification: "Creator notified",
    audit: "Required",
    tone: "pink",
    icon: AlertCircle,
    x: 900,
    y: 330,
    width: 220,
    summary: "Requires rejection reason."
  },
  {
    id: "clarification-required",
    label: "Clarification Required",
    type: "Exception",
    role: "Creator / Same Approver",
    actions: ["Request reason", "Respond", "Return to same step"],
    next: "Same approval node",
    reject: "Not applicable",
    clarification: "Loops back to same approval step",
    notification: "Clarification requested",
    audit: "Required",
    tone: "pink",
    icon: AlertCircle,
    x: 620,
    y: 330,
    width: 220,
    summary: "Question and response loop."
  }
];

type NodePositions = Record<string, { x: number; y: number }>;

const defaultNodePositions: NodePositions = workflowGraphNodes.reduce<NodePositions>((positions, node) => {
  positions[node.id] = { x: node.x, y: node.y };
  return positions;
}, {});

const cleanNodePositions: NodePositions = {
  "maintenance-data-entry": { x: 70, y: 120 },
  "work-order-draft": { x: 340, y: 120 },
  "submit-work-order": { x: 610, y: 120 },
  "maintenance-manager-review": { x: 880, y: 120 },
  "system-inventory-check": { x: 1150, y: 120 },
  "store-keeper-confirmation": { x: 1420, y: 120 },
  "parts-available": { x: 1690, y: 60 },
  "store-issue-parts": { x: 1960, y: 60 },
  "ready-for-assignment": { x: 2230, y: 60 },
  "maintenance-team-assignment": { x: 2500, y: 60 },
  "auto-team": { x: 2770, y: 20 },
  "mechanical-team": { x: 2770, y: 160 },
  "electrical-team": { x: 2770, y: 300 },
  "work-in-progress": { x: 3040, y: 160 },
  "completed-by-team": { x: 3310, y: 160 },
  "supervisor-verification": { x: 3580, y: 160 },
  "maintenance-manager-closure": { x: 3850, y: 160 },
  "work-order-closed": { x: 4120, y: 160 },
  "parts-not-available": { x: 1690, y: 360 },
  "production-manager-approval": { x: 1960, y: 360 },
  "factory-manager-approval": { x: 2230, y: 360 },
  "purchase-manager-approval": { x: 2500, y: 360 },
  "finance-manager-approval": { x: 2770, y: 360 },
  "ceo-final-approval": { x: 3040, y: 360 },
  "approved-for-purchase": { x: 3310, y: 360 },
  "purchase-officer-po-create": { x: 3580, y: 360 },
  "po-issued": { x: 3850, y: 360 },
  "waiting-for-parts": { x: 4120, y: 360 },
  "parts-received": { x: 4390, y: 360 },
  rejected: { x: 880, y: 360 },
  "clarification-required": { x: 610, y: 360 }
};

const constructionWorkflowGraphNodes: WorkflowGraphNode[] = [
  {
    id: "project-data-entry",
    label: "Project Data Entry",
    type: "Entry",
    role: "Project Data Entry",
    actions: ["Create request", "Submit"],
    next: "Project Request Submit",
    reject: "Not applicable",
    clarification: "Respond to clarification",
    notification: "Creator receives status updates",
    audit: "Required",
    tone: "blue",
    icon: ClipboardList,
    x: 70,
    y: 140,
    width: 220,
    summary: "Creates project or construction request."
  },
  {
    id: "project-request-submit",
    label: "Project Request Submit",
    type: "Workflow event",
    role: "System",
    actions: ["Start project workflow"],
    next: "Project Manager Approval",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "Project approval required",
    audit: "Required",
    tone: "gray",
    icon: Settings2,
    x: 350,
    y: 140,
    width: 220,
    summary: "Starts project request routing."
  },
  {
    id: "project-manager-approval",
    label: "Project Manager Approval",
    type: "Approval",
    role: "Project Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Construction Manager Approval",
    reject: "Rejected -> Project Data Entry",
    clarification: "Clarification Required -> Same approval step",
    notification: "Approval required",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 630,
    y: 140,
    width: 230,
    summary: "Reviews project need and scope."
  },
  {
    id: "construction-manager-approval",
    label: "Construction Manager Approval",
    type: "Approval",
    role: "Construction Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Purchase Manager Approval",
    reject: "Rejected -> Project Data Entry",
    clarification: "Clarification Required -> Same approval step",
    notification: "Approval required",
    audit: "Required",
    tone: "purple",
    icon: ClipboardCheck,
    x: 930,
    y: 140,
    width: 250,
    summary: "Confirms construction execution requirement."
  },
  {
    id: "purchase-manager-approval",
    label: "Purchase Manager Approval",
    type: "Approval",
    role: "Purchase Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Finance Manager Approval",
    reject: "Rejected -> Project Data Entry",
    clarification: "Clarification Required -> Same approval step",
    notification: "Purchase approval required",
    audit: "Required",
    tone: "yellow",
    icon: ShoppingCart,
    x: 1250,
    y: 140,
    width: 230,
    summary: "Reviews procurement requirement."
  },
  {
    id: "finance-manager-approval",
    label: "Finance Manager Approval",
    type: "Approval",
    role: "Finance Manager",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "CEO Final Approval",
    reject: "Rejected -> Project Data Entry",
    clarification: "Clarification Required -> Same finance step",
    notification: "Finance approval required",
    audit: "Required",
    tone: "teal",
    icon: ClipboardCheck,
    x: 1530,
    y: 140,
    width: 230,
    summary: "Approves budget and finance step."
  },
  {
    id: "ceo-final-approval",
    label: "CEO Final Approval",
    type: "Approval",
    role: "CEO",
    actions: ["Approve", "Reject", "Request Clarification"],
    next: "Project Approved for Purchase",
    reject: "Rejected -> Project Data Entry",
    clarification: "Clarification Required -> Same CEO step",
    notification: "High priority if urgent",
    audit: "Required",
    tone: "red",
    icon: Crown,
    x: 1810,
    y: 140,
    width: 220,
    summary: "Final approval before project PO."
  },
  {
    id: "project-approved-for-purchase",
    label: "Project Approved for Purchase",
    type: "Decision",
    role: "System",
    actions: ["Release to purchase officer"],
    next: "Project PO Create",
    reject: "Not applicable",
    clarification: "Not applicable",
    notification: "PO creation required",
    audit: "Required",
    tone: "yellow",
    icon: ShoppingCart,
    x: 2090,
    y: 140,
    width: 250,
    summary: "Project request can become a PO."
  },
  {
    id: "project-po-create",
    label: "Project PO Create",
    type: "PO action",
    role: "Purchase Officer",
    actions: ["Create PO", "Attach documents", "Issue PO"],
    next: "Project PO Issued",
    reject: "Not applicable after CEO approval",
    clarification: "Clarification Required -> Purchase Manager",
    notification: "PO creation required",
    audit: "Required",
    tone: "yellow",
    icon: FileText,
    x: 2400,
    y: 140,
    width: 220,
    summary: "Purchase Officer creates project PO."
  },
  {
    id: "project-po-issued",
    label: "Project PO Issued",
    type: "Purchase event",
    role: "Purchase Officer",
    actions: ["Issue PO"],
    next: "Waiting / Ready / Received",
    reject: "Not applicable",
    clarification: "Clarification Required -> Purchase Officer",
    notification: "PO issued",
    audit: "Required",
    tone: "yellow",
    icon: FileText,
    x: 2680,
    y: 140,
    width: 220,
    summary: "Project PO is issued."
  },
  {
    id: "waiting-ready-received",
    label: "Waiting / Ready / Received",
    type: "Readiness state",
    role: "Purchase / Project",
    actions: ["Track delivery", "Mark ready", "Receive"],
    next: "Project Execution",
    reject: "Not applicable",
    clarification: "Clarification Required -> Purchase Officer",
    notification: "Readiness update",
    audit: "Required",
    tone: "orange",
    icon: Warehouse,
    x: 2960,
    y: 140,
    width: 240,
    summary: "Tracks project materials and readiness."
  },
  {
    id: "project-execution",
    label: "Project Execution",
    type: "Execution",
    role: "Project / Construction Team",
    actions: ["Execute project", "Update progress", "Complete"],
    next: "Project Closed",
    reject: "Return for correction",
    clarification: "Return to project team",
    notification: "Project execution update",
    audit: "Required",
    tone: "green",
    icon: Wrench,
    x: 3260,
    y: 140,
    width: 220,
    summary: "Project work is performed."
  },
  {
    id: "project-closed",
    label: "Project Closed",
    type: "Final state",
    role: "Project Manager",
    actions: ["Close project request"],
    next: "Final report",
    reject: "Return to execution",
    clarification: "Return to execution",
    notification: "Project closed",
    audit: "Required",
    tone: "green",
    icon: PackageCheck,
    x: 3540,
    y: 140,
    width: 220,
    summary: "Project request is closed."
  },
  {
    id: "project-rejected",
    label: "Project Rejected",
    type: "Exception",
    role: "Approver",
    actions: ["Reject with reason"],
    next: "Project Data Entry",
    reject: "Final rejection path",
    clarification: "Not applicable",
    notification: "Creator notified",
    audit: "Required",
    tone: "pink",
    icon: AlertCircle,
    x: 930,
    y: 370,
    width: 220,
    summary: "Requires rejection reason."
  },
  {
    id: "project-clarification-required",
    label: "Project Clarification Required",
    type: "Exception",
    role: "Creator / Same Approver",
    actions: ["Request reason", "Respond", "Return to same step"],
    next: "Same approval node",
    reject: "Not applicable",
    clarification: "Loops back to same approval step",
    notification: "Clarification requested",
    audit: "Required",
    tone: "pink",
    icon: AlertCircle,
    x: 630,
    y: 370,
    width: 250,
    summary: "Question and response loop."
  }
];

const constructionNodePositions: NodePositions = constructionWorkflowGraphNodes.reduce<NodePositions>((positions, node) => {
  positions[node.id] = { x: node.x, y: node.y };
  return positions;
}, {});

const nodeDetails: NodeInfo[] = workflowGraphNodes;

const availableEdges = [
  ["maintenance-data-entry", "work-order-draft"],
  ["work-order-draft", "submit-work-order"],
  ["submit-work-order", "maintenance-manager-review"],
  ["maintenance-manager-review", "system-inventory-check"],
  ["system-inventory-check", "store-keeper-confirmation"],
  ["store-keeper-confirmation", "parts-available"],
  ["parts-available", "store-issue-parts"],
  ["store-issue-parts", "ready-for-assignment"],
  ["ready-for-assignment", "maintenance-team-assignment"],
  ["maintenance-team-assignment", "auto-team"],
  ["maintenance-team-assignment", "mechanical-team"],
  ["maintenance-team-assignment", "electrical-team"],
  ["auto-team", "work-in-progress"],
  ["mechanical-team", "work-in-progress"],
  ["electrical-team", "work-in-progress"],
  ["work-in-progress", "completed-by-team"],
  ["completed-by-team", "supervisor-verification"],
  ["supervisor-verification", "maintenance-manager-closure"],
  ["maintenance-manager-closure", "work-order-closed"]
];

const unavailableEdges = [
  ["store-keeper-confirmation", "parts-not-available"],
  ["parts-not-available", "production-manager-approval"],
  ["production-manager-approval", "factory-manager-approval"],
  ["factory-manager-approval", "purchase-manager-approval"],
  ["purchase-manager-approval", "finance-manager-approval"],
  ["finance-manager-approval", "ceo-final-approval"],
  ["ceo-final-approval", "approved-for-purchase"],
  ["approved-for-purchase", "purchase-officer-po-create"],
  ["purchase-officer-po-create", "po-issued"],
  ["po-issued", "waiting-for-parts"],
  ["waiting-for-parts", "parts-received"],
  ["parts-received", "ready-for-assignment"]
];

const rejectionEdges = [
  ["approval-node", "rejected"],
  ["approval-node", "clarification-required"],
  ["clarification-required", "same approval-node"],
  ["rejected", "creator/data-entry"]
];

const constructionEdges = [
  ["project-data-entry", "project-request-submit"],
  ["project-request-submit", "project-manager-approval"],
  ["project-manager-approval", "construction-manager-approval"],
  ["construction-manager-approval", "purchase-manager-approval"],
  ["purchase-manager-approval", "finance-manager-approval"],
  ["finance-manager-approval", "ceo-final-approval"],
  ["ceo-final-approval", "project-approved-for-purchase"],
  ["project-approved-for-purchase", "project-po-create"],
  ["project-po-create", "project-po-issued"],
  ["project-po-issued", "waiting-ready-received"],
  ["waiting-ready-received", "project-execution"],
  ["project-execution", "project-closed"]
];

const workflowGraphEdges: WorkflowGraphEdge[] = [
  ...availableEdges.map(([from, to]) => ({ from, to, tone: "green" as Tone })),
  ...unavailableEdges.map(([from, to]) => ({ from, to, tone: "yellow" as Tone })),
  { from: "maintenance-manager-review", to: "rejected", label: "Reject", tone: "pink" },
  { from: "maintenance-manager-review", to: "clarification-required", label: "Clarify", tone: "pink" },
  { from: "production-manager-approval", to: "rejected", label: "Reject", tone: "pink" },
  { from: "factory-manager-approval", to: "rejected", label: "Reject", tone: "pink" },
  { from: "purchase-manager-approval", to: "rejected", label: "Reject", tone: "pink" },
  { from: "finance-manager-approval", to: "rejected", label: "Reject", tone: "pink" },
  { from: "ceo-final-approval", to: "rejected", label: "Reject", tone: "pink" },
  { from: "clarification-required", to: "maintenance-manager-review", label: "Return", tone: "pink" }
];

const constructionGraphEdges: WorkflowGraphEdge[] = [
  ...constructionEdges.map(([from, to]) => ({ from, to, tone: "blue" as Tone })),
  { from: "project-manager-approval", to: "project-rejected", label: "Reject", tone: "pink" },
  { from: "construction-manager-approval", to: "project-rejected", label: "Reject", tone: "pink" },
  { from: "purchase-manager-approval", to: "project-rejected", label: "Reject", tone: "pink" },
  { from: "finance-manager-approval", to: "project-rejected", label: "Reject", tone: "pink" },
  { from: "ceo-final-approval", to: "project-rejected", label: "Reject", tone: "pink" },
  { from: "project-manager-approval", to: "project-clarification-required", label: "Clarify", tone: "pink" },
  { from: "project-clarification-required", to: "project-manager-approval", label: "Return", tone: "pink" }
];

const rules = [
  "Status is backend-controlled.",
  "Data Entry cannot manually select status.",
  "Approval is sequential.",
  "Every approval step supports Approve / Reject / Request Clarification.",
  "Every rejection and clarification requires reason.",
  "Store Keeper confirms stock physically.",
  "System checks inventory digitally.",
  "Purchase flow starts only when parts/materials are not available.",
  "CEO approval happens before PO creation.",
  "Purchase Officer creates PO after CEO approval.",
  "Emergency increases priority but does not remove CEO approval for purchase-related requests."
];

const pendingConfirmations = [
  "Quotation requirement before PO",
  "Exact finance fields",
  "Exact PO creator role",
  "Whether small-value purchases can skip some approvals",
  "Whether all unavailable-parts work orders always need Production + Factory approval",
  "Exact construction request form fields",
  "Exact maintenance team supervisor structure",
  "Delegation / alternate approver rules"
];

export function WorkflowMapEditor(props: WorkflowMapEditorProps) {
  const [selectedWorkflow, setSelectedWorkflow] = useState(workflows[0]);
  const [selectedNodeId, setSelectedNodeId] = useState(nodeDetails[0].id);
  const [diagramTitle, setDiagramTitle] = useState(props.initialDiagram.title);

  const currentNodeDetails = selectedWorkflow === workflows[1] ? constructionWorkflowGraphNodes : workflowGraphNodes;
  const selectedNode = useMemo(() => currentNodeDetails.find((node) => node.id === selectedNodeId) ?? currentNodeDetails[0], [currentNodeDetails, selectedNodeId]);

  function selectWorkflow(workflow: string) {
    setSelectedWorkflow(workflow);
    setSelectedNodeId(workflow === workflows[1] ? constructionWorkflowGraphNodes[0].id : workflowGraphNodes[0].id);
  }

  function resetTitle() {
    setDiagramTitle(props.officialDiagram.title);
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <section className="rounded-md border border-[#1F2937] bg-[#111827] p-5 text-white shadow-sm lg:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-red-200">Admin workflow configuration preview</p>
            <h1 className="mt-3 text-3xl font-black sm:text-4xl">RECAFCO Workflow Map Editor</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-200">
              Frontend planning interface for visualizing workflow nodes, edges, approval paths, notifications, and audit rules before backend workflow activation.
            </p>
            <p className="mt-2 text-xs font-semibold text-gray-300">
              {props.activeVersion ? `Loaded planning version ${props.activeVersion.version_number}: ${props.activeVersion.title}` : "Loaded frontend planning map."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/system-map">
              <Button variant="secondary">
                <MapIcon className="h-4 w-4" aria-hidden="true" />
                Official map
              </Button>
            </Link>
            <Button type="button" variant="secondary" onClick={resetTitle}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset preview title
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase text-[#ED1C24]">Workflow Selector</p>
            <h2 className="mt-1 text-2xl font-black text-[#111827]">Choose the workflow map to review.</h2>
          </div>
          <label className="min-w-0 text-xs font-black uppercase text-[#4B5563] lg:w-80">
            Map title
            <input className="focus-ring mt-2 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm font-semibold normal-case" value={diagramTitle} onChange={(event) => setDiagramTitle(event.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {workflows.map((workflow) => (
            <button
              key={workflow}
              type="button"
              className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                selectedWorkflow === workflow ? "border-[#ED1C24] bg-red-50 text-[#ED1C24]" : "border-[#E5E7EB] bg-white text-[#111827] hover:bg-gray-50"
              }`}
              onClick={() => selectWorkflow(workflow)}
            >
              {workflow}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_22rem]">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <SectionHeader eyebrow="Node Library Panel" title="Selectable workflow nodes" />
          <div className="mt-4 space-y-4">
            <NodeLibraryGroup title="Maintenance nodes" icon={ClipboardList} items={maintenanceNodes} />
            <NodeLibraryGroup title="Construction nodes" icon={ShoppingCart} items={constructionNodes} />
            <NodeLibraryGroup title="System support nodes" icon={Settings2} items={systemNodes} />
          </div>
        </section>

        <section className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <SectionHeader eyebrow="Workflow Canvas Preview" title={selectedWorkflow} />
          <WorkflowCanvas key={selectedWorkflow} workflow={selectedWorkflow} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
        </section>

        <NodeDetailsPanel nodes={currentNodeDetails} selectedNode={selectedNode} onSelect={setSelectedNodeId} />
      </div>

      <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <SectionHeader eyebrow="Edge List / Connection Rules" title="Current planned workflow handoffs" />
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <EdgeListTable title="Maintenance Parts Available edges" edges={availableEdges} tone="green" />
          <EdgeListTable title="Maintenance Parts Not Available edges" edges={unavailableEdges} tone="yellow" />
          <EdgeListTable title="Rejection / clarification edges" edges={rejectionEdges} tone="pink" />
          <EdgeListTable title="Construction edges" edges={constructionEdges} tone="blue" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <SectionHeader eyebrow="Workflow Rules" title="Rules that the future backend engine must enforce" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {rules.map((rule) => (
              <div key={rule} className="flex gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm leading-5 text-[#4B5563]">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#ED1C24]" aria-hidden="true" />
                {rule}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <SectionHeader eyebrow="Pending Business Confirmation" title="Open items for management decision" />
          <ul className="mt-4 space-y-2">
            {pendingConfirmations.map((item) => (
              <li key={item} className="flex gap-3 rounded-md border border-amber-200 bg-white p-3 text-sm leading-5 text-[#4B5563]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-md border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-blue-900">Frontend-only planning mode</p>
            <p className="mt-1 text-xs leading-5 text-blue-800">
              This screen does not activate live workflow routing. It is a management and Super Admin configuration preview for the future NestJS workflow engine.
            </p>
          </div>
          <span className="rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-800">
            {props.versions.length} saved planning versions available
          </span>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black text-[#111827]">{title}</h2>
    </div>
  );
}

function NodeLibraryGroup({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#ED1C24]" aria-hidden="true" />
        <h3 className="text-sm font-black text-[#111827]">{title}</h3>
      </div>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <button key={item} type="button" className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-left text-xs font-semibold text-[#4B5563] hover:border-[#ED1C24] hover:bg-red-50 hover:text-[#ED1C24]">
            <PencilRuler className="mr-2 inline h-3.5 w-3.5" aria-hidden="true" />
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkflowCanvas({ workflow, selectedNodeId, onSelect }: { workflow: string; selectedNodeId: string; onSelect: (id: string) => void }) {
  const isConstruction = workflow === workflows[1];
  const baseNodes = isConstruction ? constructionWorkflowGraphNodes : workflowGraphNodes;
  const baseEdges = isConstruction ? constructionGraphEdges : workflowGraphEdges;
  const defaultPositions = isConstruction ? constructionNodePositions : cleanNodePositions;
  const originalPositions = isConstruction ? constructionNodePositions : defaultNodePositions;
  const [positions, setPositions] = useState<NodePositions>(defaultPositions);
  const graphNodes = useMemo(() => baseNodes.map((node) => ({ ...node, ...(positions[node.id] ?? { x: node.x, y: node.y }) })), [baseNodes, positions]);
  const nodeLookup = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes]);
  const board = { width: 4640, height: 1100 };
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(isConstruction ? 0.75 : 0.65);
  const [showExceptions, setShowExceptions] = useState(false);
  const dragRef = useRef<{ id: string; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const displayedEdges = showExceptions ? baseEdges : baseEdges.filter((edge) => edge.tone !== "pink");

  useEffect(() => {
    if (!isFullscreen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsFullscreen(false);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  function zoomIn() {
    setZoom((current) => Math.min(1.3, Number((current + 0.1).toFixed(2))));
  }

  function zoomOut() {
    setZoom((current) => Math.max(0.45, Number((current - 0.1).toFixed(2))));
  }

  function resetView() {
    setZoom(isConstruction ? 0.75 : 0.65);
  }

  function resetLayout() {
    setPositions(originalPositions);
  }

  function applyCleanLayout() {
    setPositions(defaultPositions);
    setZoom(isConstruction ? 0.75 : 0.55);
  }

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, node: WorkflowGraphNode) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y
    };
    onSelect(node.id);
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    const nextX = Math.max(20, Math.min(board.width - 260, drag.startX + (event.clientX - drag.startClientX) / zoom));
    const nextY = Math.max(20, Math.min(board.height - 150, drag.startY + (event.clientY - drag.startClientY) / zoom));
    setPositions((current) => ({ ...current, [drag.id]: { x: nextX, y: nextY } }));
  }

  function endDrag() {
    dragRef.current = null;
  }

  const shellClass = isFullscreen ? "fixed inset-0 z-50 bg-[#F5F6F8] p-4" : "mt-4";
  const viewportClass = isFullscreen ? "h-[calc(100vh-6rem)]" : "h-[42rem]";

  return (
    <div className={shellClass}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm">
        <div>
          <p className="text-xs font-black uppercase text-[#ED1C24]">Interactive workflow board</p>
          <p className="mt-0.5 text-xs text-[#4B5563]">Drag nodes to arrange them. Connectors update automatically. Use zoom and scroll to navigate the workflow.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-xs font-black text-[#4B5563]">{Math.round(zoom * 100)}%</span>
          <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={zoomOut}>
            <ZoomOut className="h-4 w-4" aria-hidden="true" />
            Zoom out
          </Button>
          <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={zoomIn}>
            <ZoomIn className="h-4 w-4" aria-hidden="true" />
            Zoom in
          </Button>
          <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={resetView}>
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
            Reset zoom
          </Button>
          <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={applyCleanLayout}>
            <MousePointer2 className="h-4 w-4" aria-hidden="true" />
            Clean layout
          </Button>
          <Button type="button" variant={showExceptions ? "primary" : "secondary"} className="min-h-9 px-3" onClick={() => setShowExceptions((current) => !current)}>
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {showExceptions ? "Hide exceptions" : "Show exceptions"}
          </Button>
          <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={resetLayout}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Original layout
          </Button>
          <Button type="button" variant="primary" className="min-h-9 px-3" onClick={() => setIsFullscreen((current) => !current)}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </Button>
        </div>
      </div>
      <div className={`${viewportClass} overflow-auto rounded-md border border-[#D8DEE8] bg-[#F5F6F8] shadow-inner`}>
        <div className="relative" style={{ width: board.width * zoom, height: board.height * zoom }}>
          <div
            className="relative"
            style={{
              width: board.width,
              height: board.height,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              backgroundImage: "radial-gradient(circle, #CBD5E1 1px, transparent 1px)",
              backgroundSize: "24px 24px"
            }}
          >
            <div className="absolute left-10 top-8 rounded-md border border-blue-200 bg-white/95 px-3 py-2 shadow-sm">
              <p className="text-xs font-black uppercase text-blue-700">{isConstruction ? "Construction / Project Request" : "Maintenance Work Order"}</p>
              <p className="mt-1 text-xs text-[#4B5563]">Node graph preview - frontend planning only</p>
            </div>
            {isConstruction ? (
              <BranchLabel left={70} top={70} tone="blue" title="Construction / Project Flow" subtitle="Factory Manager is not involved" />
            ) : (
              <>
                <BranchLabel left={1690} top={10} tone="green" title="Fast Operational Path" subtitle="Parts Available" />
                <BranchLabel left={1690} top={310} tone="yellow" title="Purchase Approval Path" subtitle="Parts Not Available" />
              </>
            )}

            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${board.width} ${board.height}`} aria-hidden="true">
              <defs>
                {Object.keys(toneClasses).map((tone) => (
                  <marker key={tone} id={`workflow-arrow-${tone}`} markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
                    <path d="M1,1 L11,6 L1,11 z" fill={edgeColor(tone as Tone)} />
                  </marker>
                ))}
              </defs>
              {displayedEdges.map((edge, index) => {
                const from = nodeLookup.get(edge.from);
                const to = nodeLookup.get(edge.to);
                if (!from || !to) return null;

                const tone = edge.tone ?? "gray";
                const color = edgeColor(tone);
                const x1 = from.x + from.width;
                const y1 = from.y + 58;
                const x2 = to.x;
                const y2 = to.y + 58;
                const forward = x2 >= x1;
                const curve = forward ? Math.min(150, Math.max(70, (x2 - x1) / 2)) : 130;
                const c1x = forward ? x1 + curve : x1 + curve;
                const c2x = forward ? x2 - curve : x2 - curve;
                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;

                return (
                  <g key={`${edge.from}-${edge.to}-${index}`}>
                    <path
                      d={`M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={edge.tone === "pink" ? 2 : 2.75}
                      strokeDasharray={edge.tone === "pink" ? "7 7" : undefined}
                      markerEnd={`url(#workflow-arrow-${tone})`}
                    />
                    {edge.label ? (
                      <foreignObject x={midX - 44} y={midY - 22} width="88" height="28">
                        <div className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-center text-[10px] font-black uppercase text-[#4B5563] shadow-sm">
                          {edge.label}
                        </div>
                      </foreignObject>
                    ) : null}
                  </g>
                );
              })}
            </svg>

            {graphNodes.map((node, index) => (
              <GraphNodeCard
                key={node.id}
                node={node}
                index={index}
                selected={selectedNodeId === node.id}
                onSelect={onSelect}
                onDragStart={beginDrag}
                onDragMove={moveDrag}
                onDragEnd={endDrag}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchLabel({ left, top, tone, title, subtitle }: { left: number; top: number; tone: Tone; title: string; subtitle: string }) {
  const t = toneClasses[tone];
  return (
    <div className={`absolute rounded-md border ${t.border} ${t.bg} px-3 py-2 shadow-sm`} style={{ left, top }}>
      <p className={`text-xs font-black uppercase ${t.text}`}>{title}</p>
      <p className="mt-0.5 text-xs font-semibold text-[#4B5563]">{subtitle}</p>
    </div>
  );
}

function GraphNodeCard({
  node,
  index,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd
}: {
  node: WorkflowGraphNode;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onDragStart: (event: React.PointerEvent<HTMLButtonElement>, node: WorkflowGraphNode) => void;
  onDragMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const t = toneClasses[node.tone];
  const Icon = node.icon;
  return (
    <button
      type="button"
      className={`absolute cursor-move touch-none rounded-md border-2 bg-white p-3 text-left shadow-sm transition hover:shadow-md active:cursor-grabbing ${t.border} ${
        selected ? "ring-2 ring-[#ED1C24] ring-offset-2" : ""
      }`}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: 116 }}
      onClick={() => onSelect(node.id)}
      onPointerDown={(event) => onDragStart(event, node)}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-black text-white ${t.solid}`}>{index + 1}</span>
        <span className={`rounded-md p-1.5 ${t.bg} ${t.text}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <h3 className="mt-3 text-sm font-black leading-5 text-[#111827]">{node.label}</h3>
      <p className="mt-1 text-[10px] font-black uppercase text-[#4B5563]">{node.role}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#4B5563]">{node.summary}</p>
      <span className={`absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white ${t.solid}`} />
      <span className={`absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white ${t.solid}`} />
    </button>
  );
}

function edgeColor(tone: Tone) {
  const colors: Record<Tone, string> = {
    blue: "#2563EB",
    purple: "#9333EA",
    orange: "#F97316",
    yellow: "#F59E0B",
    teal: "#0D9488",
    red: "#ED1C24",
    green: "#16A34A",
    gray: "#64748B",
    pink: "#EC4899"
  };
  return colors[tone];
}

function NodeDetailsPanel({ nodes, selectedNode, onSelect }: { nodes: NodeInfo[]; selectedNode: NodeInfo; onSelect: (id: string) => void }) {
  const Icon = selectedNode.icon;
  const t = toneClasses[selectedNode.tone];
  return (
    <aside className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <SectionHeader eyebrow="Node Details Side Panel" title="Selected node" />
      <div className="mt-4 flex flex-wrap gap-2">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${selectedNode.id === node.id ? "border-[#ED1C24] bg-red-50 text-[#ED1C24]" : "border-[#E5E7EB] text-[#4B5563] hover:bg-gray-50"}`}
            onClick={() => onSelect(node.id)}
          >
            {node.label}
          </button>
        ))}
      </div>
      <div className={`mt-4 rounded-md border ${t.border} ${t.bg} p-4`}>
        <div className="flex items-center gap-3">
          <span className={`rounded-md p-2 text-white ${t.solid}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-black uppercase text-[#4B5563]">Node</p>
            <h3 className="text-lg font-black text-[#111827]">{selectedNode.label}</h3>
          </div>
        </div>
        <dl className="mt-4 space-y-3 text-sm">
          <Detail label="Type" value={selectedNode.type} />
          <Detail label="Responsible role" value={selectedNode.role} />
          <Detail label="Allowed actions" value={selectedNode.actions.join(", ")} />
          <Detail label="Next step on approve" value={selectedNode.next} />
          <Detail label="Reject path" value={selectedNode.reject} />
          <Detail label="Clarification path" value={selectedNode.clarification} />
          <Detail label="Notification" value={selectedNode.notification} />
          <Detail label="Audit" value={selectedNode.audit} />
        </dl>
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase text-[#4B5563]">{label}</dt>
      <dd className="mt-1 font-semibold leading-5 text-[#111827]">{value}</dd>
    </div>
  );
}

function EdgeListTable({ title, edges, tone }: { title: string; edges: string[][]; tone: Tone }) {
  const t = toneClasses[tone];
  return (
    <div className={`rounded-md border ${t.border} bg-white`}>
      <div className={`border-b ${t.border} ${t.bg} px-4 py-3`}>
        <h3 className="text-sm font-black text-[#111827]">{title}</h3>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-[#4B5563]">
            <tr>
              <th className="border-b border-[#E5E7EB] px-4 py-2">From</th>
              <th className="border-b border-[#E5E7EB] px-4 py-2">To</th>
            </tr>
          </thead>
          <tbody>
            {edges.map(([from, to], index) => (
              <tr key={`${title}-${from}-${to}-${index}`}>
                <td className="border-b border-[#F1F5F9] px-4 py-2 font-mono text-xs text-[#111827]">{from}</td>
                <td className="border-b border-[#F1F5F9] px-4 py-2 font-mono text-xs text-[#4B5563]">{to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

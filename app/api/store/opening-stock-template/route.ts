import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { getCurrentUserContext } from "@/lib/auth/context";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";

const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: "Material Name",     key: "material_name", width: 28 },
  { header: "Category",          key: "category",      width: 22 },
  { header: "Part Number",       key: "part_number",   width: 18 },
  { header: "SS Rec. Code",      key: "ss_rec_code",   width: 16 },
  { header: "Opening Quantity",  key: "quantity",       width: 16 },
  { header: "Unit",              key: "unit",           width: 10 },
  { header: "Location / Bin",    key: "location",       width: 18 },
  { header: "Remarks",           key: "remarks",        width: 24 },
];

const EXAMPLE_ROW = {
  material_name: "Hydraulic Hose 12 mm",
  category:      "Mechanical Materials",
  part_number:   "HH-12MM",
  ss_rec_code:   "",
  quantity:      10,
  unit:          "PCS",
  location:      "Shelf A3",
  remarks:       "Existing stock before system go-live",
};

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return new NextResponse("Unauthorized", { status: 401 });
  const canImport = canManageOfflineInventory(context);
  if (!canImport) return new NextResponse("Forbidden", { status: 403 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RECAFCO Maintenance Management System";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Opening Stock", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = COLUMNS;
  worksheet.addRow(EXAMPLE_ROW);

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="recafco-opening-stock-template.xlsx"',
    },
  });
}

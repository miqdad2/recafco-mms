import ExcelJS from "exceljs";

type WorkbookOptions = {
  sheetName: string;
  rows: Array<Record<string, unknown>>;
  emptyMessage?: string;
};

const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF111827" } };
const headerFont = { color: { argb: "FFFFFFFF" }, bold: true };
const border = {
  top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  right: { style: "thin" as const, color: { argb: "FFE5E7EB" } }
};

export async function createExcelWorkbookBuffer({ sheetName, rows, emptyMessage = "No records found for this export." }: WorkbookOptions) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RECAFCO Maintenance Management System";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(safeSheetName(sheetName), {
    views: [{ state: "frozen", ySplit: 1 }]
  });

  const columns = rows.length ? [...new Set(rows.flatMap((row) => Object.keys(row)))] : ["message"];
  worksheet.columns = columns.map((key) => ({
    key,
    header: labelFor(key),
    width: widthFor(key, rows)
  }));

  if (rows.length) {
    rows.forEach((row) => worksheet.addRow(Object.fromEntries(columns.map((key) => [key, normalizeCellValue(row[key])]))));
  } else {
    worksheet.addRow({ message: emptyMessage });
  }

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = border;
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.border = border;
      cell.alignment = { vertical: "top", wrapText: true };
      if (typeof cell.value === "number") {
        cell.numFmt = "#,##0.000";
      }
    });
  });

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  };

  return workbook.xlsx.writeBuffer();
}

function safeSheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "RECAFCO Export";
}

function labelFor(key: string) {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace("Km", "KM")
    .replace("Wo", "WO")
    .replace("Ss", "SS");
}

function widthFor(key: string, rows: Array<Record<string, unknown>>) {
  const longest = Math.max(labelFor(key).length, ...rows.slice(0, 100).map((row) => String(normalizeCellValue(row[key]) ?? "").length));
  return Math.min(Math.max(longest + 4, 14), 42);
}

function normalizeCellValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

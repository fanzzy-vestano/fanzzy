/** Build a real Excel workbook while preserving report values as literal cells. */
export async function createReportWorkbook(headers: string[], rows: unknown[][]): Promise<Blob> {
  // Load the workbook writer only when an administrator exports a report.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row.map((value) => {
      if (value === null || value === undefined) return "";
      return typeof value === "number" || typeof value === "boolean" ? value : String(value);
    }));
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column, index) => {
    column.width = Math.min(45, Math.max(16, headers[index].length + 2));
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

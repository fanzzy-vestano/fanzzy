import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import ts from "typescript";

const source = await readFile(new URL("../lib/report-workbook.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace('import("exceljs")', `import(${JSON.stringify(import.meta.resolve("exceljs"))})`);
const { createReportWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("report export is a readable XLSX workbook with intact values and cell types", async () => {
  const headers = ["product", "sku", "units_sold", "gross_sales", "note"];
  const rows = [
    ['Necklace, "Gold"\nதமிழ்', "00123", 2, "₹1,250.50", "=1+1"],
    ["Bracelet", "00001", 0, "₹0", null],
  ];
  const blob = await createReportWorkbook(headers, rows);
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const buffer = Buffer.from(await blob.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Report");
  assert.deepEqual(sheet.getRow(1).values.slice(1), headers);
  assert.deepEqual(sheet.getRow(2).values.slice(1), rows[0]);
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("C2").type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell("E2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("E3").value, "");
});

test("reports with no matching data still export a workbook with headers", async () => {
  const blob = await createReportWorkbook(["order_id", "total"], []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()));
  const sheet = workbook.getWorksheet("Report");
  assert.equal(sheet.rowCount, 1);
  assert.deepEqual(sheet.getRow(1).values.slice(1), ["order_id", "total"]);
});

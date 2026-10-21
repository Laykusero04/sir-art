import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";

export type ReportDataset = {
  title: string;
  header: {
    school: string;
    year: string;
    period: string;
    generated_at: string;
    generated_by: string;
    scope: string;
  };
  columns: string[];
  rows: string[][];
};

function headerLines(report: ReportDataset) {
  const h = report.header;
  return [
    report.title,
    h.school,
    `School year: ${h.year}`,
    `Grading period: ${h.period}`,
    `Scope: ${h.scope}`,
    `Generated: ${h.generated_at} by ${h.generated_by}`,
  ];
}

export function downloadExcel(report: ReportDataset) {
  const sheet = XLSX.utils.aoa_to_sheet([...headerLines(report).map((line) => [line]), [], report.columns, ...report.rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");
  XLSX.writeFile(book, `${report.title}.xlsx`);
}

export async function downloadPdf(report: ReportDataset) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 40;
  const lineHeight = 14;
  let page = pdf.addPage([842, 595]);
  let y = 555;

  function ensure(space = lineHeight) {
    if (y < margin + space) {
      page = pdf.addPage([842, 595]);
      y = 555;
    }
  }

  for (const line of headerLines(report)) {
    ensure();
    page.drawText(line, { x: margin, y, size: line === report.title ? 16 : 10, font: line === report.title ? bold : font, color: rgb(0.11, 0.14, 0.19) });
    y -= line === report.title ? 22 : lineHeight;
  }
  y -= 8;
  ensure();
  page.drawText(report.columns.join("  |  "), { x: margin, y, size: 9, font: bold });
  y -= lineHeight;
  if (report.rows.length === 0) {
    page.drawText("No rows for this filter.", { x: margin, y, size: 10, font });
  }
  for (const row of report.rows) {
    ensure();
    const text = row.join("  |  ").slice(0, 180);
    page.drawText(text, { x: margin, y, size: 9, font });
    y -= lineHeight;
  }

  const bytes = await pdf.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.title}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

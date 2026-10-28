import Papa from "papaparse";
import type { Field, Role, Source } from "./types";

export const MAX_ROWS = 20000;
const aliases: Record<Field, string[]> = {
  id: [
    "学号",
    "学生编号",
    "人员编号",
    "人员标识",
    "id",
    "studentid",
    "student_id",
  ],
  channel: ["报名渠道", "渠道", "来源", "channel"],
  grade: ["年级", "grade"],
  time: ["签到时间", "时间", "timestamp", "time"],
  rating: ["满意度", "满意度评分", "评分", "rating", "score"],
};
export function suggestMapping(headers: string[]): Source["mapping"] {
  return Object.fromEntries(
    Object.entries(aliases).flatMap(([key, words]) => {
      const found = headers.find((h) =>
        words.includes(h.toLowerCase().replace(/\s/g, "")),
      );
      return found ? [[key, found]] : [];
    }),
  );
}
export async function readSpreadsheet(
  file: File,
  role: Role,
): Promise<Source[]> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error("文件超过 10 MB，请按活动拆分后上传。");
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const matrices: { sheet: string; data: string[][]; warnings: string[] }[] =
    [];
  if (/\.csv$/i.test(file.name)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(
        "CSV 编码不是 UTF-8，请在表格软件中另存为 CSV UTF-8 后上传。",
      );
    }
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    if (parsed.errors.some((e) => e.code !== "UndetectableDelimiter"))
      throw new Error(`CSV 格式错误：${parsed.errors[0].message}`);
    matrices.push({ sheet: "CSV", data: parsed.data, warnings: [] });
  } else if (/\.xlsx$/i.test(file.name)) {
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    await wb.xlsx.load(bytes);
    wb.eachSheet((sheet) => {
      if (sheet.rowCount > MAX_ROWS + 1)
        throw new Error(
          `工作表 ${sheet.name} 超过首版 ${MAX_ROWS} 行上限。该上限是保护限制，性能仍需实测。`,
        );
      const warnings: string[] = [];
      if (sheet.columnCount > 100) throw new Error("单表最多支持 100 列。");
      const data: string[][] = [];
      for (let n = 1; n <= sheet.rowCount; n++) {
        const row = sheet.getRow(n);
        data.push(
          Array.from({ length: sheet.columnCount }, (_, c) => {
            const cell = row.getCell(c + 1);
            if (cell.type === 6)
              warnings.push(
                "包含公式单元格：读取缓存结果，请确认原文件已重新计算。",
              );
            return cell.text ?? "";
          }),
        );
      }
      if (data.length)
        matrices.push({
          sheet: sheet.name,
          data,
          warnings: [...new Set(warnings)],
        });
    });
  } else throw new Error("仅支持 UTF-8 CSV 与 XLSX 文件。");
  if (!matrices.length) throw new Error("文件中没有可读取的工作表。");
  return matrices.map(({ sheet, data, warnings }) => {
    const headerIndex = data.findIndex((row) =>
      row.some((cell) => cell.trim()),
    );
    if (headerIndex < 0) throw new Error(`工作表 ${sheet} 为空。`);
    const headers = data[headerIndex].map((h) => h.trim());
    if (
      headers.some((h) => h.length > 500) ||
      data.some((row) => row.some((cell) => cell.length > 10000))
    )
      throw new Error(
        "表头最多 500 字符，单元格最多 10,000 字符；请拆分过长文本后上传。",
      );
    if (
      headers.length > 100 ||
      headers.some((h) => !h) ||
      new Set(headers).size !== headers.length
    )
      throw new Error(
        `${sheet} 的表头存在空白、重复名称或超过 100 列，请修正后上传。`,
      );
    if (
      data
        .slice(headerIndex + 1)
        .some(
          (r) =>
            r.length > headers.length &&
            r.slice(headers.length).some((v) => v.trim()),
        )
    )
      throw new Error(
        `${sheet} 存在超出表头范围的列，请修正后上传，避免静默丢失数据。`,
      );
    const rows = data
      .slice(headerIndex + 1)
      .map((r, i) => ({
        rowNumber: i + headerIndex + 2,
        values: Object.fromEntries(
          headers.map((h, c) => [h, r[c]?.trim() ?? ""]),
        ),
      }))
      .filter((r) => Object.values(r.values).some(Boolean));
    if (rows.length > MAX_ROWS)
      throw new Error(`单表超过 ${MAX_ROWS} 行，请拆分后上传。`);
    return {
      id: `${hash}:${sheet}:${role}`,
      name: file.name,
      sheet,
      hash,
      role,
      headers,
      rows,
      mapping: suggestMapping(headers),
      confirmed: false,
      warnings,
    };
  });
}
export function download(
  name: string,
  content: string,
  type = "application/json;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadSources(sources: Source[]) {
  for (const source of sources)
    download(
      source.name.replace(/\.xlsx$/i, ".csv"),
      "\uFEFF" +
        Papa.unparse(
          source.rows.map((r) => r.values),
          { escapeFormulae: true },
        ),
      "text/csv;charset=utf-8",
    );
}

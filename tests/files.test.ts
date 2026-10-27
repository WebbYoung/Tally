import { describe, it, expect } from "vitest";
import { Workbook } from "exceljs";
import Papa from "papaparse";
import { readSpreadsheet, suggestMapping } from "../src/domain/files";
import { demoProject } from "../src/domain/demo";
import { reconcile } from "../src/domain/engine";

describe("本地文件解析", () => {
  it("UTF-8 BOM、前导零、空白行和引号不会破坏原始行号", async () => {
    const [s] = await readSpreadsheet(
      new File(
        ['\uFEFF学号,报名渠道\r\n00123,"社团,公众号"\r\n\r\n00456,班级群'],
        "r.csv",
      ),
      "registration",
    );
    expect(s.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
    expect(s.rows[0].values["学号"]).toBe("00123");
    expect(s.rows[0].values["报名渠道"]).toBe("社团,公众号");
    expect(s.confirmed).toBe(false);
  });
  it("拒绝重复表头、无表头的额外列和非 UTF-8 字节", async () => {
    await expect(
      readSpreadsheet(new File(["学号,学号\n1,2"], "r.csv"), "registration"),
    ).rejects.toThrow("表头");
    await expect(
      readSpreadsheet(
        new File(["学号,渠道\n1,群,extra"], "r.csv"),
        "registration",
      ),
    ).rejects.toThrow("超出");
    await expect(
      readSpreadsheet(
        new File([new Uint8Array([0xff, 0xfe, 0x61])], "r.csv"),
        "registration",
      ),
    ).rejects.toThrow("UTF-8");
  });
  it("XLSX 多工作表、文本标识与公式缓存提示", async () => {
    const wb = new Workbook();
    const a = wb.addWorksheet("报名");
    a.addRow(["学号", "年级"]);
    a.addRow(["001", "大三"]);
    const b = wb.addWorksheet("反馈");
    b.addRow(["学号", "评分"]);
    b.addRow(["001", { formula: "2+2", result: 4 }]);
    const bytes = await wb.xlsx.writeBuffer();
    const sheets = await readSpreadsheet(
      new File([new Uint8Array(bytes)], "book.xlsx"),
      "registration",
    );
    expect(sheets.map((s) => s.sheet)).toEqual(["报名", "反馈"]);
    expect(sheets[0].rows[0].values["学号"]).toBe("001");
    expect(sheets[1].warnings[0]).toContain("缓存");
    expect(sheets[1].rows[0].values["评分"]).toBe("4");
  });
  it("下载后的示例 CSV 与声明的源文件哈希完全一致", async () => {
    const p = await demoProject();
    for (const s of p.sources) {
      const content =
        "\uFEFF" +
        Papa.unparse(
          s.rows.map((r) => r.values),
          { escapeFormulae: true },
        );
      const [parsed] = await readSpreadsheet(
        new File([content], s.name),
        s.role,
      );
      expect(parsed.hash).toBe(s.hash);
      expect(parsed.rows).toEqual(s.rows);
    }
  });
  it("本地别名映射不把姓名推测为人员标识", () => {
    expect(suggestMapping(["姓名", "学号", "报名渠道"])).toEqual({
      id: "学号",
      channel: "报名渠道",
    });
    expect(suggestMapping(["姓名"]).id).toBeUndefined();
  });
  it("修正文件重新导入后产生新的哈希与统计，原对象保留", async () => {
    const p = await demoProject();
    const old = reconcile(p);
    const source = p.sources[1];
    const rows = source.rows.filter((r) => r.values["学生编号"] !== "S0001");
    const [updated] = await readSpreadsheet(
      new File([Papa.unparse(rows.map((r) => r.values))], source.name),
      "attendance",
    );
    updated.confirmed = true;
    p.sources[1] = updated;
    expect(updated.hash).not.toBe(source.hash);
    expect(reconcile(p).metrics.attendanceRate.numerator).toBe(179);
    expect(old.metrics.attendanceRate.numerator).toBe(180);
  });
});

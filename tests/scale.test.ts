import { describe, it, expect } from "vitest";
import { demoProject } from "../src/domain/demo";
import { compareRows, executePlan, reconcile } from "../src/domain/engine";
describe("20,000 行确定性规模检查", () => {
  it("两万报名、两万签到、万份反馈仍保持指标与分组正确", async () => {
    const p = await demoProject();
    p.sources[0].rows = Array.from({ length: 20000 }, (_, i) => ({
      rowNumber: i + 2,
      values: { 学号: "P" + i, 报名渠道: "渠道" + (i % 10), 年级: "大三" },
    }));
    p.sources[1].rows = Array.from({ length: 20000 }, (_, i) => ({
      rowNumber: i + 2,
      values: { 学生编号: "P" + (i % 10000), 签到时间: "14:00" },
    }));
    p.sources[2].rows = Array.from({ length: 10000 }, (_, i) => ({
      rowNumber: i + 2,
      values: { 学号: "P" + i, 满意度: "4" },
    }));
    const start = performance.now();
    const result = reconcile(p);
    const groups = executePlan(
      {
        metric: "attendanceRate",
        groupBy: "channel",
        order: "desc",
        title: "scale",
      },
      result,
      p,
    );
    const elapsed = performance.now() - start;
    expect(result.metrics.attendanceRate.value).toBe(50);
    expect(result.metrics.duplicates.value).toBe(10000);
    expect(groups).toHaveLength(10);
    expect(groups.every((r) => r.value === 50)).toBe(true);
    console.info(
      "SCALE Node计算毫秒=" +
        elapsed.toFixed(1) +
        "，输入行数=50000（不是浏览器性能承诺）",
    );
  });
  it("同一个人重复两万次不复制累加数组", async () => {
    const p = await demoProject();
    p.sources[1].rows = Array.from({ length: 20000 }, (_, i) => ({
      rowNumber: i + 2,
      values: { 学生编号: "S0001", 签到时间: "14:00" },
    }));
    const result = reconcile(p);
    expect(result.metrics.attended.value).toBe(1);
    expect(result.metrics.duplicates.value).toBe(19999);
    const changed = structuredClone(p);
    changed.sources[1].rows[19999].values["签到时间"] = "15:00";
    const difference = compareRows(p, changed);
    expect(difference).toHaveLength(1);
  });
});

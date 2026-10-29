import { it, expect } from "vitest";
import { refsHtml, reportHtml } from "../src/domain/report";
import { demoProject } from "../src/domain/demo";
import {
  reconcile,
  identityFingerprint,
  executePlan,
} from "../src/domain/engine";
import { ENGINE_VERSION, type Ref, type Snapshot } from "../src/domain/types";
it("行号范围可无损展开，不合并同名的不同来源", () => {
  const ref = (row: number, sourceId = "a"): Ref => ({
    row,
    sourceId,
    file: "报名.csv",
    sheet: "数据",
    key: `${sourceId}:${row}`,
  });
  const html = refsHtml([ref(5), ref(2), ref(3), ref(3), ref(7), ref(2, "b")]);
  expect(html).toContain("[a] 第 2–3、5、7 行（4 条）");
  expect(html).toContain("[b] 第 2 行（1 条）");
  const large = refsHtml(Array.from({ length: 20000 }, (_, i) => ref(i + 2)));
  expect(large).toContain("2–20001 行（20000 条）");
  expect(large.length).toBeLessThan(100);
  const interleaved = refsHtml(
    Array.from({ length: 2000 }, (_, i) => ref(2 + i * 10)),
  );
  expect(interleaved).toContain("2–19992（间隔 10） 行（2000 条）");
  expect(interleaved.length).toBeLessThan(100);
  expect(refsHtml([ref(2), ref(12), ref(23), ref(33)])).toContain(
    "第 2、12、23、33 行（4 条）",
  );
});
it("导出图表、口径和哈希，用户自由文本只作为转义文本", async () => {
  const project = await demoProject();
  project.name = '<script>alert("x")</script>';
  const s: Snapshot = {
    id: "s1",
    label: "v1",
    createdAt: "2026-10-28",
    project,
    result: reconcile(project),
    fingerprint: await identityFingerprint(project),
    engineVersion: ENGINE_VERSION,
  };
  const plan = {
    metric: "attendanceRate",
    groupBy: "channel",
    order: "desc",
    title: "渠道分析",
  } as const;
  const html = reportHtml(s, [
    {
      id: "a",
      snapshotId: s.id,
      createdAt: s.createdAt,
      plan,
      rows: executePlan(plan, s.result, project),
    },
  ]);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain('class="bar"');
  expect(html).toContain("满意度有效区间：1–5");
  expect(html).toContain("本版本统一口径卡");
  for (const source of project.sources) {
    expect(html).toContain(source.hash);
    expect(html).toContain(source.id);
  }
  expect(html).toContain("86.7");
});

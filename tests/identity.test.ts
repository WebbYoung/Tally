import { it, expect } from "vitest";
import { demoProject } from "../src/domain/demo";
import { reconcile, executePlan } from "../src/domain/engine";
it("真实人员编号带 anonymous 前缀时仍可做人员分层", async () => {
  const p = await demoProject();
  for (const s of p.sources)
    for (const row of s.rows) {
      const id = s.mapping.id!;
      if (row.values[id] === "S0001") row.values[id] = "anonymous:real-person";
    }
  const r = reconcile(p);
  const rows = executePlan(
    {
      metric: "satisfaction",
      groupBy: "channel",
      order: "desc",
      title: "评分",
    },
    r,
    p,
  );
  expect(rows).toHaveLength(4);
  expect(r.metrics.feedbackRate.value).toBe(50);
});
it("匿名行不会与恰好等于内部标记的真实编号合并", async () => {
  const p = await demoProject();
  const feedback = p.sources[2];
  const syntheticId = `anonymous:${feedback.id}:${feedback.rows[0].rowNumber}`;
  feedback.rows[0].values[feedback.mapping.id!] = "";
  feedback.rows[1].values[feedback.mapping.id!] = syntheticId;
  const r = reconcile(p);
  expect(r.feedback).toHaveLength(90);
  expect(
    r.issues.some(
      (i) =>
        i.kind === "unmatchedFeedback" &&
        i.refs.some((ref) => ref.row === feedback.rows[1].rowNumber),
    ),
  ).toBe(true);
  expect(r.metrics.feedbackRate.value).toBeNull();
});

import { describe, it, expect } from "vitest";
import { demoProject } from "../src/domain/demo";
import {
  reconcile,
  checkClaim,
  claimsFor,
  metricDependencyChanges,
  mappingError,
  executePlan,
  identityFingerprint,
} from "../src/domain/engine";
import {
  ENGINE_VERSION,
  type Project,
  type Snapshot,
} from "../src/domain/types";
async function snap(p: Project): Promise<Snapshot> {
  return {
    id: crypto.randomUUID(),
    createdAt: "2026-10-27",
    label: "v",
    project: p,
    result: reconcile(p),
    fingerprint: await identityFingerprint(p),
    engineVersion: ENGINE_VERSION,
  };
}
describe("指标依赖精确到所需表格与口径", () => {
  it("只改问卷发放范围，不让报名、到场和满意度结论失效", async () => {
    const p = await demoProject(),
      a = await snap(structuredClone(p));
    p.policy.invitations = "allAttendees";
    p.policy.version++;
    const b = await snap(p);
    for (const key of [
      "registered",
      "attended",
      "attendanceRate",
      "satisfaction",
    ] as const)
      expect(metricDependencyChanges(key, a, b)).toEqual([]);
    expect(metricDependencyChanges("feedbackRate", a, b)).toContain(
      "该指标的统计口径或排除记录变化",
    );
  });
  it("签到修正只影响依赖签到的结论", async () => {
    const p = await demoProject(),
      a = await snap(structuredClone(p));
    p.sources[1].rows.pop();
    p.sources[1].hash = "changed";
    const b = await snap(p);
    expect(checkClaim(claimsFor(a)[0], a, b).stale).toBe(false);
    expect(metricDependencyChanges("duplicates", a, b).join()).toContain(
      "签到表",
    );
  });
  it("修改活动名称不改变事实，修改量表只要求满意度重核", async () => {
    const p = await demoProject(),
      a = await snap(structuredClone(p));
    p.name = "新名称";
    p.policy.ratingMax = 10;
    p.policy.version++;
    const b = await snap(p);
    expect(metricDependencyChanges("registered", a, b)).toEqual([]);
    expect(metricDependencyChanges("feedbackRate", a, b)).toEqual([]);
    expect(
      metricDependencyChanges("satisfaction", a, b).length,
    ).toBeGreaterThan(0);
  });
  it("无效映射不能仅凭 confirmed 标记通过", async () => {
    const p = await demoProject();
    p.sources[0].mapping.grade = "学号";
    expect(mappingError(p.sources[0])).toContain("多个");
    expect(reconcile(p).ready).toBe(false);
    p.sources[0].mapping.grade = "不存在";
    expect(mappingError(p.sources[0])).toContain("不存在");
  });
  it("异常分组基数不会生成几万个图形", async () => {
    const p = await demoProject();
    p.sources[0].rows.forEach((r, i) => (r.values["报名渠道"] = "渠道" + i));
    expect(() =>
      executePlan(
        {
          metric: "registered",
          groupBy: "channel",
          order: "desc",
          title: "test",
        },
        reconcile(p),
        p,
      ),
    ).toThrow("200");
  });
});

import { describe, expect, it } from "vitest";
import { runAgent } from "../src/domain/agent";
import type { ModelClient, ModelReply } from "../src/domain/model";
import { demoProject } from "../src/domain/demo";
import { reconcile } from "../src/domain/engine";
import { sanitizeMapping } from "../src/domain/gateway";
import { searchKb } from "../src/domain/kb";

/** 按顺序吐出预设回复的模型替身；用尽后重复最后一条。 */
function fakeModel(replies: unknown[]) {
  let index = 0;
  const model: ModelClient & { calls: number; prompts: string[] } = {
    model: "fake",
    calls: 0,
    prompts: [],
    async complete({ messages }) {
      model.prompts.push(
        messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n"),
      );
      model.calls += 1;
      const reply = replies[Math.min(index, replies.length - 1)];
      index += 1;
      const out: ModelReply = {
        content: "",
        toolName: "plan_analysis",
        toolArgs: reply,
        latencyMs: 1,
        usage: { prompt: 100, completion: 20 },
      };
      return out;
    },
  };
  return model;
}

async function setup() {
  const project = await demoProject();
  const result = reconcile(project);
  return { project, result };
}

const plan = {
  action: "plan" as const,
  reason: "按报名渠道比较到场率",
  citations: [] as string[],
  plan: {
    metric: "attendanceRate" as const,
    groupBy: "channel" as const,
    order: "desc" as const,
    title: "各渠道到场率",
  },
};

describe("Agent 编排", () => {
  it("走完 探查→检索→决策→核验→自检→定稿 并返回可执行计划", async () => {
    const { project, result } = await setup();
    const model = fakeModel([plan]);
    const outcome = await runAgent({
      question: "各报名渠道的到场率是多少？",
      project,
      result,
      model,
    });
    expect(outcome.status).toBe("plan");
    expect(outcome.plan).toEqual(plan.plan);
    expect(outcome.steps.map((s) => s.kind)).toEqual([
      "probe",
      "retrieve",
      "decide",
      "build",
      "verify",
      "commit",
    ]);
    expect(outcome.steps.every((s) => s.status !== "running")).toBe(true);
    expect(outcome.usage.calls).toBe(1);
    expect(outcome.usage.prompt).toBe(100);
    expect(model.calls).toBe(1);
    /* 检索确实在本机做了，且把命中的口径编号喂给了模型/轨迹 */
    expect(outcome.steps[1].citations?.length).toBeGreaterThan(0);
  });

  it("丢弃模型编造的口径编号，只保留检索池内的引用", async () => {
    const { project, result } = await setup();
    const real = searchKb("各报名渠道的到场率是多少？", { k: 3 })[0].entry.id;
    const model = fakeModel([{ ...plan, citations: [real, "K9.9"] }]);
    const outcome = await runAgent({
      question: "各报名渠道的到场率是多少？",
      project,
      result,
      model,
    });
    expect(outcome.status).toBe("plan");
    expect(outcome.droppedCitations).toEqual(["K9.9"]);
    expect(outcome.citations.map((c) => c.id)).toEqual([real]);
  });

  it("模型判定不支持时不生成计划，保留原因与分类", async () => {
    const { project, result } = await setup();
    const model = fakeModel([
      {
        action: "unsupported",
        reason: "现有工具不支持因果推断，需要额外研究设计。",
        citations: [],
        plan: null,
      },
    ]);
    const outcome = await runAgent({
      question: "为什么到场率这么低？",
      project,
      result,
      model,
    });
    expect(outcome.status).toBe("rejected");
    expect(outcome.plan).toBeNull();
    expect(outcome.reason).toContain("因果");
    expect(outcome.steps.at(-1)?.kind).toBe("commit");
    expect(outcome.steps.at(-1)?.status).toBe("skipped");
  });

  it("计划用到不存在的字段时按缺数据拒绝，不编造结果", async () => {
    const { project, result } = await setup();
    /* 去掉反馈表，rating 字段随之消失 */
    const withoutFeedback = {
      ...project,
      sources: project.sources.filter((s) => s.role !== "feedback"),
    };
    const model = fakeModel([
      {
        ...plan,
        plan: {
          metric: "satisfaction",
          groupBy: "none",
          order: "desc",
          title: "总体满意度",
        },
      },
    ]);
    const outcome = await runAgent({
      question: "总体满意度是多少？",
      project: withoutFeedback,
      result: reconcile(withoutFeedback),
      model,
    });
    expect(outcome.status).toBe("rejected");
    expect(outcome.plan).toBeNull();
    expect(outcome.reason).toContain("缺少");
  });

  it("数据未就绪时仍然可以先跑，但计划必须过自检才放行", async () => {
    const { project } = await setup();
    const model = fakeModel([plan]);
    const outcome = await runAgent({
      question: "各报名渠道的到场率是多少？",
      project,
      /* 不传 result：需要数据的工具会报不可用，而不是用假数据凑答案 */
      model,
    });
    expect(["plan", "rejected", "error"]).toContain(outcome.status);
    expect(outcome.steps[0].status).toBe("ok");
    expect(outcome.steps[0].detail).toContain("行");
  });
});

describe("映射护栏", () => {
  const headers = ["姓名", "报名渠道", "年级", "报名时间", "满意度评分"];

  it("拦下把姓名映射成满意度评分", () => {
    const { mapping, warnings } = sanitizeMapping(
      { rating: "姓名", channel: "报名渠道" },
      headers,
    );
    expect(mapping).toEqual({ channel: "报名渠道" });
    expect(warnings[0]).toContain("不是评分列");
  });

  it("拦下把时间列映射成评分", () => {
    const { mapping, warnings } = sanitizeMapping(
      { rating: "报名时间" },
      headers,
    );
    expect(mapping).toEqual({});
    expect(warnings[0]).toContain("不是评分列");
  });

  it("拦下用姓名当唯一标识", () => {
    const { mapping } = sanitizeMapping({ id: "姓名" }, headers);
    expect(mapping).toEqual({});
  });

  it("拦下不存在的表头与一列多用", () => {
    const ghost = sanitizeMapping({ channel: "不存在的列" }, headers);
    expect(ghost.mapping).toEqual({});
    expect(ghost.warnings[0]).toContain("表头不存在");

    const dup = sanitizeMapping(
      { channel: "年级", grade: "年级" },
      headers,
    );
    expect(dup.mapping).toEqual({});
    expect(dup.warnings.at(-1)).toContain("多个字段");
  });

  it("正常映射原样通过", () => {
    const { mapping, warnings } = sanitizeMapping(
      {
        id: undefined as never,
        channel: "报名渠道",
        grade: "年级",
        time: "报名时间",
        rating: "满意度评分",
      },
      headers,
    );
    expect(mapping).toEqual({
      channel: "报名渠道",
      grade: "年级",
      time: "报名时间",
      rating: "满意度评分",
    });
    expect(warnings).toEqual([]);
  });
});

describe("口径知识库检索", () => {
  it("确定、可复现、按相关度排序", () => {
    const a = searchKb("到场率", { k: 3 }).map((h) => h.entry.id);
    const b = searchKb("到场率", { k: 3 }).map((h) => h.entry.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    const scores = searchKb("到场率", { k: 3 }).map((h) => h.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });

  it("kinds 过滤只返回指定类别", () => {
    const hits = searchKb("到场率", { k: 5, kinds: ["boundary"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.entry.kind === "boundary")).toBe(true);
  });

  it("无关问题不硬凑命中", () => {
    expect(searchKb("今天天气怎么样", { k: 3, minScore: 0.35 })).toEqual([]);
  });
});

describe("数据事实注入（防「能算却说算不出」）", () => {
  it("提示词里带上问卷发放范围与口径版本，而不是让模型猜", async () => {
    const { project, result } = await setup();
    const model = fakeModel([plan]);
    await runAgent({ question: "各渠道到场率", project, result, model });
    const prompt = model.prompts[0] ?? "";
    expect(prompt).toContain("问卷发放范围：仅已报名到场者");
    expect(prompt).toContain("口径 v");
    expect(prompt).toContain("报名表「报名名单.csv」300 行");
    expect(prompt).toContain("不得再判定为「未知」");
  });

  it("发放范围确为未知时如实标注未知，供模型给出 missing_data", async () => {
    const { project, result } = await setup();
    const unknown = {
      ...project,
      policy: { ...project.policy, invitations: "unknown" as const },
    };
    const model = fakeModel([plan]);
    await runAgent({
      question: "反馈回收率",
      project: unknown,
      result: reconcile(unknown),
      model,
    });
    expect(model.prompts[0]).toContain("问卷发放范围：未知");
  });
});

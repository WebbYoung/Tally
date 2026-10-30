import type { Field, MetricKey } from "./types";

/**
 * 口径知识库（RAG 的语料层）。
 *
 * 这里的每一条都是**可编辑的知识**，不是代码分支：模型在生成分析计划之前先检索
 * 命中的条目，只会依据检索到的口径作答，并在结论里引用条目编号。
 *
 * 一致性约束：条目正文必须与 `engine.ts` 的实际实现逐字相符。两者冲突时以实现为准，
 * 同时修条目——`tests/kb.test.ts` 里有一组断言守着这条线。
 */

export type KbKind = "metric" | "rule" | "boundary" | "failure" | "version";

export interface KbEntry {
  id: string;
  kind: KbKind;
  title: string;
  /** 适用范围一句话 */
  scope: string;
  /** 口径正文，会被注入 prompt */
  body: string;
  /** 该口径依赖的规范字段 */
  fields: Field[];
  tags: string[];
  version: string;
  /** 常见误算，答辩与自检用 */
  cautions: string[];
  metric?: MetricKey;
}

export const KB_VERSION = "1.0.0";

const V = KB_VERSION;

export const KB_ENTRIES: KbEntry[] = [
  {
    id: "KB-M1",
    kind: "metric",
    title: "有效报名人数（M1）",
    scope: "报名表",
    body: "对报名表中的人员标识做规范化后去重计数。同一标识出现多条记录时按口径保留首条或末条，保留顺序以文件原始行序为准。人员标识缺失的行不进入有效报名集合，进入待核对。",
    fields: ["id"],
    tags: ["报名", "人数", "去重", "M1"],
    version: V,
    cautions: ["不能按行数统计，否则重复报名会被算两次。"],
    metric: "registered",
  },
  {
    id: "KB-M2",
    kind: "metric",
    title: "总到场人数（M2）",
    scope: "签到表",
    body: "对签到表中的人员标识去重计数，**包含未报名的到场者**。因此总到场人数可以大于有效报名人数，这不是数据错误。",
    fields: ["id"],
    tags: ["到场", "签到", "人数", "M2"],
    version: V,
    cautions: [
      "把 M2 直接当分子去算到场率会得到偏高的结果，因为分子里混入了未报名者。",
    ],
    metric: "attended",
  },
  {
    id: "KB-M3",
    kind: "metric",
    title: "已报名人员到场率（M3）",
    scope: "报名表 + 签到表",
    body: "已报名且到场的人数 ÷ 有效报名人数 × 100%。分子只包含同时出现在有效报名集合与有效到场集合中的人，**不包含未报名到场者**。分母是 M1，不是 M2。",
    fields: ["id"],
    tags: ["到场率", "报名", "签到", "M3", "比例"],
    version: V,
    cautions: [
      "最常见的错误是用 M2 ÷ M1，会把未报名到场者算进分子，到场率虚高。",
      "分母为零时结果为无法计算，不能显示 0%。",
    ],
    metric: "attendanceRate",
  },
  {
    id: "KB-M4",
    kind: "metric",
    title: "重复签到记录数（M4）",
    scope: "签到表",
    body: "同一文件、同一场次内，同一人员标识的额外记录条数，不包含按口径保留的首条或末条。**整个文件被重复导入属于导入问题，在导入阶段拦截，不计入 M4**；跨文件出现的同一人员也不计入 M4，而是标记为跨文件重叠，必须先人工核对。",
    fields: ["id"],
    tags: ["重复", "签到", "记录", "M4"],
    version: V,
    cautions: [
      "把重复上传的整份文件算进重复签到，会得出夸张的数字。",
      "跨文件同人应先确认是重复导出还是多次参加，不能自动去重。",
    ],
    metric: "duplicates",
  },
  {
    id: "KB-M5",
    kind: "metric",
    title: "未报名到场人数（M5）",
    scope: "报名表 + 签到表",
    body: "有效到场人员集合减去有效报名人员集合。这些人的标识是确认过的，只是没有出现在报名表里。标识缺失或无法确认的签到记录属于待核对，不能自动算作未报名人员。",
    fields: ["id"],
    tags: ["未报名", "到场", "walk-in", "M5"],
    version: V,
    cautions: ["把身份待核对的记录直接算进 M5，会虚增未报名人数。"],
    metric: "walkIns",
  },
  {
    id: "KB-M6",
    kind: "metric",
    title: "反馈回收率（M6-a）",
    scope: "签到表 + 反馈表 + 问卷发放范围",
    body: "受邀到场者中提交有效反馈的人数 ÷ 受邀到场人数 × 100%。分母不是 M2：问卷只发给报名者时，用 M2 当分母会低估回收率。必须先确认问卷实际发放范围（全部到场者／仅已报名到场者／自定义名单）。发放范围为未知时，回收率为无法计算。",
    fields: ["id"],
    tags: ["反馈", "回收率", "问卷", "M6", "比例"],
    version: V,
    cautions: [
      "用 M2 当分母会在问卷只发报名者时低估回收率。",
      "存在匿名反馈时无法验证一人一份，回收率同样置为无法计算。",
    ],
    metric: "feedbackRate",
  },
  {
    id: "KB-M7",
    kind: "metric",
    title: "平均满意度（M6-b）",
    scope: "反馈表",
    body: "有效评分之和 ÷ 有效评分数量。缺失回答与超出量表的评分不按零分处理，直接不进入均值。量表范围由口径设定，默认 1—5 分。存在匿名反馈时，按全部有效反馈计算总体平均分，此时结果代表反馈总体而非到场人群。",
    fields: ["rating"],
    tags: ["满意度", "评分", "均值", "M6"],
    version: V,
    cautions: [
      "把空值当 0 分计算会把均值拉低，这是满意度统计中最常见的错误。",
      "匿名反馈存在时，平均分不能解释为到场人群的满意度。",
    ],
    metric: "satisfaction",
  },
  {
    id: "KB-R1",
    kind: "rule",
    title: "去重保留规则",
    scope: "全部表格",
    body: "同一人员标识出现多条记录时，可在口径中设定保留首条或末条，以文件原始行序为准。该选择会改变人数类指标，因此必须写入版本快照，并在报告中标注。",
    fields: ["id"],
    tags: ["去重", "口径", "首条", "末条"],
    version: V,
    cautions: ["改去重方向后旧结论会失效，不能沿用旧结果。"],
  },
  {
    id: "KB-R2",
    kind: "rule",
    title: "人员标识规范化",
    scope: "全部表格",
    body: "人员标识在匹配前统一做 Unicode NFKC 归一化并去除首尾空白。这能消除全角半角、全角空格等差异。除此之外不做模糊匹配，不做相似度猜测。",
    fields: ["id"],
    tags: ["标识", "规范化", "匹配"],
    version: V,
    cautions: ["对标识做模糊匹配会把不同的人合并，属于不可逆的静默错误。"],
  },
  {
    id: "KB-R3",
    kind: "rule",
    title: "人员标识缺失进入待核对",
    scope: "全部表格",
    body: "报名表与签到表中缺少人员标识的记录不参与统计，进入待核对，由人工决定排除或修正后重新上传。反馈表是唯一例外：缺少标识时按匿名反馈处理，可参与总体评分，但不能参与回收率与人群分层。",
    fields: ["id"],
    tags: ["缺失", "待核对", "匿名"],
    version: V,
    cautions: ["把缺标识的记录直接算作未报名人员，会同时污染 M3 与 M5。"],
  },
  {
    id: "KB-R4",
    kind: "rule",
    title: "跨文件重叠必须先核对",
    scope: "多表之间",
    body: "同一个人在多个文件中出现（典型是重复导出的签到表）会被标记为跨文件重叠。存在重叠时，当前结果只是暂算结果，必须人工确认排除哪一部分记录后才能保存为版本。",
    fields: ["id"],
    tags: ["重叠", "跨文件", "暂算"],
    version: V,
    cautions: ["系统不会自动判断哪一份是更新后的文件。"],
  },
  {
    id: "KB-R5",
    kind: "rule",
    title: "评分量表范围校验",
    scope: "反馈表",
    body: "评分超出设定量表范围的记录会被标记为无效评分，该评分不计入均值，但该条反馈的其他信息仍可用于回收率计数。量表范围默认 1—5，可在口径中调整。",
    fields: ["rating"],
    tags: ["评分", "量表", "越界", "无效"],
    version: V,
    cautions: ["把 0—10 分的问卷按 1—5 分处理，会把大量有效评分判成越界。"],
  },
  {
    id: "KB-R6",
    kind: "rule",
    title: "分组字段来源",
    scope: "报名表",
    body: "报名渠道与年级只从报名表读取。按渠道或年级分组时，分母只包含能匹配到报名记录的到场者，未报名到场者不进入分组结果。",
    fields: ["channel", "grade"],
    tags: ["分组", "渠道", "年级"],
    version: V,
    cautions: ["用签到表里的渠道列分组，会与报名的口径不一致。"],
  },
  {
    id: "KB-R7",
    kind: "rule",
    title: "分组基数上限",
    scope: "全部分组分析",
    body: "分组结果最多 200 类。超过时判定为字段映射错误（例如把人员标识映射成了渠道），需要先回到映射页修正。",
    fields: ["channel", "grade"],
    tags: ["分组", "上限", "映射"],
    version: V,
    cautions: ["200 类以上通常不是真实分组，而是把标识当成维度用。"],
  },
  {
    id: "KB-R8",
    kind: "rule",
    title: "匿名反馈的影响",
    scope: "反馈表",
    body: "存在匿名反馈时，反馈回收率无法计算（无法验证一人一份），满意度按全部有效反馈计算并标注为总体评分。此时按渠道或年级的反馈分层不可用。",
    fields: ["id", "rating"],
    tags: ["匿名", "回收率", "分层"],
    version: V,
    cautions: ["匿名问卷做人群分层，等于把不同人拼成同一个人。"],
  },
  {
    id: "KB-B1",
    kind: "boundary",
    title: "不做因果判断与预测",
    scope: "提问入口",
    body: "系统可以展示相关数据，但不对原因下结论，也不做未来预测。提问中出现导致、因为、原因、为什么、预测等表述时，只呈现可核验的统计结果，并说明因果判断需要额外的研究设计或对照数据。",
    fields: [],
    tags: ["因果", "预测", "为什么", "原因", "边界"],
    version: V,
    cautions: ["把相关性写成因果，是这类复盘里最容易犯也最致命的错误。"],
  },
  {
    id: "KB-B2",
    kind: "boundary",
    title: "分母为零即无法计算",
    scope: "全部比例指标",
    body: "任何比例指标的分母为零时，结果显示为无法计算，并说明分母为零的原因。不显示 0%，也不做任何替代估算。",
    fields: [],
    tags: ["分母", "为零", "无法计算"],
    version: V,
    cautions: ["显示 0% 会被误读为发生了且一次都没成功。"],
  },
  {
    id: "KB-B3",
    kind: "boundary",
    title: "小样本只描述不推断",
    scope: "分组结果",
    body: "分组结果同时展示样本量与有效回答数。样本量很小时，结果只描述该组实际发生了什么，不外推到整个人群，也不与其他组做显著性判断。",
    fields: [],
    tags: ["样本量", "小样本", "推断", "分组"],
    version: V,
    cautions: ["用个位数样本的组间差异下结论，是复盘报告最常被质疑的地方。"],
  },
  {
    id: "KB-B4",
    kind: "boundary",
    title: "未到场者的满意度不可比较",
    scope: "反馈分析",
    body: "没有参加活动的人通常没有活动体验，满意度也只向到场者收集。因此到场者与未到场者的满意度差异不作为分析对象。若要了解缺席原因，需要单独的缺席问卷，且只描述原因分布。",
    fields: ["rating"],
    tags: ["未到场", "满意度", "缺席", "比较"],
    version: V,
    cautions: ["把没参加活动的人算成低满意度，是典型的伪相关。"],
  },
  {
    id: "KB-B5",
    kind: "boundary",
    title: "不支持时间趋势",
    scope: "提问入口",
    body: "当前版本不支持按时间趋势分析（例如各场次随时间的变化）。这类问题需要明确的时间字段与场次口径，属于后续版本范围。",
    fields: ["time"],
    tags: ["趋势", "时间", "场次", "不支持"],
    version: V,
    cautions: ["把签到时间当活动时间做趋势，会得到无意义的曲线。"],
  },
  {
    id: "KB-F1",
    kind: "failure",
    title: "缺少字段时如何回答",
    scope: "提问失败分类",
    body: "当问题需要的数据字段当前不存在时，说明缺哪个字段、该字段来自哪张表，以及补充后可以回答什么。不给出估算，不用相近字段替代。",
    fields: [],
    tags: ["缺字段", "失败", "提示"],
    version: V,
    cautions: ["用相近字段凑答案，是静默错误的主要来源。"],
  },
  {
    id: "KB-F2",
    kind: "failure",
    title: "超出工具能力时如何回答",
    scope: "提问失败分类",
    body: "当问题超出已实现的统计工具（例如任意条件筛选、自由组合维度、外部数据对比）时，明确说明当前支持哪些分析，不假装完成。",
    fields: [],
    tags: ["不支持", "失败", "能力"],
    version: V,
    cautions: ["含糊其辞比直接说做不到更损伤可信度。"],
  },
  {
    id: "KB-F3",
    kind: "failure",
    title: "问题有歧义时的处理",
    scope: "提问失败分类",
    body: "当问题没有说明指标、分组或统计范围时，先追问澄清，例如确认要的是到场率还是到场人数、按渠道还是按年级。不替用户选择口径。",
    fields: [],
    tags: ["歧义", "澄清", "口径"],
    version: V,
    cautions: ["替用户默认一个口径，事后很难被发现。"],
  },
  {
    id: "KB-V1",
    kind: "version",
    title: "口径版本与旧结论失效",
    scope: "版本管理",
    body: "每次确认处理方案都会形成一个不可变版本，包含源数据哈希、字段映射、核对决定、口径集、分析参数与计算结果。修改口径或数据后，旧版本中依赖相关指标的结论会被标记为失效，并列出受影响的依赖项。",
    fields: [],
    tags: ["版本", "失效", "结论", "快照"],
    version: V,
    cautions: ["只标记失效而不保留旧结果是不可接受的：旧结论必须能原样复现。"],
  },
  {
    id: "KB-V2",
    kind: "version",
    title: "文件哈希能证明什么",
    scope: "溯源附录",
    body: "文件哈希用于核对源文件身份，确认报告引用的确实是同一份文件。哈希本身不能替代原始数据，也不能证明结论正确。报告正文提供可读的计算摘要，完整记录索引作为配套文件导出。",
    fields: [],
    tags: ["哈希", "溯源", "附录", "证明"],
    version: V,
    cautions: ["把哈希说成结论的证明，属于过度声称。"],
  },
];

/* ───────────────────────── 检索：BM25 + 字符 n-gram 双路融合 ───────────────────────── */

/** 中文按单字 + 二元组切分，英文与数字按词切分。 */
export function tokenize(text: string): string[] {
  const norm = text.normalize("NFKC").toLowerCase();
  const out: string[] = [];
  for (const m of norm.matchAll(/[a-z][a-z0-9_-]*|[0-9]+(?:\.[0-9]+)?/g))
    out.push(m[0]);
  for (const m of norm.matchAll(/[\u4e00-\u9fff]+/g)) {
    const s = m[0];
    for (let i = 0; i < s.length; i += 1) out.push(s[i]);
    for (let i = 0; i + 1 < s.length; i += 1) out.push(s.slice(i, i + 2));
  }
  return out;
}

function docText(e: KbEntry) {
  return [e.id, e.title, e.scope, e.body, e.tags.join(" "), e.cautions.join(" ")]
    .join(" ")
    .replace(/\*\*/g, "");
}

interface Indexed {
  entry: KbEntry;
  tf: Map<string, number>;
  len: number;
  grams: Set<string>;
  /** 精确短语：标题与标签里的 3—5 字片段，命中即视为强意图对齐 */
  phrases: string[];
}

/** 从标题与标签提取精确短语。词法检索分不清「渠道」是分组还是指标，短语命中能。 */
function phrasesOf(entry: KbEntry): string[] {
  const out = new Set<string>();
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const title = norm(entry.title.replace(/（[^）]*）/g, ""));
  if (title.length >= 3) out.add(title);
  for (let size = 3; size <= 5; size += 1)
    for (let i = 0; i + size <= title.length; i += 1) {
      const piece = title.slice(i, i + size);
      if (/^[\u4e00-\u9fff]+$/.test(piece)) out.add(piece);
    }
  for (const tag of entry.tags) {
    const t = norm(tag);
    if (t.length >= 3) out.add(t);
  }
  return [...out];
}

/**
 * 字段加权：标题与标签是最强信号，正文次之，注意事项最弱。
 * 没有这层加权，正文冗长的规则条目会压过定义精确的指标条目。
 */
const FIELD_WEIGHT = {
  id: 2,
  title: 3,
  tags: 2,
  scope: 1.5,
  body: 1,
  caution: 0.6,
} as const;

function index(): Indexed[] {
  return KB_ENTRIES.map((entry) => {
    const tf = new Map<string, number>();
    let len = 0;
    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) {
        tf.set(t, (tf.get(t) ?? 0) + weight);
        len += weight;
      }
    };
    add(entry.id, FIELD_WEIGHT.id);
    add(entry.title, FIELD_WEIGHT.title);
    add(entry.tags.join(" "), FIELD_WEIGHT.tags);
    add(entry.scope, FIELD_WEIGHT.scope);
    add(entry.body.replace(/\*\*/g, ""), FIELD_WEIGHT.body);
    add(entry.cautions.join(" "), FIELD_WEIGHT.caution);
    const flat = docText(entry).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    const grams = new Set<string>();
    for (let i = 0; i + 2 < flat.length; i += 1) grams.add(flat.slice(i, i + 3));
    return { entry, tf, len, grams, phrases: phrasesOf(entry) };
  });
}

const INDEX = index();
const AVG_LEN = INDEX.reduce((n, d) => n + d.len, 0) / INDEX.length;

function idf(term: string): number {
  const df = INDEX.filter((d) => d.tf.has(term)).length;
  return Math.log(1 + (INDEX.length - df + 0.5) / (df + 0.5));
}

const IDF_CACHE = new Map<string, number>();
function cachedIdf(term: string) {
  let v = IDF_CACHE.get(term);
  if (v === undefined) {
    v = idf(term);
    IDF_CACHE.set(term, v);
  }
  return v;
}

export interface KbHit {
  entry: KbEntry;
  /** 融合后的归一化相关度，0—1 */
  score: number;
  /** 命中的检索词，供 UI 展示「为什么命中这条」 */
  terms: string[];
}

export interface SearchOptions {
  k?: number;
  kinds?: KbKind[];
  metric?: MetricKey;
  /** 低于该分数视为未命中 */
  minScore?: number;
}

/**
 * 检索口径知识库。
 *
 * 双路召回：BM25（词法，单字降权）+ 字符三元组重叠（近似语义），
 * 归一化后按 0.7 / 0.3 融合。纯本地、确定性、可复现，不依赖外部向量服务。
 */
export function searchKb(query: string, options: SearchOptions = {}): KbHit[] {
  const { k = 4, kinds, metric, minScore = 0.12 } = options;
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length) return [];
  const qFlat = query.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const qGrams = new Set<string>();
  for (let i = 0; i + 2 < qFlat.length; i += 1) qGrams.add(qFlat.slice(i, i + 3));

  const scored = INDEX.map((doc) => {
    // BM25：二元组全权重，单字降权（单字几乎没有区分度）
    let bm = 0;
    for (const t of qTokens) {
      const n = doc.tf.get(t);
      if (!n) continue;
      const weight = t.length === 1 ? 0.35 : 1;
      const norm = 1 - 0.85 + (0.85 * doc.len) / AVG_LEN;
      bm += weight * cachedIdf(t) * ((n * 2.2) / (n + 1.2 * norm));
    }
    // 字符三元组：Jaccard 的加权变体
    let shared = 0;
    for (const g of qGrams) if (doc.grams.has(g)) shared += 1;
    const tri = qGrams.size ? shared / qGrams.size : 0;
    // 精确短语命中：意图对齐的最强信号
    const hitPhrases = doc.phrases.filter((p) => qFlat.includes(p));
    const phrase = hitPhrases.length ? Math.min(1, hitPhrases.length * 0.5) : 0;
    const terms = qTokens.filter((t) => doc.tf.has(t) && t.length > 1).slice(0, 6);
    return { entry: doc.entry, bm, tri, terms, hitPhrases, phrase };
  });

  const maxBm = Math.max(...scored.map((s) => s.bm), 1e-6);
  /*
   * 弱信号降权：既没有多字词命中、也没有短语命中时，只剩字符三元组在撑分。
   * 字符重叠不足以支撑「这条口径适用于该问题」，更不能拿来当引用依据，
   * 所以只允许它贡献极低的分量，避免无关问题被硬凑到一条口径上。
   */
  const hits: KbHit[] = scored
    .map((s) => {
      const lexical = s.terms.length > 0 || s.hitPhrases.length > 0;
      const raw = 0.6 * (s.bm / maxBm) + 0.25 * s.tri + 0.5 * s.phrase;
      return {
        entry: s.entry,
        score: Math.min(1, lexical ? raw : 0.5 * 0.25 * s.tri),
        terms: [
          ...new Set([
            ...s.hitPhrases.filter((p) => p.length > 2),
            ...s.terms,
          ]),
        ].slice(0, 6),
      };
    })
    .filter((h) => h.score >= minScore)
    .filter((h) => !kinds || kinds.includes(h.entry.kind))
    .filter((h) => !metric || !h.entry.metric || h.entry.metric === metric)
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
    .slice(0, k);

  return hits;
}

/** 精确取某指标的必选口径条目（确定性路径，不依赖检索）。 */
export function kbForMetric(metric: MetricKey): KbEntry[] {
  return KB_ENTRIES.filter((e) => e.metric === metric);
}

export function kbGet(id: string): KbEntry | undefined {
  return KB_ENTRIES.find((e) => e.id === id);
}

/** 注入 prompt 用的紧凑引用块。 */
export function kbBrief(hits: KbHit[]): string {
  if (!hits.length) return "";
  return hits
    .map((h) => `[${h.entry.id}] ${h.entry.title}｜${h.entry.body.replace(/\*\*/g, "")}`)
    .join("\n");
}

export interface KbCitation {
  id: string;
  title: string;
  version: string;
  score: number;
  snippet: string;
}

export function toCitation(hit: KbHit): KbCitation {
  const body = hit.entry.body.replace(/\*\*/g, "");
  return {
    id: hit.entry.id,
    title: hit.entry.title,
    version: hit.entry.version,
    score: Math.round(hit.score * 100) / 100,
    snippet: body.length > 90 ? body.slice(0, 90) + "…" : body,
  };
}

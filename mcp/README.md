# Tally MCP 服务

把 Tally 的确定性计算层暴露给任意 MCP 客户端。**不调用模型、不修改数据、不联网。**

## 构建与运行

```bash
npm run mcp:build          # 产出 mcp/dist/server.mjs
npm run mcp                # 直接以 stdio 运行（供客户端拉起，手动跑会等输入）
```

## 客户端配置

```json
{
  "mcpServers": {
    "tally": {
      "command": "node",
      "args": ["/绝对路径/Tally/mcp/dist/server.mjs"]
    }
  }
}
```

## 工具

| 工具 | 依赖已打开的项目 | 说明 |
|---|---|---|
| `open_backup` | — | 载入 App 导出的 `.tally.json`（校验 checksum、指纹、证据引用） |
| `describe_dataset` | 是 | 活动名、源表、字段、版本、当前指标 |
| `list_fields` | 是 | 字段与角色，Agent 决策的起点 |
| `search_policy` | 否 | 口径知识库检索（`KB-M3` 之类条目） |
| `preflight` | 是 | 执行前自检：分母、匿名、发放范围、分组基数 |
| `compute_metric` | 是 | 单指标 + 分子/分母/公式/证据行 |
| `group_by` | 是 | 按渠道或年级分组 |
| `check_claim` | 是 | 核验一条结论的数字与引用 |

## 边界

- 工具层没有一个方法能写入数值，模型只能选择参数。
- 备份文件只读；载入时会重新跑一遍指纹与引用校验，被改过的备份会直接报错。
- 一次只持有一个项目（stdio 单会话），换项目重新 `open_backup`。

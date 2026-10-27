# 开发与提交约定

所有开发使用功能分支，不直接 push 到 `main`，不强制覆盖远端历史。

每完成一个独立功能或修复，执行相关检查，形成可说明的 commit，随后立即 push 当前功能分支，避免长时间仅保留本地提交。

提交格式采用 Conventional Commits，例如：

```text
feat(analysis): add confirmed channel comparison
fix(metrics): exclude invalid ratings from averages
test(import): cover duplicate worksheet uploads
docs: record setup and demo acceptance steps
```

涉及统计、解析、版本或 AI 参数时，补充有意义的回归测试并运行 `npm test`。源码改动运行 `npm run build`；仅文档不要求重复跑全部测试。界面改动应做浏览器实测。

PR 说明用户会看到的行为、验证结果和未验证的边界。通过审阅后再合并，不因测试通过就自行合入 main。

不提交 `.env`、API Key、GitHub Token、真实学生数据或本地浏览器数据库。虚构演示数据应明确标注，不替代真实场景验收。

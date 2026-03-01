# Star Manager

[English README](./README.md)

Star Manager 是一个本地优先（local-first）的 Web 应用，用于整理你的 GitHub Star 仓库与 Star Lists，并支持可选的 LLM 辅助分类。

## 为什么使用 Star Manager

当 Star 仓库数量变多后，手工维护列表效率低且容易不一致。Star Manager 可以帮助你：

- 从 GitHub 同步 Star 仓库与 Star Lists。
- 使用 OpenAI 兼容接口批量分类仓库。
- 在写回前查看变更差异预览。
- 将更新写回 GitHub，并查看进度与失败原因。
- 将工作数据保存在浏览器本地（Dexie + IndexedDB）。

## 核心能力

- GitHub 同步与进度反馈：
  - 拉取 Star 仓库与 Star Lists。
  - 扫描列表成员关系。
  - 失败列表支持重试。
- 分类流程：
  - 两阶段分类（仓库打标 + 标签压缩）。
  - 支持测试模式（小样本）与单标签严格模式。
  - 支持与现有 Star Lists 或历史分类运行结果对比。
- 写回流程：
  - 应用前预览仓库 `Current` 与 `After` 列表差异。
  - 写回时可自动创建缺失列表。
  - 支持“应用前重新规划”开关。
  - 对未 Star 仓库提供确认逻辑。
- 本地编辑：
  - 支持在 UI 中为单个仓库手动调整列表归属。
- 国际化：
  - 支持中英 UI，自动识别浏览器语言，也可手动覆盖。

## 运行前准备

- Node.js 20+（建议 LTS）
- `pnpm`
- GitHub Personal Access Token（PAT）
- 可选：OpenAI 兼容的 LLM 服务端点（用于分类）

## 快速开始

```bash
pnpm install
pnpm dev
```

构建与预览：

```bash
pnpm build
pnpm preview
```

## 配置说明

### 1）GitHub PAT

在应用中：

1. 打开 `Settings` 或 `Connect PAT`。
2. 粘贴 PAT。
3. 校验并保存。

该 PAT 需要能够读取你的 Star 仓库，并具备对应 Star Lists 操作能力。若校验失败，请优先检查 token 权限范围与账号功能可用性。

### 2）LLM（可选）

在 `Settings -> LLM Configuration` 中配置：

- `baseUrl`（默认：`https://api.openai.com/v1`）
- `apiKey`
- `model`（默认：`gpt-4o-mini`）
- `temperature`
- `maxTokens`

可以直接使用默认 Prompt，也可以按需自定义：

- 默认打标模式
- 严格单标签模式
- 基于 Existing Lists 的约束模式
- 中英文 Prompt 变体

## 典型使用流程

1. 连接 PAT。
2. 点击 `Sync Star Lists`。
3. （可选）在状态面板重试失败的列表成员扫描。
4. 打开 `Run Classification` 执行分类。
5. 查看分类预览与差异视图。
6. 打开 `Apply Updates` 查看将写回 GitHub 的变更。
7. 执行写回。

## 项目结构

```text
src/app/
  App.tsx                 # 主界面
  core/                   # 用例与编排逻辑
  services/               # GitHub / LLM 客户端
  data/                   # Dexie 数据层与响应式查询辅助
  store/                  # 偏好设置与 LLM 配置存储
  ui/                     # UI 组件与弹窗
  i18n/                   # 国际化资源与语言处理
  styles/                 # 样式文件
```

## 数据与隐私

- 本地优先存储：
  - 应用数据保存在浏览器 IndexedDB（数据库名：`star-manager`）。
  - 偏好设置与 LLM 配置保存在浏览器 localStorage。
- PAT 与 LLM API Key 存储在本地浏览器环境中。
- 应用直接从前端调用 GitHub 与你配置的 LLM 服务。
- 请避免导出或分享包含敏感字段的浏览器存储数据。

## 常见问题排查

- `Star Lists API not available for this token/account`
  - 当前账号或 token 可能无法访问 Star Lists 的 GraphQL 字段。
- PAT 校验失败
  - 请检查 token 内容、权限范围，必要时重新生成。
- LLM 测试或分类失败
  - 检查 `baseUrl`、`apiKey`、`model` 以及 `/chat/completions` 兼容性。
- 同步后没有仓库
  - 确认账号确实有 Star 仓库，并检查同步流程是否完成。

## 已知限制与路线图

短期规划包括：

- 增量同步，减少重复拉取与重复计算。
- 更完善的速率限制与失败恢复策略。
- 更清晰的错误归因（权限、Token、网络）。
- README 缓存策略落地（`ETag/hash` 与截断规则）。
- 当前尚未配置 `lint` / `test` 脚本。

## 贡献

欢迎提交 Issue 和 PR。对于较大改动，建议先通过 Issue 讨论范围与方案。

本地常用命令：

```bash
pnpm dev
pnpm build
pnpm preview
```

## 许可证

AGPL-3.0 license

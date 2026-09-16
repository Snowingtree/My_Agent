# Agent API

`server/` 是 Agent Workspace 的独立 Node.js 22.5+ 后端服务，使用 LangGraph 显式状态图负责任务编排，并使用 LangChain Agent 作为单个 Agent 的模型与工具循环，同时保留项目原有的认证、会话持久化、工具安全边界、MCP、RAG 和 token 使用统计。

## 核心能力

- 登录认证和 Bearer Token 校验
- Agent 会话创建、读取、删除和流式事件推送
- 会话级文件工作区管理
- 内置工具：列文件、读文件、写文件、搜索、补丁修改、命令执行等
- Skills 加载和注入
- MCP server 启动、工具发现和调用
- RAG 知识库、文档上传、向量化、检索
- AI 配置和 embedding 配置读取
- token usage 持久化统计
- LangGraph `agent -> tools -> agent` 状态图、LangChain Tool 适配、模型调用次数限制和工具调用次数限制
- LangGraph SQLite Checkpoint 会话记忆：按 `thread_id` 持久化消息、滚动摘要和压缩状态；Checkpoint 是短期记忆的权威来源，应用会话记录仅用于界面、审计和首次迁移
- 动态 Skill 两阶段凭证：`help` 读取当前说明并签发绑定会话、Skill 和说明版本的一次性 `help_token`，`run` 必须通过有效凭证校验
- 5 类行为审计：`llm_input`、`tool_call`、`tool_result`、`ai_message`、`system_action`，JSONL 持久化由 Node Worker 线程异步写盘，并提供终端监控
- 子 Agent 委派：主 Agent 可通过 `delegate_task` 交给代码审查或文档整理子 Agent；子 Agent 使用独立上下文、只读工具和独立预算，审计事件通过父任务 ID、执行 ID 和子 Agent ID 关联

## 主要接口

- `POST /api/agent/login`
- `GET /api/health`
- `GET /api/ai/configs`
- `POST /api/ai/configs`
- `PUT /api/ai/configs/:aiId`
- `GET /api/agent/sessions`
- `POST /api/agent/sessions`
- `GET /api/agent/sessions/:sessionId`
- `DELETE /api/agent/sessions/:sessionId`
- `GET /api/agent/sessions/:sessionId/stream`
- `POST /api/agent/chat`
- `GET /api/agent/capabilities`
- `GET /api/agent/skills`
- `GET /api/agent/tools`
- `GET /api/agent/tool-detail`
- `GET /api/agent/rag/status`
- `GET /api/agent/rag/collections`
- `POST /api/agent/rag/collections`
- `GET /api/agent/rag/documents`
- `POST /api/agent/rag/documents`
- `POST /api/agent/rag/upload`
- `GET /api/agent/rag/search`
- `POST /api/agent/rag/rebuild-embeddings`
- `GET /api/agent/analytics/token-usage`
- `GET /api/agent/audit/runs?sessionId=...`
- `GET /api/agent/audit/replay?sessionId=...&runId=...&throughSequence=...`
- `GET /api/integrations/lark/chats`

## Harness 第二阶段

任务仍沿用第一阶段的完成条件、结果验证和有限修正，第二阶段增加以下运行约束：

- 统一证据：每次任务生成 `runId`，模型请求、工具执行、工作区变化、验收和结束事件使用同一序列号体系；工具证据通过 `executionId` 关联现有审计详情。结构化事件以 `harness_event` 写入原有会话 JSONL，不额外保存完整提示词或文件内容。
- 共享预算：主 Agent、子 Agent、记忆压缩、兼容性/超时重试、自动验证和最终回复共用一次任务的额度；每次实际模型请求发送前计数。审批恢复保留 `runId` 和已用额度，等待用户审批的时间不计入执行时长。新用户目标创建新任务及预算。
- 失败分类：区分预算耗尽、验收失败、策略拒绝、取消、中断、环境、超时、外部服务、模型和工具错误。命令异常退出、超时、MCP `isError` 等返回值也记录为失败。分类中的 `retryable` 只是说明信息，不会自动重跑可能有副作用的工具。
- 只读回放：在「设置 → 审计」选择会话后，可以选择任务并逐步查看事件、已用预算、文件变化和验收结果。后端按日志重建状态，并使用同一个验收函数复验；不会调用模型、执行工具、恢复文件或重新计费。

预算环境变量（`server/.env`，修改后重启服务）：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `AGENT_MAX_MODEL_CALLS` | 40 | 每次任务的实际模型请求上限，包含重试和最终回复 |
| `AGENT_MAX_TOOL_CALLS` | 60 | 主/子 Agent 和验证共用的工具请求上限，包含帮助和被拦截的主 Agent 请求 |
| `AGENT_MAX_TOTAL_TOKENS` | 0 | 根据模型返回 usage 累计的 Token 上限；0 表示不开启 |
| `AGENT_TASK_TIMEOUT_MS` | 900000 | 累计执行时间上限，毫秒；0 表示不开启 |
| `AGENT_MAX_COMPLETION_REPAIRS` | 2 | 同一任务累计修正次数；0 表示不修正 |

模型/工具请求上限设为 0 表示不限制。原有 `AGENT_MAX_TOOL_ITERATIONS` 和子 Agent 自身预算仍生效，遇到任何一层限制都会停止继续执行。时间限制通过取消信号和调用边界检查执行，无法撤回已经发生的外部副作用。Token 上限在收到 usage 后检查，单次响应可能越过上限；服务端未返回 usage 或请求中断时标记未知用量，因此不能把它当作严格的金额上限。RAG embedding 请求不属于此模型对话额度。

验证命令在任务开始时确定，审批恢复使用同一组命令。只有全部检查在最近一次已记录的文件修改之后成功，才将修改标记为验证通过；普通成功命令不能代替配置的检查。未配置/未发现验证命令时，不声称修改已验证。

回放仅适用于启用第二阶段后生成的日志。缺失序号、脱敏或截断会标记记录不完整并停止可靠复验；没有结束事件且没有活动任务时，界面提示运行可能中断。回放重建的是已记录的证据和决策，不是文件内容快照，也不能证明未被工具记录的外部文件变化。审计日志仍按原有脱敏、队列及删除策略保存，请勿将其当作不可丢失的事务日志。

## 本地运行

需要 Node.js 22.5 或更高版本。后端使用显式 LangGraph 状态图运行，不再提供旧的手写循环回退模式。

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

另开一个终端查看 Agent 行为日志：

```bash
cd server
npm run audit:monitor
# 只监控指定会话
npm run audit:monitor -- session-id
```

日志记录会保留原始 `event` 名称，同时增加统一的 `category` 字段，因此现有审计页面仍能显示更细的事件，终端监控按 5 类行为聚合显示。

## 子 Agent 委派

主 Agent 可在需要独立审查或整理时调用 `delegate_task`：

- `code_reviewer`：读取工作区后报告代码风险、回归和可维护性问题。
- `document_curator`：读取文档后报告重复、缺失、过期内容和建议结构。

子 Agent 只接收主 Agent 提供的委派简报，不共享主会话消息、长期记忆、Skills、MCP 或写入权限。默认每个主任务最多委派 3 次，每个子 Agent 最多 4 次工具调用、180 秒；均可通过 `AGENT_SUBAGENT_*` 环境变量调整。

生产环境建议使用 PM2 或 systemd：

```bash
pm2 start src/index.js --name agent-api
```

## 配置来源

服务启动时会读取：

1. `server/.env.local`
2. `server/.env`
3. 系统环境变量

真实密钥只应该放在部署环境中，不要提交到 Git。

## AI 配置

支持三种来源：

- `mysql`：从 MySQL 表读取，推荐生产使用。
- `env`：从环境变量读取单个模型配置。
- `file`：从 JSON 文件读取。

通过 `AGENT_AI_CONFIG_SOURCE` 控制。

普通对话模型支持两种 API 协议：

- `openai`：OpenAI Chat Completions 及兼容接口。
- `anthropic`：Anthropic Messages API。

默认 `apiProtocol=auto`。服务会依次根据显式配置、接口域名/路径、已知兼容网关和模型名自动识别。文件配置可以增加 `"apiProtocol": "auto"`；使用环境变量配置时可以设置 `AGENT_AI_PROTOCOL=auto`。当自建网关的地址和模型名不足以判断协议时，可以显式设置为 `openai` 或 `anthropic`。

## MCP 配置

MCP 入口文件：

```text
mcp/mcp-servers.json
```

推荐一个服务一个 JSON：

```json
{
  "files": [
    "servers/lark.json"
  ],
  "items": []
}
```

密钥使用环境变量占位符，例如 `${AGENT_LARK_APP_SECRET}`。

## RAG 配置

RAG 依赖 PostgreSQL + pgvector。

后端会根据 `AGENT_RAG_DATABASE_URL` 连接数据库，并根据当前选择的 embedding 配置生成向量。embedding API Key 推荐存放在数据库 AI 配置表中，不建议硬编码到 `.env`。

## 安全注意

- `AGENT_AUTH_SECRET` 生产环境必须改成强随机值。
- `AGENT_ENABLE_WRITE_TOOLS=true` 会允许 Agent 写文件，只应写入受控工作区。
- `AGENT_ALLOWED_COMMANDS` 应保持最小化。
- MCP server 可以访问外部系统，启用前需要确认权限范围。

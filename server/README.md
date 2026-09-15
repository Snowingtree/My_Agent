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
- `GET /api/integrations/lark/chats`

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

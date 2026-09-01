# Agent API

`server/` 是 Agent Workspace 的独立 Node.js 后端服务，负责认证、会话持久化、Agent 执行循环、文件工具、MCP、RAG 和 token 使用统计。

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

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

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

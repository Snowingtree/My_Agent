# Agent Workspace

一个面向个人工作流的 Web Agent 项目。它将对话、文件读写、Skills、MCP、RAG 知识库、模型配置和调用过程可视化整合到同一个工作台中，用于探索“可操作文件和外部工具的个人 Agent”。

## 功能概览

- 对话工作台：支持多会话、流式响应、任务状态、工具调用时间线和复制消息。
- 文件工作区：每个会话拥有独立工作目录，Agent 可以读取、创建和修改当前会话文件。
- 代码预览：右侧文件列表和代码预览，支持语法高亮、复制和 HTML 运行入口。
- Skills：通过 `skills/<skill-name>/SKILL.md` 扩展 Agent 行为。
- MCP：通过 `mcp/mcp-servers.json` 和 `mcp/servers/*.json` 接入外部 MCP 服务。
- RAG：基于 PostgreSQL + pgvector 的知识库，支持多知识库、文档上传、向量化和检索注入。
- 模型配置：普通对话模型和 embedding 模型统一配置，支持按会话选择。
- 数据分析：统计 AI 和 embedding 的 token 使用情况。

## 技术栈

- Frontend: Vue 3, Vite, Axios, highlight.js
- Backend: Node.js HTTP server, mysql2, pg, mammoth
- Storage: JSON session files, PostgreSQL + pgvector, MySQL model config table
- Integrations: MCP stdio/HTTP client, Feishu/Lark MCP

## 目录结构

```text
agent/
├─ src/                    # Vue frontend
├─ server/                 # Node.js Agent API
├─ mcp/                    # MCP server definitions
│  ├─ mcp-servers.json
│  └─ servers/
├─ skills/                 # Local Agent skills
├─ dist/                   # Frontend build output
├─ docs/                   # Project documentation
└─ README.md
```

## 架构简述

```text
Browser UI
  ├─ Chat / files / settings / RAG / tools
  │
  ▼
Agent API
  ├─ Session store
  ├─ Agent runner
  ├─ Built-in file tools
  ├─ Skill loader
  ├─ MCP registry
  ├─ RAG store
  └─ Token usage store
  │
  ├─ MySQL: AI / embedding config
  ├─ PostgreSQL + pgvector: RAG vectors
  └─ MCP servers: Feishu/Lark and future integrations
```

更详细的设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

### 1. 安装依赖

```bash
npm install
cd server
npm install
```

### 2. 准备环境变量

复制模板并填写自己的本地配置：

```bash
cp .env.example .env.local
cp server/.env.example server/.env
```

注意：不要把真实 `.env`、API Key、数据库密码、飞书 App Secret 提交到 GitHub。

### 3. 启动后端

```bash
npm run server:start
```

默认读取 `server/.env`，监听 `AGENT_HOST:AGENT_PORT`。

### 4. 启动前端

```bash
npm run dev
```

### 5. 构建前端

```bash
npm run build
```

构建产物输出到 `dist/`。

## 部署说明

典型部署方式：

- Nginx 将 `/agent/` 指向 `dist/`。
- Nginx 将 `/agent-api/` 反向代理到 Agent API。
- PM2 或 systemd 托管 `server/src/index.js`。
- PostgreSQL 安装 pgvector 并创建 RAG 数据库。
- MySQL 保存 AI 配置和 embedding 配置。

示例 Nginx 结构：

```nginx
location ^~ /agent/ {
    try_files $uri $uri/ /agent/index.html;
}

location ^~ /agent-api/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

## 公开仓库安全要求

公开前必须确认：

- `.env`、`server/.env`、`.env.production` 没有被 Git 跟踪。
- README、截图、日志中没有 API Key、数据库密码、JWT Secret、飞书 App Secret。
- MCP 配置只使用 `${ENV_NAME}` 占位符，不直接写密钥。
- 服务器上的真实配置只保存在部署环境中。

更多检查项见 [SECURITY.md](SECURITY.md)。

## 简历项目描述参考

可以写成：

> Agent Workspace：一个支持多模型配置、会话级文件读写、Skills 扩展、MCP 工具调用和 RAG 知识库检索的 Web Agent 平台。项目实现了独立 Node.js Agent API、Vue 工作台界面、工具调用可视化、会话文件隔离、token 使用统计和 PostgreSQL pgvector 向量检索。

## License

当前项目用于个人学习和展示。如需开源发布，建议补充明确的 LICENSE 文件。

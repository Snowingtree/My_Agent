# Agent API

This directory contains a standalone Node.js API for the Agent workspace.

## What It Provides

- `POST /api/login`
- `GET /api/ai/configs`
- `GET /api/agent/sessions`
- `POST /api/agent/sessions`
- `GET /api/agent/sessions/:sessionId`
- `DELETE /api/agent/sessions/:sessionId`
- `GET /api/agent/skills`
- `GET /api/agent/capabilities`
- `POST /api/agent/chat`
- `GET /api/health`

The service is independent from your blog backend API routes. It has its own:

- login credentials
- auth token signing
- agent session persistence
- agent routes
- agent session persistence
- task execution loop
- skill registry
- MCP registry

It can still reuse the same AI provider records stored in your existing blog database.

## Local Run

1. Copy `.env.example` to `.env`
2. Fill in the MySQL env values so the service can read the same `ai_provider_configs` table used by your blog notes AI
3. Install server dependencies:

```bash
cd server
npm install
```

4. Start the API:

```bash
cd server
npm run dev
```

The default port is `3001`, which matches the Vite proxy already used by the frontend.

## AI Config Source

Preferred mode: MySQL, using the same table as your blog notes AI config page.

Relevant env vars:

- `AGENT_AI_CONFIG_SOURCE=mysql`
- `MYSQL_*`
- `AI_SETTINGS_MYSQL_*`
- `OPENAI_KEY_ENCRYPTION_SECRET`

## Skills

The Agent can load reusable skill definitions from:

- `server/config/skills.json`
- or a custom path via `AGENT_SKILLS_CONFIG_PATH`

Supported skill fields:

- `skillId`
- `name`
- `description`
- `instruction` or `instructionPath`
- `preferredTools`
- `disabledTools`
- `allowedTools`

You can also set a default skill with:

- `AGENT_DEFAULT_SKILL_ID`

## MCP

The Agent can preload MCP servers from:

- `mcp/mcp-servers.json`
- or a custom path via `AGENT_MCP_CONFIG_PATH`

`mcp/mcp-servers.json` is the entry file. It can keep inline `items`, or reference
per-service files:

```json
{
  "files": [
    "servers/lark.json",
    "servers/xiaohongshu.json"
  ],
  "items": []
}
```

Each referenced file can contain one MCP server object, an array of server objects,
or another `{ "items": [...] }` object.

Current scaffold support:

- `stdio` transport
- `tools/list`
- `tools/call`

Useful env vars:

- `AGENT_MCP_ENABLED`
- `AGENT_MCP_CONFIG_PATH`
- `AGENT_MCP_TIMEOUT_MS`
- `AGENT_MCP_PROTOCOL_VERSION`

Each configured MCP server can define:

- `serverId`
- `name`
- `enabled`
- `transport`
- `command`
- `args`
- `cwd`
- `env`
- `toolNamePrefix`
- `includeTools`
- `excludeTools`

The standalone service also accepts the same shared env names already used by your blog backend:

- `MYSQL_HOST`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `AUTH_TOKEN_SECRET`
- `AUTH_TOKEN_TTL_SECONDS`
- `API_HOST`
- `API_PORT`

If you do not want to use MySQL temporarily, the service still supports fallback env/file config.

## PM2

Example start command:

```bash
pm2 start ecosystem.config.cjs
```

Then point Nginx `/api` to this service.

# Architecture

Agent Workspace is split into a Vue frontend and a standalone Node.js Agent API.

## Frontend

The frontend is responsible for:

- Login and token storage
- Session list and chat workspace
- Message streaming display
- Tool call timeline
- Workspace file list and code preview
- Settings center for AI configs, MCP, Skills, RAG, tools, and analytics
- Per-session selection of AI model, Skills, MCP servers, embedding config, and RAG collections

Important paths:

```text
src/App.vue
src/useAgentWorkspace.js
src/components/AgentWorkspaceScreen.vue
src/components/agent/
```

## Backend

The backend is a Node.js HTTP service. It avoids framework coupling and keeps the Agent logic in explicit modules.

Important modules:

```text
server/src/index.js              # HTTP routes and bootstrap
server/src/agentRunner.js        # Agent loop and model interaction
server/src/toolRunner.js         # Built-in and MCP tool execution
server/src/workspace.js          # Workspace file operations
server/src/sessionStore.js       # Session persistence
server/src/sessionWorkspaces.js  # Per-session workspace repository
server/src/skillLibrary.js       # Project skills loader
server/src/mcpRegistry.js        # MCP server lifecycle and tool registry
server/src/ragStore.js           # PostgreSQL + pgvector RAG store
server/src/embeddingClient.js    # Embedding provider client
server/src/tokenUsageStore.js    # Token usage ledger
```

## Agent Flow

```text
User message
  -> frontend sends selected aiId/model/skills/mcp/rag/embedding
  -> backend loads session and workspace state
  -> optional RAG retrieval injects knowledge context
  -> Agent runner asks model for structured action
  -> tool runner executes built-in or MCP tools
  -> file changes update the session workspace
  -> final response and tool events stream to frontend
  -> session, token usage, and workspace metadata persist
```

## Storage

```text
storage/agent/sessions/          # one JSON file per conversation
storage/agent/agent-workspace/   # one workspace folder per conversation
storage/agent/token-usage.jsonl  # append-only token usage ledger
PostgreSQL + pgvector            # RAG collections, documents, chunks, vectors
MySQL                            # AI and embedding provider configs
```

The exact storage root is configured by environment variables. Production secrets and absolute paths should stay outside Git.

## Skills

Skills are local instruction packages:

```text
skills/<skill-id>/SKILL.md
skills/<skill-id>/description.md
```

They are not tools by themselves. A skill changes model instructions and preferred behavior; tools still execute through the tool runner.

## MCP

MCP servers are configured in:

```text
mcp/mcp-servers.json
mcp/servers/*.json
```

Each MCP server contributes tools to the same tool catalog as built-in tools. The Agent can call them through the structured tool execution path.

## RAG

RAG is collection-based:

- A collection contains documents.
- A document is split into chunks.
- Chunks are embedded and stored in pgvector.
- During chat, selected collections are searched and relevant snippets are injected into the model context.

Embedding configuration is read from AI configs with `type=embedding`.

## Security Boundaries

- Authentication protects API routes.
- Per-session workspaces isolate user-generated files.
- `AGENT_ALLOWED_COMMANDS` limits shell command execution.
- MCP permissions are controlled by each external platform and `mcp/servers/*.json`.
- Real credentials are only read from environment variables or databases.

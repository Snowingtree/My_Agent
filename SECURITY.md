# Security Checklist

This repository is intended to be safe to publish, but the deployed service depends on private credentials. Keep real credentials outside Git.

## Never Commit

- `.env`, `.env.local`, `.env.production`, `server/.env`, `server/.env.local`
- API keys for AI or embedding providers
- Database passwords or connection strings with passwords
- Feishu/Lark App Secret
- JWT/auth secrets
- Server private keys, SSH keys, certificates, cookies, logs, database dumps

## Before Publishing

Run these checks locally:

```bash
git status --short
git ls-files .env .env.local .env.production server/.env server/.env.local
```

The second command should print nothing. If it prints a file, remove it from Git tracking before publishing:

```bash
git rm --cached <file>
```

Then rotate any key that was ever committed.

## Environment Files

Use templates only:

- `.env.example`
- `server/.env.example`

Real values should live on the server or in your deployment platform.

## MCP Risk

MCP servers can access external services. Treat every enabled MCP server as a permission boundary:

- Enable only the MCP servers you need.
- Prefer environment variable placeholders in `mcp/servers/*.json`.
- Review requested permissions in the external platform.
- Do not grant broad write permissions unless the workflow requires them.

## File Write Risk

`AGENT_ENABLE_WRITE_TOOLS=true` allows Agent tools to write files. Keep:

- `AGENT_WORKSPACE_WRITE_MODE=session` for isolated per-session workspaces.
- `AGENT_ALLOWED_COMMANDS` minimal.
- Nginx and filesystem permissions scoped to the Agent workspace.

## If a Secret Leaks

1. Revoke or rotate the leaked key immediately.
2. Remove the secret from Git history or make the repository private.
3. Redeploy with a new secret.
4. Check server logs for unexpected usage.

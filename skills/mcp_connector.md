---
name: mcp_connector
title: MCP 连接器
description: CyberClaw 风格的 MCP 连接器。先读取本技能说明，再启用技能，然后通过统一的 mcp_gateway 命令入口访问已选择的 MCP 服务。
---

# MCP 连接器

这个技能把 MCP 封装成一个统一入口，而不是把每个远程 MCP 工具都直接暴露给 Agent。

使用顺序：

1. 调用 `skill`，参数为 `skillId="mcp_connector"`、`mode="help"`，先读取本说明。
2. 调用 `skill`，参数为 `skillId="mcp_connector"`、`mode="run"`，启用 MCP 访问能力。
3. 使用 `mcp_gateway`，通过命令字符串访问 MCP。

`mcp_gateway` 支持的命令：

```text
list servers
list tools
list tools <serverId>
describe <fullToolName>
call <fullToolName> <jsonObjectArguments>
```

示例：

```text
list servers
list tools
describe mcp.context7.query-docs
call mcp.context7.query-docs {"libraryId":"/reactjs/react.dev","query":"useEffect cleanup"}
```

规则：

- 不要直接调用 `mcp.*` 远程工具，统一使用 `mcp_gateway`。
- 如果不清楚参数结构，先用 `describe` 查看工具说明，再用 `call` 调用。
- `call` 的参数必须是 JSON 对象，不要使用 shell 参数写法。
- MCP 工具可能访问外部服务，调用范围必须严格围绕用户当前请求。

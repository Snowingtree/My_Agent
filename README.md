# Agent Workspace

一个独立部署的 Vue 3 + Vite Agent 子应用。

这个项目用于个人博客主页中的 `Agent` 入口。博客主页点击 `Agent` 后会跳转到内网地址的 `/agent/`，先进入私有网络访问检测和登录页，登录成功后进入 Agent 工作区。

## 技术栈

- Vue 3
- Vite
- Axios
- snowingress-my-components

## 访问链路

公开博客主页中的 Agent 链接指向私有网络地址：

```text
http://100.73.19.92/agent/
```

注意必须保留结尾 `/`。如果访问 `/agent`，服务器需要重定向到 `/agent/`。

## 本地开发

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:5175/agent/
```

开发服务器会把 `/api` 代理到后端：

```text
http://127.0.0.1:3001
```

可以通过 `API_PROXY_TARGET` 覆盖：

```bash
API_PROXY_TARGET=http://127.0.0.1:3001 npm run dev
```

Windows PowerShell 如果拦截 `npm.ps1`，可以使用：

```powershell
npm.cmd run dev
```

## 构建

```bash
npm run build
```

Windows PowerShell 可使用：

```powershell
npm.cmd run build
```

构建产物输出到：

```text
dist/
```

构建结束后会输出总文件大小和文件数量，例如：

```text
[build-size] Total: 1.17 MB | Files: 3
```

## 环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `API_PROXY_TARGET` | 本地开发时 Vite `/api` 代理目标 | `http://127.0.0.1:3001` |
| `VITE_API_BASE_URL` | 前端请求 API 的显式后端地址 | 空 |
| `VITE_PRIVATE_APP_BASE_URL` | 私有网络应用地址 | `http://100.73.19.92` |
| `VITE_PUBLIC_APP_BASE_URL` | 返回公开主页时使用的地址 | `http://www.wmzh.online` |
| `VITE_PRIVATE_APP_ALLOWED_HOSTS` | 额外允许的私有网络域名，英文逗号分隔 | 空 |

生产部署通常不需要设置 `VITE_API_BASE_URL`，只要 Nginx 正确把 `/api` 转发到 Node 后端即可。

## Nginx 部署示例

假设服务器静态根目录结构如下：

```text
web-root/
  index.html
  assets/
  agent/
    index.html
    assets/
```

Agent 子应用配置：

```nginx
location = /agent {
    return 301 /agent/;
}

location ^~ /agent/ {
    try_files $uri $uri/ /agent/index.html;
}
```

后端 API 代理示例：

```nginx
location = /api/login {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/ai/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

location ^~ /api/agent/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

不要添加下面这种规则，否则会和 `/agent -> /agent/` 形成无限重定向：

```nginx
location = /agent/ {
    return 301 /agent;
}
```

## 后端 API 依赖

当前前端会调用这些接口：

```text
POST   /api/login
GET    /api/ai/configs
GET    /api/agent/sessions
POST   /api/agent/sessions
GET    /api/agent/sessions/:sessionId
DELETE /api/agent/sessions/:sessionId
POST   /api/agent/chat
```

登录成功后，后端需要返回 `token`，前端会把它写入 `localStorage` 并作为后续请求的 `Authorization: Bearer <token>`。

## 私有网络访问

项目会判断当前访问环境是否属于私有网络。以下情况会被认为允许访问：

- `localhost`
- `127.0.0.1`
- Tailscale `100.64.0.0/10` 地址
- `.ts.net` 域名
- `VITE_PRIVATE_APP_ALLOWED_HOSTS` 中配置的域名

如果从公开网络进入，会先尝试探测 `VITE_PRIVATE_APP_BASE_URL`，可达时跳转到私有网络地址；不可达时显示私有网络不可访问提示。

## 项目结构

```text
src/
  App.vue
  main.js
  http.js
  auth.js
  storage.js
  useAgentWorkspace.js
  style.css
  hooks/
    usePrivateAppAccess.js
  utils/
    privateAccess.js
  components/
    LoginForm/
    PrivateAccessLoadingOverlay/
    AgentWorkspaceScreen.vue
    agent/
      AgentWorkspace/
```

## 备份说明

建议上传 GitHub 时保留：

```text
index.html
package.json
package-lock.json
vite.config.js
src/
README.md
```

不建议上传：

```text
node_modules/
dist/
```

`dist/` 是构建产物，可以随时通过 `npm run build` 重新生成。

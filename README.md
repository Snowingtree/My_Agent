# Agent Workspace

一个独立部署的 Vue 3 + Vite Agent 子应用。

这个项目用于个人博客主页中的 `Agent` 入口。博客主页点击 `Agent` 后会跳转到内网地址的 `/agent/`，先进入私有网络访问检测和登录页，登录成功后进入 Agent 工作区。

## 技术栈

- Vue 3
- Vite
- Axios
- snowingress-my-components


## git语句
# Commit Message 标识说明

| 标识 | 含义 | 作用 |
|---|---|---|
| ✨ `feat` | 新功能 | 新增一个功能、页面、模块或能力 |
| 🐛 `fix` | 修复问题 | 修复 bug、错误逻辑、异常行为 |
| 📝 `docs` | 文档修改 | 修改 README、注释、说明文档等，不影响代码逻辑 |
| ♻️ `refactor` | 代码重构 | 不改变功能结果，只优化代码结构、可读性、可维护性 |
| ⚡ `perf` | 性能优化 | 提升运行速度、减少内存占用、优化加载性能等 |
| 🧑‍💻 `dx` | 开发体验优化 | 改善开发者使用体验，比如优化脚本、调试方式、错误提示 |
| 🔨 `workflow` | 工作流修改 | 修改项目流程、自动化流程、开发流程配置 |
| 🏷️ `types` | 类型相关 | 修改 TypeScript 类型、类型声明、接口类型等 |
| 🚧 `wip` | 开发中 | 功能还没完成，临时提交当前进度 |
| ✅ `test` | 测试相关 | 新增或修改测试代码，比如单元测试、集成测试 |
| 🔨 `build` | 构建相关 | 修改打包配置、构建脚本、构建工具配置 |
| 👷 `ci` | 持续集成 | 修改 GitHub Actions、GitLab CI、自动测试/部署流程 |
| ❓ `chore` | 杂项维护 | 不属于功能、修复、文档、测试的日常维护工作 |
| ⬆️ `deps` | 依赖更新 | 升级或修改 npm、pip、Maven 等依赖版本 |
| 🔖 `release` | 发布版本 | 发布新版本、打 tag、更新版本号、生成 changelog |

## 常见示例

```bash
✨ feat: 添加用户登录功能
🐛 fix: 修复手机号校验失败的问题
📝 docs: 更新项目启动说明
♻️ refactor: 重构订单列表组件
⚡ perf: 优化首页图片加载速度
🧑‍💻 dx: 优化本地开发启动脚本
🔨 workflow: 调整代码提交检查流程
🏷️ types: 补充用户信息类型定义
🚧 wip: 暂存个人中心页面开发进度
✅ test: 添加登录模块单元测试
🔨 build: 修改 Vite 构建配置
👷 ci: 更新 GitHub Actions 自动部署流程
❓ chore: 清理无用配置文件
⬆️ deps: 升级 React 依赖版本
🔖 release: 发布 v1.2.0
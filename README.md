# dsh-tuitui

把 360 推推（Tuitui）IM 机器人接入 DeepSeek Harness 的插件。

- 私聊消息直接回复；群聊仅在 @机器人 时回复。
- 回答由 Harness agent 生成（模型、工具、预设跟随 Harness 配置），不再直连 DeepSeek API。
- 每个推推会话（cid）映射到一个独立的 Harness 会话；在推推里发送 `/new` 开启新会话，`/status` 检查连接，`/help` 查看帮助。
- 在 Harness「设置 → 插件 → 推推机器人」页面接入凭据，并可随时**启用 / 停止 / 删除**机器人。
- App Secret 只写入本机 Harness 凭据存储（引用名 `DSH_TUITUI_BOT_SECRET_<appId>`），任何 RPC 响应都不会返回。

## 安装

### 方式一：从 GitHub 安装（推荐）

```sh
dsh plugin --profile web add github:tragic52/dsh-tuitui
```

### 方式二：本地开发安装

```sh
# 克隆仓库
git clone https://github.com/tragic52/dsh-tuitui.git
cd dsh-tuitui

# 安装依赖并构建
npm install
npm run build

# 安装到 web profile
dsh plugin --profile web add .
```

重启 `dsh web`，打开「设置 → 插件 → 推推机器人」，填写 App ID 与 App Secret 接入即可。

## 使用

1. **接入机器人**：在设置页填写推推开放平台的 App ID 和 App Secret
2. **启用/停止**：点击对应按钮控制消息连接
3. **删除**：清除凭据与会话状态

### 会话管理指令（在推推私聊发送）

- `/new` - 开启新会话
- `/status` - 检查连接状态
- `/help` - 显示帮助

## 配置（可选）

在 profile 的 `cordis.patch.yml` 中覆盖插件配置：

```yaml
- id: dsh-tuitui
  config:
    agentPreset: standard     # Harness agent 预设
    workspace: 'D:\some\dir'  # 会话工作区，默认 dsh web 启动目录
    replyTimeoutMs: 600000    # 单条回复超时
    rpcAuthority: loopback    # loopback（默认）或 trusted-host
```

## 开发

- Host 端源码：`plugin-src/host/`（esbuild 打包到 `lib/index.js`，SDK 与 ws 一并内联，运行期零依赖）。
- 客户端设置页：`plugin-src/client/`（打包到 `lib/client.js`，由 DSH 客户端模块系统加载）。
- 架构参照 `@xmanrui/dsh-im`：cordis 插件 + Connection RPC + 设置页 slot。

## 注意

- 同一机器人账号不要同时运行其他监听进程（如独立版 `npm start`），否则消息会被重复消费。
- 停止机器人只断开消息连接，凭据和会话映射保留；删除才会清理凭据与会话状态。

## License

MIT

# shroud

pi 的 secret firewall。agent 能用你的 API key，但永远看不到值。

从 [@arvoretech/pi-secret-firewall](https://github.com/arvoreeducacao/arvore-pi-extensions) fork 出来，完全重写。

## 它做什么

启动时自动发现你的 secrets，之后所有流向模型的内容都会被 redact：

- `process.env` 里名字像 secret 的变量（`*_TOKEN`、`*_API_KEY`、`DATABASE_URL`...）
- `~/.pi/agent/auth.json`（pi 自己的 API key store）
- `.env` / `.env.local` / `.env.development*`
- `~/.netrc`、`~/.aws/credentials`、`~/.docker/config.json`

模型看到的永远是占位符：

```
sk-abc123...  →  «SECRET OPENAI_API_KEY redacted — ... read it in bash as "$OPENAI_API_KEY"»
```

模型在 bash 里引用 `$OPENAI_API_KEY`，shell 解析真实值，值从不进模型上下文。16 个内置 pattern（JWT、AWS key、GitHub token、PEM block、连接串...）兜底匹配未知格式。

## 装

```bash
pi install npm:@uiyzzi/pi-shroud
```

## 命令

`/shroud`：当前保护了多少 secret，拦截了多少次
`/shroud-toggle`：开关 redact
`/shroud-rescan`：重新扫描 env 和凭据文件

## 和 askpass 联动（自动）

装了 [pi-askpass](../askpass/) 时自动同步，走 `globalThis` 周知 Symbol 桥。桥是 duck-typed 的，没装对方就静默跳过，加载顺序无所谓。

- **push**：askpass 每捕获一个密钥，立刻推进 shroud 的 redactor（`addRuntimeSecret`），没有 rescan 空窗
- **pull**：shroud rescan 时拉 askpass 的已捕获列表，加载前捕获的也覆盖；同名冲突以 askpass 为准，用户刚输的总是最新

## 配置

`~/.pi/agent/shroud.json`（全局）和 `.pi/shroud.json`（项目），deep merge，项目优先。

```json
{
  "patterns": [
    { "name": "ACME", "regex": "acme-[0-9a-f]{12}" },
    { "name": "CORP", "regex": "corp_[A-Za-z0-9]{24}", "flags": "i" }
  ],

  "discovery": {
    "disabled": ["netrc", "aws-credentials", "docker-config"],

    "extraFiles": [
      { "path": "/etc/secrets.env",      "format": "dotenv" },
      { "path": "/etc/config.json",      "format": "json", "jsonKeys": ["apiKey"] },
      { "path": "/etc/credentials.ini",  "format": "ini" },
      { "path": "/etc/api-token",        "format": "raw", "secretName": "DEPLOY_TOKEN" }
    ]
  }
}
```

三种自定义维度：

| 配置 | 控制 |
|---|---|
| `patterns` | 事后：正则匹配新 token 格式 |
| `discovery.disabled` | 事前：关掉内置凭据文件解析 |
| `discovery.extraFiles` | 事前：加自定义文件，dotenv / json / ini / raw 四种格式 |

## 和同类项目的区别

pi-redact-all 检测层更多（熵、X.509、PII），但标记格式是 `[REDACTED:type]`。模型看到这个标记后没法用它调 API，只能再问你要。

shroud 走 shell var 占位符路线。模型写 `$VAR`，shell 解析 `$VAR`。值不在上下文里，但能动。

误报风险高的层没移植。熵检测杀 git hash 和 base64 输出，PII 杀 git config 里的邮箱。X.509 裸 DER 在 agent 场景几乎不出现。保留的都是特征明确、误报极低的模式。

## 架构

```
src/
├── index.ts         入口（thin）
├── engine.ts        联合正则引擎，一次扫描
├── discovery.ts     事前发现（env / auth.json / .netrc / aws / docker / .env）
├── config.ts         配置加载
├── hooks.ts          四个事件钩子 + 环境变量碰撞保护 + addRuntimeSecret
├── bridge.ts         askpass 联动（globalThis symbol 桥，双向）
├── commands.ts       三个 /shroud 命令
└── util.ts           工具函数
```

## 性能

所有 literal 值编译为一个联合正则，单次 `String.replace`。16 个 pattern 跑第二轮。

| 场景 | 耗时 |
|---|---|
| 50 secrets × 100 段文本 | 0.12ms |
| 26 patterns（16 内置 + 10 自定义） | 0.014ms |
| refresh(20 secrets) | 0.022ms |

## 开发

```bash
npm install
npm run build      # tsc → dist/
npm test           # 77 测试（单元 + 性能 + 边界）
```

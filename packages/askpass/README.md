# askpass

agent 要密钥时，在 pi 的 TUI 里弹掩码输入框。你打字，值直接进 shell env，全程不进模型上下文。

## 它做什么

```
agent: 调 askpass { description: "GitHub token" }
你:    🔒 GitHub token
       Stored as $GITHUB_TOKEN — the value is never shown to the agent
       > ••••••••••••
agent: 只看到 "Secret captured and exported as $GITHUB_TOKEN"
agent: bash → curl -H "Authorization: Bearer $GITHUB_TOKEN" ...
```

值从头到尾只待在两个地方：扩展进程内存和 `process.env`。模型上下文里只有变量名。

## 装

```bash
pi install npm:@uiyzzi/pi-askpass
```

改了代码就 `npm run build`，再 `/reload`。

## 工具：askpass

agent 可调。参数：

| 参数 | 必填 | 作用 |
|---|---|---|
| `description` | ✓ | 密钥用途，显示在弹窗标题 |
| `name` | | env 变量名，缺省时从 description 派生 |
| `writeFile` | | 同时写文件，追加 `NAME=value`，权限 0600 |
| `raw` | | 配合 writeFile，裸值覆盖写 |
| `exec` | | 拿到值立刻执行的 shell 命令，值在 `$PI_SECRET` 和 `$<name>` 里 |

工具结果只有确认文字和变量名，没有值。

## 命令

`/askpass NAME [描述...]`：你自己手动存密钥，不经过 agent
`/askpass-list`：列出已捕获的变量名和统计，不显示值

## agent 看到的规矩

每轮 system prompt 注入三行：要密钥一律调 `askpass`，别让用户往聊天里贴；值在 bash 里用 `$NAME` 引用；不准读，不准 echo，不准打印。

## 值怎么防住模型

四层，从里到外：

1. 工具结果里压根没值，只有确认和变量名。
2. system prompt 明文禁止 agent 窥探。
3. `writeFile` 写过的文件进保护名单。read/edit/write 直接 block，bash 命令碰到这些路径也 block。
4. 精确匹配清洗。值一旦出现在你的输入或工具输出里（比如 agent 使坏 `echo $NAME`），换成占位符。短于 4 字符的值不洗，怕误伤常见子串。

## 和 shroud 联动

两个都装时自动同步，走 `globalThis` 周知 Symbol 桥。桥是 duck-typed 的，没装对方就静默跳过，加载顺序无所谓。

- push：askpass 每捕获一个密钥，立刻推进 shroud 的 redactor，没有 rescan 空窗。工具结果的 `details.shroudSynced` 和 `/askpass` 的通知会显示 shroud 收没收到。
- pull：shroud rescan 时拉 askpass 的已捕获列表，shroud 加载前捕获的也覆盖。同名冲突以 askpass 为准，你刚输的总是最新。

## 布局

```
src/
  index.ts    入口
  tool.ts     askpass 工具（弹窗 → env / 文件 / exec）
  hooks.ts    提示词注入、文件保护、泄漏清洗
  commands.ts /askpass 和 /askpass-list
  bridge.ts   shroud 联动
  state.ts    会话状态和清洗计数
```

掩码输入框和弹窗组件在 [secret-kit](../secret-kit/)，这个包只管密钥生命周期。

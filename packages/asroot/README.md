# asroot

pi 的 sudo。agent 要 root 权限时调 `asroot` 工具，你在 TUI 掩码输入框里输密码，密码全程碰不到模型。

## 它做什么

```
agent: 调 asroot { command: "diskutil list" }
你:    🔒 Administrator access required
       Enter password for you to run: diskutil list
       > ••••••••
agent: 拿到命令输出，密码它从没见过
```

密码走 stdin 喂给 `sudo -S -k -v` 做校验，之后靠 sudo 自己的时间戳缓存（macOS 默认 5 分钟）跑真正的命令。密码不进 argv（`ps` 看不到），不进 env（子进程继承不到），不落盘。

## 装

```bash
pi install npm:@uiyzzi/pi-asroot
```

改了代码就 `npm run build`，再 `/reload`。

## 工具：asroot

agent 可调。参数：

| 参数 | 必填 | 作用 |
|---|---|---|
| `command` | ✓ | 要以 root 跑的 shell 命令 |
| `timeout` | | 超时秒数，默认 60，上限 600 |

行为：sudo 时间戳还有效就直接跑。过期了弹掩码输入框，密码校验通过再跑。你按 Esc 或密码错，工具报错，agent 可以重试。

## 命令

`/asroot <command...>`：你自己手动跑 root 命令，输出截断显示在通知里

## 防护

- bash 工具里的 `sudo` 一律 block，理由里指明走 `asroot`。非交互 shell 里 sudo 本来也跑不动，这条是把 agent 往正路上引。
- 密码留在扩展内存里做精确清洗。它一旦漏进你的输入或任何工具输出，换成占位符。
- 装了 shroud 时，密码以 ephemeral 方式推进它的 redactor：全通道打码，但不导出 env，不列进可用变量，占位符也不带 bash 提示。普通密钥（askpass 那些）agent 还能用 `$NAME` 引用，sudo 密码连这个口子都没有。

## 布局

```
src/
  index.ts    入口
  tool.ts     asroot 工具
  auth.ts     时间戳检查 + 掩码弹窗 + 密码校验
  sudo.ts     sudo 进程封装（stdin 喂密码）
  hooks.ts    提示词注入、sudo 拦截、泄漏清洗
  commands.ts /asroot
  state.ts    会话状态和清洗计数
```

掩码输入框来自 [secret-kit](../secret-kit/)，和 [askpass](../askpass/) 共用一套。

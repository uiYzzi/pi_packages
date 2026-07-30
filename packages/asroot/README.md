# asroot

pi 的透明 sudo。agent 在 bash 里直接写 `sudo`，密码弹窗和喂密码全在后台完成，agent 从头到尾碰不到密码。

## 它做什么

```
agent: bash → sudo diskutil list
hook:  拦到 sudo → 弹掩码输入框（首次，或缓存过期后）
你:    🔒 Root access requested
       you · sudo diskutil list
       > ••••••••
hook:  mkfifo 一次性管道 → 改写命令加 PATH shim → 放行
bash:  shim 版 sudo 从管道读到密码，命令正常跑
agent: 只看到输出。密码不在命令文本里，不在任何上下文中
```

密码在扩展内存里缓存 5 分钟，和 sudo 的 `timestamp_timeout` 一个习惯。过期或会话结束就消失，下次 sudo 重新弹窗。弹窗副标题显示当前要执行的命令。

> 注意：缓存是扩展自己实现的。sudo 原生时间戳按 tty 记账，pi spawn 的进程没有 tty，指望不上。

## 装

```bash
pi install npm:@uiyzzi/pi-asroot
```

改了代码就 `npm run build`，再 `/reload`。

## 密码的旅程

弹窗 → `sudo -S -k -v` 校验 → 内存缓存 5 分钟 → 每次 sudo 经 fifo 喂给 shim。全程不进 argv（`ps` 看不到），不进 env（子进程继承不到），不落盘，不进 session 文件。

泄漏兜底：缓存期间做了精确清洗，密码出现在你的输入或工具输出里就换成占位符。装了 shroud 时以 ephemeral 方式同步，全通道打码但不导出 env。

## agent 看到的规矩

每轮 system prompt 注入三行：sudo 直接在 bash 里用，密码会透明喂入；别问密码，别读，别 echo。

## 无 TUI 模式

弹不了窗（`pi -p`、rpc）时，带 sudo 的 bash 调用被 block，理由里说明需要交互终端。自己在终端先跑别的方案。

## 布局

```
src/
  index.ts    入口，session 结束时清缓存
  hooks.ts    提示词注入、sudo 拦截改写、泄漏清洗
  auth.ts     缓存检查 + 掩码弹窗 + 密码校验
  shim.ts     PATH shim 和一次性 fifo
  sudo.ts     sudo 进程封装（stdin 喂密码）
  state.ts    会话状态、5 分钟缓存、清洗
```

掩码输入框来自 [secret-kit](../secret-kit/)，和 [askpass](../askpass/) 共用一套。

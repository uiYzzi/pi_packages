# pi-orca-mail

Orca 编排信箱的自动推送桥。pi agent 不再需要 `orca orchestration check --wait` 阻塞轮询——邮件到了自动变成用户消息注入上下文。

## 行为

| 环境 | 行为 |
|---|---|
| **Orca 外**（无 `ORCA_TERMINAL_HANDLE`） | 完全不生效。不注册任何 handler，零 timer、零进程、零损耗 |
| **Orca agent terminal 内** | 后台跑阻塞式 `check --wait`（扩展进程内，不占 agent turn），邮件到达即注入 |

注入分两条路：

- **agent 空闲** → `pi.sendUserMessage()`，像用户打字一样开新 turn
- **agent 忙碌** → `context` 事件钩子，把邮件拼进进行中的 LLM 请求

同时在系统提示词追加一小段说明，告诉 LLM：信箱是推送式的，不要自己 poll；要回复用 `orca orchestration reply --id <msg_id> --body "..."`。

## 正确性

- **服务器即队列**：本地最多持有一个 batch。未 ack 的 batch Orca 会原样重放，桥不建本地缓冲
- **只 ack 已投递**：ack 随下一轮 `check --ack <id>` 发出；投递失败（agent 刚好变忙）转 held 等钩子
- **重放去重**：ack 丢失导致服务器重投时，按 `deliveryId` 跳过重复注入，只补 ack
- **退避重试**：CLI 失败保留 slot，15s 后重试，通知节流每分钟最多一条

## 架构

```
src/index.ts   胶水：pi 事件 ↔ 桥（唯一懂 pi 的地方）
src/bridge.ts  状态机：EMPTY → HELD → INJECTED → EMPTY（纯逻辑，依赖全注入）
src/runner.ts  IO：spawn `orca orchestration check --wait`、解 JSON
src/env.ts     检测：ORCA_TERMINAL_HANDLE 硬信号
src/format.ts  渲染：mail → 注入文本 + 系统提示词片段
```

## 开发

```bash
npm install
npm test     # tsc + node --test（23 个用例）
npm run lint
```

本地装进 pi：

```bash
pi install ./packages/orca-mail
```

## License

MIT

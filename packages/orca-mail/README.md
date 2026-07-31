# pi-orca-mail

Orca 编排 Run 信箱的自动推送桥。pi agent 不再需要 `orca orchestration check --wait` 阻塞轮询——worker_done / escalation / question 到了自动变成用户消息注入上下文。

## 与 Orca push-on-idle 的分工

Orca 自带的 push-on-idle 只投递**直发终端 handle** 的邮件；Run 信箱（worker 生命周期汇报）它从不推送，coordinator 只能轮询。本插件只补这个缺口：

| 邮件 | 投递者 |
|---|---|
| 直发终端 handle 的邮件 | **Orca push-on-idle**（本插件不碰，避免双投） |
| Run 信箱的 worker_done / escalation / question | **本插件** |

## 行为

| 环境 | 行为 |
|---|---|
| **Orca 外**（无 `ORCA_TERMINAL_HANDLE`） | 完全不生效。不注册任何 handler，零 timer、零进程、零损耗 |
| **Orca 终端内，无 active coordinator run** | 休眠。每 30s 探测一次 run-list，不跑 check、不产生错误 |
| **有 active coordinator run** | 后台跑阻塞式 `check --run <id> --wait --types worker_done,escalation,question`（扩展进程内，不占 agent turn），邮件到达即注入 |

注入分两条路：

- **agent 空闲** → `pi.sendUserMessage()`，像用户打字一样开新 turn
- **agent 忙碌** → `context` 事件钩子，把邮件拼进进行中的 LLM 请求（这是相对 Orca push-on-idle 的本质优势：推送只在 idle 跳变触发）

同时在系统提示词追加一小段说明，告诉 LLM：信箱是推送式的，不要自己 poll；要回复用 `orca orchestration reply --id <msg_id> --body "..."`。

## 正确性

- **服务器即队列**：本地最多持有一个 batch。未 ack 的 batch Orca 会原样重放，桥不建本地缓冲
- **只 ack 已投递**：ack 随下一轮 `check --ack <id>` 发出；投递失败（agent 刚好变忙）转 held 等钩子
- **重放去重**：ack 丢失导致服务器重投时，按 `deliveryId` 跳过重复注入，只补 ack
- **run 消失即休眠**：run 结束 / 身份降级（`legacy_read_only` 等）不报错刷屏，回到休眠探测
- **退避重试**：真正的 CLI 失败保留 slot，15s 后重试，通知节流每分钟最多一条

## 架构

```
src/index.ts   胶水：pi 事件 ↔ 桥（唯一懂 pi 的地方）
src/bridge.ts  状态机：EMPTY → HELD → INJECTED → EMPTY（纯逻辑，依赖全注入）
src/runner.ts  IO：run-list 探测 + spawn `check --run --wait`、解 JSON
src/env.ts     检测：ORCA_TERMINAL_HANDLE 硬信号
src/format.ts  渲染：mail → 注入文本 + 系统提示词片段
```

## 开发

```bash
npm install
npm test     # tsc + node --test（31 个用例）
npm run lint
```

本地装进 pi：

```bash
pi install ./packages/orca-mail
```

## License

MIT

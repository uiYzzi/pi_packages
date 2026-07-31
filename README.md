# pi-packages

我的 pi 扩展合集。每个包一个目录，装到 pi 就能用。

## 现有的包

| 包 | 干什么 |
|---|---|
| [shroud](./packages/shroud/) | secret firewall。agent 能用你的 API key，看不到值 |
| [askpass](./packages/askpass/) | 弹掩码输入框收密钥，值直接进 env |
| [asroot](./packages/asroot/) | sudo 提权，密码走掩码输入框，agent 碰不到 |
| [secret-kit](./packages/secret-kit/) | askpass 和 asroot 共用的组件库 |
| [orca-mail](./packages/orca-mail/) | Orca 信箱自动推送，agent 不用 check --wait 阻塞轮询 |

## 装

```bash
pi install npm:@uiyzzi/pi-shroud
pi install npm:@uiyzzi/pi-askpass
pi install npm:@uiyzzi/pi-asroot
```

本地开发：

```bash
pi install ./packages/askpass
```

`pi install` 会写进 `~/.pi/agent/settings.json`，不用手动改。

## 目录约定

```
pi-packages/
  package.json        npm workspace 根
  packages/
    <package>/
      README.md
      src/
      test/
      package.json
      tsconfig.json
```

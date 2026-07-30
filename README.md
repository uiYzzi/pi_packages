# pi-packages

我的 pi 扩展合集。每个包一个目录，装到 pi 就能用。

## 现有的包

- [shroud](./packages/shroud/)：secret firewall。agent 能用 API key，但永远看不到值。
- [askpass](./packages/askpass/)：masked TUI secret prompt。agent 要密钥时弹掩码输入框，值直接进 env，不进上下文。

## 装

```bash
pi install npm:@uiyzzi/pi-shroud
```

本地开发：

```bash
pi install ./packages/shroud
pi install ./packages/askpass
```

`pi install` 会自动写入 `~/.pi/agent/settings.json`，不用手动改。

## 目录约定

```
pi-packages/
  README.md
  packages/
    <package>/
      README.md
      src/
      test/
      package.json
      tsconfig.json
```

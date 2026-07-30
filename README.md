# pi-packages

我的 pi 扩展合集。每个包一个目录，装到 pi 就能用。

## 现有的包

- [shroud](./packages/shroud/)：secret firewall。agent 能用 API key，但永远看不到值。

## 装

```bash
# 本地安装
pi install /Volumes/Data/git/pi_packages/packages/shroud

# 试跑
pi -e /Volumes/Data/git/pi_packages/packages/shroud
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

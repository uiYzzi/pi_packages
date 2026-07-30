# secret-kit

掩码输入组件和密钥处理工具，给 pi 扩展用的运行时库。[askpass](../askpass/) 和 [asroot](../asroot/) 共用。它自己不是扩展，直接 `pi install` 没效果。

## API

```typescript
import {
  MaskedInput,      // pi-tui Input 的子类，渲染成 •
  SecretPrompt,     // 弹窗组件：标题、副标题、掩码输入
  promptSecret,     // ctx.ui.custom 封装，返回 Promise<string | null>
  deriveName,       // "GitHub Token" → "GITHUB_TOKEN"
  isValidName,      // env 变量名校验
  scrubValues,      // 精确匹配清洗文本里的密钥值
  placeholderFor,   // 生成 «SECRET NAME redacted ...» 占位符
} from "@uiyzzi/pi-secret-kit";
```

### promptSecret(ctx, title, subtitle)

替换 TUI 的 editor 行，弹掩码输入框。Enter 返回值；Esc、空输入、非 TUI 模式都返回 `null`。值只活在调用方内存里，kit 不记，不写盘，不往外传。

### scrubValues(text, entries)

精确匹配替换。短于 4 字符的值跳过，防误伤常见子串。什么都没匹配到时返回 `undefined`，调用方走便宜路径。

## 装

```bash
npm install @uiyzzi/pi-secret-kit
```

消费方放进 `dependencies`。pi 装包走 `--omit=dev`，放 devDependencies 运行时找不到。

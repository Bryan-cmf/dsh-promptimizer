# dsh-promptimizer

**Prompt optimizer plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)** — one click rewrites your prompt into a professional spec, using the **currently selected model**.

一鍵提示詞優化插件：點擊 ✨優化，用**當前選中的模型**把你的提示詞改寫成專業規格。

## Features / 功能

- ✨ **One-click optimize / 一鍵優化** — sends your prompt to an OpenAI-compatible endpoint and replaces it with a restructured version
- 🔗 **Follows the model selector / 跟隨模型選擇器** — always optimizes with the model you've selected in the composer
- 🎚️ **Three strengths / 三檔強度** —
  - **Light 輕度**：keep your wording, make the deliverable explicit
  - **Standard 標準**：restructure into 任務/要求/驗收 (task / requirements / acceptance)
  - **Deep 深度**：full engineering spec — role, deliverables, constraints, edge cases, definition-of-done
- ↩️ **Click again to restore / 再點還原** the original prompt
- 🌐 **Any OpenAI-compatible endpoint / 任意 OpenAI 相容端點** — default `https://api.deepseek.com/v1`; point it at OpenAI / Moonshot / your own gateway via right-click → 🔑 settings
- 🫧 **Slow button pulse while working / 工作時按鈕緩慢脈動**；`Esc` cancels mid-flight；`⌘⇧E` / `Ctrl+Shift+E` shortcut
- 🈶 **zh / en UI auto-switch by system language / 中英隨系統語言自動切換**
- 🪶 **Native look / 原生樣式** — controls adopt the model selector's computed style at runtime (follows themes)
- 🛟 **Offline fallback / 離線降級** — no endpoint/key reachable? falls back to a deterministic rule-based rewriter, never dead-ends

## Install / 安裝

```bash
dsh plugin --profile <name> add github:Bryan-cmf/dsh-promptimizer
# or from a local clone:
dsh plugin --profile <name> add /path/to/dsh-promptimizer
```

First use: **right-click the ✨ button** (or the menu's 🔑 item) to open the settings panel — endpoint, API key, and an optional model override (empty = always follow the session's currently selected model). Stored in your browser's localStorage only.

首次使用：**右鍵 ✨ 按鈕**（或選單裡的 🔑 項）打開設定面板——端點、API key、可選的模型覆寫（留空 = 永遠跟隨 session 當前選中的模型）。只存在瀏覽器 localStorage。

## Verified against / 已驗證

DSH `0.2.0-rc.2` (macOS, web + desktop profiles). Soft-fail by design: if an upstream update changes the DOM, the plugin degrades to the official look instead of breaking the app.

## License

[MIT](./LICENSE) © Bryan-cmf

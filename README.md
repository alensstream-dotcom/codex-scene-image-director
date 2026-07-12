# 世界书生图静默救援器

正常链路：

```text
主模型 + JANIMA v7.9 单世界书 → 原位内联 Prompt → 静默救援插件 → 智绘姬真实按钮 → ComfyUI
```

插件默认不在对话中显示状态栏、工具栏或第二列，不占正文宽度。智绘姬按钮保留在 Prompt 的原生位置：Prompt 紧跟哪段剧情，按钮和生成图片就出现在哪段剧情下。

## 安装

在 SillyTavern 扩展管理器填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

然后：

1. 导入 `worldbooks/JANIMA_v7_9_worldbook.json`。它基于用户原版 v7.8.2，保留 FM_DNA、场景变量与 UpdateVariable，只替换冲突的主生图规则。
2. 关闭旧 v7.8.2 主世界书，避免两套规则同时生效；已有 FM_DNA 变量数据不用删除。
3. 导入 `regex/JANIMA_rescue_regex.json`。
4. 智绘姬标记设置为 `[` 和 `]`，关闭 LLM 扩写、正文二次分析、自动重写和自动风格。

## 后台行为

- 静默检查最新 assistant 回复，不向 `.mes` 追加任何可见插件节点。
- 自动规范标点、去重、明确的 `solo` 与缺失构图词；本地处理不调用 AI。
- 删除完全重复的 Prompt。
- 给真实 `.st-chatu8-image-button` 添加原位正常文档流布局，不新建替代按钮。
- 可选后台 AI 审计会补漏、删除低价值/错误图片 Prompt，并修复人数、服装、动作和地点冲突；失败不覆盖原文。

## 世界书选图原则

- 不按段落或字数硬凑图片。
- 普通剧情目标1张；第二个独立高价值镜头才出第2张；特别长且确有三个独立镜头时最多3张。
- 纯说明、纯心理、无画面过渡、普通男主走路/购物/站着为0张。
- 每个 Prompt 必须紧跟对应剧情，禁止堆到回复底部。

## 测试

```powershell
node --test tests/*.test.mjs
```

完整安装包：`JANIMA_worldbook_silent_rescue_v1_1_package.zip`。

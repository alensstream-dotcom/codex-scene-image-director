# 世界书生图救援器

SillyTavern 的轻量救援扩展。正常链路固定为：

```text
主聊天模型 → 世界书输出场景 Prompt → 本插件检查/按需修复 → 智绘姬传输 → ComfyUI 渲染
```

本插件不会在正常聊天时调用额外 LLM，不会自主选镜头，不扫描完整聊天，不读取长期记忆，也不改变绘图风格。0.7.0 的旧自主导演完整保留在 `pre-rescue-rebuild-0.7.0` tag 与 `master` 分支。

## 安装

1. 在 SillyTavern 扩展管理器中安装本仓库，或把目录复制到 `public/scripts/extensions/third-party/codex-scene-image-director`。
2. 导入 `worldbooks/JANIMA_worldbook_rescue_v1.json`，只启用这一本生图世界书。
3. 导入 `regex/JANIMA_rescue_regex.json`。
4. 在智绘姬中把开始/结束标记设为 `[` 和 `]`，关闭 LLM 扩写、智能分析、二次重写、自动改变角色和自动风格。
5. 在 ComfyUI/智绘姬正向预设中保留固定质量与风格词；世界书只写当前场景。

完整步骤见 `docs/installation.md` 与 `docs/migration-from-0.7.md`。

## 功能

- 只检查最新 assistant 消息的 `IMG_COUNT` 与图片 Prompt。
- 检查数量、中文、英文小说句、长度、重复、人数冲突和末尾堆叠。
- “本地补强”只规范标点、去重、补明确的 `solo` 与缺失构图词；绝不调用 API。
- “修复此 Prompt”“修复本轮”“补一张图”只有用户点击后才调用配置的 OpenAI 兼容 API。
- AI 失败时保留原文；缓存 key 为 `messageId + message content hash + original prompt hash + repair mode`。
- 智绘姬 2.7.7 适配使用源码与运行 DOM 核验过的 `.st-chatu8-image-button`；只有真实按钮出现才报告成功和点击。

## ComfyUI 原则

- 单人物工作流：`1girl, solo`，适合门口、沙发、坐姿、半身、室内日常。
- 双人物工作流：`2girls` 或 `1girl and 1boy`，建议使用区域提示或人物分区。
- 原图有白边时检查 latent 尺寸、padding、canvas、composite、outpaint；只有酒馆显示有白边时再检查智绘姬 CSS。
- 本插件不会修改 ComfyUI 工作流，也不会猜测智绘姬的工作流切换接口。

## 测试

```powershell
node --test tests/*.test.mjs
```

架构、智绘姬与验收详情位于 `docs/`。可直接导入的交付包为 `JANIMA_worldbook_rescue_v1_package.zip`。

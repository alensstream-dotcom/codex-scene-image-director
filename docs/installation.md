# 安装

1. 备份当前 SillyTavern 用户数据、旧世界书、旧正则和智绘姬设置。
2. 将插件目录安装到 `SillyTavern/public/scripts/extensions/third-party/codex-scene-image-director`，刷新酒馆。
3. 在世界书管理器导入 `worldbooks/JANIMA_worldbook_rescue_v1.json`。
4. 复制 `CHARACTER-DNA` 条目，为每个主要角色建立独立条目；维护英文身份、固定外貌、当前服装和 LoRA 触发词。
5. 在正则扩展中逐条导入 `regex/JANIMA_rescue_regex.json`。第三条 UpdateVariable 规则保持关闭。
6. 按 `zhihuiji-setup.md` 配置智绘姬。
7. 如需 AI 救援，在插件设置中启用 AI 修复，填写 OpenAI 兼容 API URL、Key、模型与 8～12 秒超时。不开启也可使用完整本地检查与补强。
8. 先运行 `node --test tests/*.test.mjs`，再用 20 个固定场景做真实模型回归。

不要同时启用旧自主生图插件和旧生图世界书。插件设置中的 AI 开关不影响正常聊天；只有点击“修复此 Prompt”“修复本轮”“补一张图”才会发请求。

手机端长按选择正文后会出现“补一张图 / 取消”。选区短期缓存 30 秒；如果系统选区消失，在 30 秒内点击仍可使用缓存，过期后重新选择。

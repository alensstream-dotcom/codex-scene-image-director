# JANIMA Galgame 自动CG v4

V4 使用一次独立的“导演调用”分析完整回复：主聊天结束后，以 `generateRaw` 将编号后的正文、当前角色卡和最近身份记忆发送给当前模型，并明确隔离世界书与角色扮演指令。导演只返回严格 JSON，插件再做前中后覆盖、镜头最小距离、NSFW 硬覆盖、人物/服装统一和 ComfyUI 生图。

这会比 V3 多一次模型请求，因此稍慢，但能解决镜头扎堆、世界书学院装污染、服装漂移以及“识别到 NSFW 却仍生成普通图”的问题。

---

# JANIMA Galgame 自动CG v3

面向手机 SillyTavern + 电脑局域网 ComfyUI 的单插件自动生图系统。不依赖世界书、智绘姬、生图正则，也不依赖酒馆后端代理路由。

## V3 为什么重构

V2 虽然已经能稳定连接 ComfyUI、轮询结果并把图片放进消息气泡，但仍然存在根本问题：

- 先把剧情拆成 `action / setting / expression`，再由插件重新拼 Prompt，容易丢失场景重点。
- 本地规则与模型分镜混合评分时，可能让普通动作抢掉真正重要的后半段剧情。
- NSFW 只做“加分”不够，必须做硬覆盖。
- 固定正负面词只能改善画质和错误，不能替代正确的镜头选择。

V3 保留已经验证可靠的 ComfyUI 直连、任务队列、历史轮询、段落插图、失败重绘和状态持久化；只推翻分镜与 Prompt 生成层。

## V3 工作方式

1. 插件向当前主模型注入不可见的 V3 分镜协议，不增加第二次 LLM 请求。
2. 主模型先写完整可见剧情，再从整条回复中挑选 3–5 个最值得画的瞬间。
3. 主模型为每个镜头直接写一份完整英文场景 Prompt，不再输出碎片字段供插件二次拼接。
4. 所有镜头集中在回复末尾的一个隐藏 `JANIMA_V3` JSON 注释中。
5. 插件验证锚点确实存在于可见剧情中，拒绝不存在的剧情和中文生图 Prompt。
6. 后半段成人 NSFW/explicit 阶段执行硬覆盖：只要存在，必须占用 CG 名额；多个不同阶段在 5 张上限内尽量分别覆盖。
7. 主模型分镜不足或格式无效时，本地规则才负责补缺，不再与正常模型镜头争夺主导权。
8. 插件仅把固定正面词、固定负面词与主模型的完整场景 Prompt 合并，然后直接提交 ComfyUI。
9. 图片继续按 `messageId + paragraphIndex` 插入对应剧情段落下方。

## 图片数量

- 普通实质回复：3 张
- 长回复、换装、换地点、战斗推进或亲密推进：4 张
- 长篇多阶段剧情，或存在两个以上成人 explicit 阶段：5 张

不会用普通站姿、纯对话、空景或单男主图强行凑数。后面的高价值镜头会替换前面的低价值镜头。

## 成人剧情规则

V3 不再把 NSFW 当作普通“优先级加分”。

- 只要可见回复出现明确成年人的 NSFW/explicit 事件，至少一张图必须来自该阶段。
- 脱衣、口交/手交、插入、体位变化、高潮、事后依偎等不同阶段会在图片上限内分别保留。
- 检测到明确未成年证据时，不生成成人图片。

## 固定正负面提示词

插件设置中保留可编辑的：

- 固定正面提示词：控制画质、风格、线条、构图和整体稳定性。
- 固定负面提示词：控制错手、错脸、错衣服、拼图、白边、文字、水印等错误。

剧情相关性主要由 V3 直接分镜 Prompt 决定，固定词不会替代剧情描述。

## 安装与更新

在 SillyTavern 的“扩展 → 安装扩展”中填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

已安装时，在扩展管理中点击更新并彻底刷新酒馆。扩展设置标题应显示：

```text
JANIMA Galgame 自动CG v3.0.0
```

旧回复保存的 V2 图片不会自动重做。请用一条全新的回复测试 V3，或在控制台运行：

```js
JANIMA_AUTO_CG.processLatest()
```

每张图片下方可展开查看：

- 主模型直出还是本地补漏
- 取材剧情
- 镜头类型、安全级别和优先级
- 主模型原始场景 Prompt
- 最终提交给 ComfyUI 的正负面 Prompt

## 手机直连 ComfyUI

`ComfyUI 地址` 必须填写电脑局域网地址，例如：

```text
http://192.168.1.12:8188
```

电脑启动 ComfyUI 时需要允许局域网和跨域访问，例如：

```text
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header "*"
```

插件连接测试依次尝试：

```text
/system_stats
/system/stats
/object_info
```

生图使用原生：

```text
POST /prompt
GET /history/{prompt_id}
GET /view
```

## 默认 JANIMA 工作流

- UNet：`JANIMA_v10.safetensors`
- CLIP：`qwen_3_06b_base.safetensors`
- VAE：`qwen_image_vae.safetensors`
- Turbo LoRA：`anima-turbo-lora-v0.2.safetensors`
- 分辨率：768×1024
- 8 步、CFG 1、Euler、normal

模型文件名、固定正面词和固定负面词均可在扩展设置中修改。

## 测试

GitHub Actions 自动执行：

```bash
node --check index-v3.js
node --check lib/director-v3.mjs
node --test tests/*.test.mjs
```

V3 测试覆盖：

- 单一隐藏 JSON 分镜解析
- 不存在的剧情锚点拒绝
- 中文或过度空泛 Prompt 拒绝
- 3–5 张动态数量
- 后半段 NSFW/explicit 硬覆盖
- 木剑教学、厨房烹鱼等实机同类剧情的本地补漏
- 固定正负面词合并
- ComfyUI 提交、历史轮询和段落定位

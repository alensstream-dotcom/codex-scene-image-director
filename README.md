# JANIMA Galgame 自动CG v2.5

面向手机 SillyTavern + 电脑局域网 ComfyUI 的单插件自动生图系统。不依赖世界书、智绘姬、生图正则，也不依赖酒馆后端代理路由。

## v2.5 的工作方式

1. 插件向当前主模型注入不可见分镜协议，不增加第二次 LLM 请求。
2. 主模型写完完整回复后，从整条回复中挑选 3–5 个最有价值的视觉镜头。
3. 后半段 NSFW/explicit 阶段优先于前面的普通对话，不会再被前三个普通镜头占满名额。
4. 每个隐藏分镜必须携带完整英文 Prompt：人物、当前衣着、动作/接触、地点、道具、表情、构图和光线。
5. 插件同时用本地剧情规则补漏，再按同一剧情段落合并、评分和排序。
6. 手机浏览器直接调用 ComfyUI 原生 `/prompt`、`/history/{prompt_id}` 和 `/view`。
7. 图片按 `messageId + paragraphIndex` 插入对应剧情段落下方。

## 关键修复

- 不再把当前角色卡外貌强塞给其他剧情人物。
- 只有选中段落或 cast 明确出现当前角色卡的准确名字时，才允许使用角色卡外貌。
- 古风/武侠剧情会生成汉服、传统房间、庭院、湖心亭、古琴、木剑、真剑、剑招等对应标签。
- 古风场景自动排除西式红色军装、披风、肩章、未来盔甲、现代校服和欧式宫殿。
- 图片数量按剧情在 3–5 张之间变化：普通实质回复 3 张，较长或有场景/服装/亲密变化时 4 张，多阶段成人剧情或超长回复 5 张。
- 每张图片下方可以展开“查看取材剧情与实际提示词”，直接检查插件选了哪段、提交了什么 Prompt。

## 安装与更新

在 SillyTavern 的“扩展 → 安装扩展”中填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

已安装时，在扩展管理中点击更新并彻底刷新酒馆。扩展设置标题应显示 `v2.5.0`。

## 手机直连 ComfyUI

`ComfyUI 地址` 必须填写电脑的局域网地址，例如：

```text
http://192.168.1.12:8188
```

不要填写手机端的 `127.0.0.1` 或 `localhost`。

电脑启动 ComfyUI 时需要允许局域网和跨域访问，例如：

```text
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header "*"
```

插件连接测试会依次尝试：

```text
/system_stats
/system/stats
/object_info
```

## 默认 JANIMA 工作流

- UNet：`JANIMA_v10.safetensors`
- CLIP：`qwen_3_06b_base.safetensors`
- VAE：`qwen_image_vae.safetensors`
- Turbo LoRA：`anima-turbo-lora-v0.2.safetensors`
- 分辨率：768×1024
- 8 步、CFG 1、Euler、normal

模型文件名、固定正面提示词和固定负面提示词均可在扩展设置中修改。

## 测试

仓库使用 GitHub Actions 自动检查：

```bash
node --check index-v2.5.js
node --check lib/scene-grounding.mjs
node --test tests/*.test.mjs
```

测试覆盖 ComfyUI 直连、历史轮询、段落定位、3–5 张自适应策略、NSFW 优先级，以及与实机录像同类的木剑、真剑、湖心亭和古琴场景。

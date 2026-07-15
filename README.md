# JANIMA Galgame 自动CG v2.3

面向手机 SillyTavern + 电脑局域网 ComfyUI 的单插件自动生图系统。不依赖世界书、智绘姬、生图正则，也不依赖酒馆不存在的 `/api/sd/comfy/...` 代理路由。

## 工作方式

1. 插件在主模型请求中注入不可见的分镜协议，不发起第二次 LLM 请求。
2. 主模型照常写剧情，在有价值的女性剧情段落后附加不可见分镜数据；模型漏写时才使用本地规则选取 1–2 个镜头。
3. 回复结束后，插件把分镜转换成 JANIMA/Anima 提示词。
4. 手机浏览器直接向电脑 ComfyUI 提交原生 `POST /prompt` 请求。
5. 插件轮询 `GET /history/{prompt_id}`，再用 `/view` 显示生成结果。
6. 每张图按 `messageId + paragraphIndex` 插入对应消息段落下方；找不到段落时也只会追加到该消息气泡内部，不会跑到聊天底部。

普通回复目标是 1 张主 CG，只有动作、地点、服装或阶段真正变化时才增加到 2–3 张。纯男性、空景、建筑和纯道具不生图。

## 安装

在 SillyTavern 的“扩展 → 安装扩展”中填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

刷新酒馆后打开“JANIMA Galgame 自动CG”。

## 手机直连 ComfyUI

插件请求发生在手机浏览器中，因此 `ComfyUI 地址` 必须填写电脑的局域网地址，例如：

```text
http://192.168.1.12:8188
```

不要填写手机端的 `127.0.0.1` 或 `localhost`。

电脑启动 ComfyUI 时需要允许局域网和跨域访问，例如：

```text
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header "*"
```

然后在插件设置中点击“检测 ComfyUI”。插件依次尝试：

```text
/system_stats
/system/stats
/object_info
```

连接测试成功后即可正常聊天。

## 默认 JANIMA 工作流

- UNet：`JANIMA_v10.safetensors`
- CLIP：`qwen_3_06b_base.safetensors`
- VAE：`qwen_image_vae.safetensors`
- Turbo LoRA：`anima-turbo-lora-v0.2.safetensors`
- 分辨率：768×1024
- 8 步、CFG 1、Euler、normal

这些文件名都可以在扩展设置里修改。工作流使用 ComfyUI API JSON 的标准节点链：UNET/CLIP/VAE 加载、LoRA、CLIPTextEncode、EmptyLatentImage、KSampler、VAEDecode、SaveImage。

## 本次修复

- 删除 `/api/sd/comfy/ping` 和 `/api/sd/comfy/generate`。
- 改用 ComfyUI 原生 `/prompt`、`/history/{prompt_id}`、`/view`。
- 增加提交、轮询、超时、恢复和明确错误显示。
- 删除 DOM 纯文本 quote 注入；图片位置改为段落索引。
- 失败时显示具体错误，可在原位置点击“重绘”。
- 关闭伪“角色参考图”img2img 链路，避免上一张构图污染当前剧情。
- 保留同一次主回复中的隐藏分镜协议，不增加额外模型等待。

## 测试

```bash
node --test tests/*.test.mjs
```

测试覆盖：原生 ComfyUI 提交、Ping 端点回退、历史轮询、图片 URL 构造、剧情段落拆分和段落定位。

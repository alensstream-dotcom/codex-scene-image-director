# JANIMA Galgame 自动CG v2

一个面向手机酒馆的单插件自动生图系统。它不依赖世界书、智绘姬、数据库脚本或生图正则。

## 它如何工作

1. 插件把一份不可见的镜头协议注入当前主模型请求。
2. 主模型照常写剧情；遇到真正值得画的女性剧情瞬间时，在该段后附加不可见的 `JANIMA_CG` 数据包。
3. 数据包在同一次流式回复中闭合后，插件立刻通过 SillyTavern 自带的服务端代理提交 ComfyUI。没有第二次 LLM 请求。
4. 对应剧情下方立即出现图片槽。正文仍继续生成，输入框也不会被图片队列锁住。
5. 图片完成后自动替换图片槽；刷新电脑或手机页面后仍从聊天数据恢复。

默认策略是普通回复 1 张主CG，只有动作、地点、服装或成人阶段真正变化时才增加到 2–3 张。连续同一动作不会重复生图；纯男性、空景、建筑和道具不会生图。

## 当前电脑默认配置

- ComfyUI：`http://192.168.1.12:8188`
- 模型：`JANIMA_v10.safetensors`
- 文本编码器：`qwen_3_06b_base.safetensors`
- VAE：`qwen_image_vae.safetensors`
- 加速 LoRA：`anima-turbo-lora-v0.2.safetensors`
- 画布：768×1024
- 8 步、CFG 1、Euler、normal

## 安装

在 SillyTavern 的“扩展 → 安装扩展”中填写：

```text
https://github.com/alensstream-dotcom/codex-scene-image-director.git
```

刷新一次酒馆，打开扩展设置中的“JANIMA Galgame 自动CG”，点击“检测 ComfyUI”。之后正常聊天即可。

旧版迁移时请关闭 JANIMA v8.x 生图世界书和智绘姬的方括号扫描，避免旧规则继续让主模型输出第二套 Prompt。v2 本身不会读取或修改它们。

## 手机使用

手机只需打开电脑酒馆地址，不要把 ComfyUI 地址改成手机的 `localhost`。浏览器把生图请求发给酒馆，酒馆服务器再访问同一局域网内的 `192.168.1.12:8188`，因此没有手机跨域或本机地址错误。

## 可靠性边界

- 插件只通过酒馆保存接口写扩展设置和聊天数据，不直接改 `settings.json`。
- ComfyUI 离线或工作流报错只会让原位图片槽显示“重绘”，不会阻止酒馆启动或继续聊天。
- 成人镜头不会因 `nsfw` 标签被屏蔽；涉及成人内容时必须能从角色 DNA 中确认所有参与者为成年人。

## 测试

```powershell
node --test tests/director-core.test.mjs tests/anima-direct-workflow.test.mjs
```

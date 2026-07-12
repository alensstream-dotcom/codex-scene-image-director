# 智绘姬设置与真实链路

已针对本机 st-chatu8 2.7.7 核验：消息内真实生成按钮类名为 `.st-chatu8-image-button`，加载态为 `data-loading="true"`。

## 推荐设置

- 启用插件，模式选择 ComfyUI。
- 开始标记：`[`；结束标记：`]`。
- 关闭智绘姬 LLM 扩写、智能分析正文、二次重写 Prompt、自动改变角色、按剧情切换风格。
- 固定正向词放在智绘姬或 ComfyUI，例如：`masterpiece, best quality, highres, anime illustration, clean lineart, detailed eyes, detailed clothing, natural pose`。
- 固定负面词可用：`worst quality, low quality, blurry, lowres, bad anatomy, bad hands, extra fingers, missing fingers, duplicate, cloned face, multiple views, split screen, comic panel, collage, frame, watermark, text, logo`。
- 不要把 `second girl` 永久加入全局负面；真正双女场景需要它。

## 救援器调用流程

1. 规范 `[prompt]` 已存在于消息或被插入对应段落。
2. 救援器发出 SillyTavern `MESSAGE_UPDATED`，请求消息重新渲染。
3. 等待智绘姬扫描。
4. 只检查消息内 `.st-chatu8-image-button`。
5. 找到后记录真实元素与 route；“立即生图”调用该元素 `click()`。
6. 未找到则显示错误，不触发未知自定义事件，不报告假成功。

如果智绘姬升级后按钮类名变化，先在真实 DOM 和上游源码重新核验，再更新适配；不要加入宽泛文本按钮猜测。

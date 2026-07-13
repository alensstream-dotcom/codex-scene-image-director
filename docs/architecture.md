# 架构

```text
主聊天模型
  → JANIMA v8.2 手机 Galgame 分镜世界书（保留 FM_DNA/变量体系）
  → 剧情段落 + 紧随其后的 [English prompt] + IMG_COUNT
  → 静默救援器（剧情窗口 + 女性门禁 + 身份 DNA，不渲染对话 UI）
  → 智绘姬原生按钮
  → JANIMA Galgame Turbo 8 步实时工作流
```

## 世界书

v8.2 恢复 v7.8.2 的“上一张图之后”取材窗口，并保留 v8.1 身份锁。每个窗口选择实际发生的最佳女性画面；纯男性、纯场景、纯建筑和纯道具不出图。正常含女性剧情目标3张，独立高价值 beat 增加到4–6张，硬上限6张。每张 Prompt 重复可见角色固定脸、头发、眼睛、体型与未变化服装；多人分别描述并定位。

## 静默插件

插件只读取最新 assistant 消息，解析 Prompt、段落位置与 `IMG_COUNT`。它会删除旧版残留的 `.janima-rescue-panel`，从不向消息容器追加状态栏、工具栏或第二列。

快速路径不在按钮创建后改写 Prompt：st-chatu8 会把 Prompt 捕获在点击监听器闭包中，事后只改 `data-*` 会造成界面与实际 ComfyUI 载荷不一致。模型原生质量块、人物人数、接触对象和身份 DNA 都由世界书在回复生成时写好；插件删除完全重复 Prompt，隐藏纯男/纯场景、人数冲突、身份锚点缺失、关键道具错误和载荷不一致的按钮。缺图兜底仍可按“上一张图片后到插入点”的完整剧情插入新 Prompt；默认关闭已有 Prompt 的二次模型改写与逐图深度重审。

JANIMA 是 Anima 架构而不是 SD1.5/SDXL UNet，不能直接套用经典 IP-Adapter 工作流。角色连续性由完整逐图 DNA 保持；生成端恢复用户原有 Turbo LoRA，以 8 步实时出图，符合 Galgame 连续游玩的优先级。

## 按钮原位

st-chatu8 2.7.7 会按 Prompt 在原始回复中的字符位置创建 `.st-chatu8-image-button`。v8.2 强制 Prompt 紧跟所选剧情；插件只给真实图像 Prompt 按钮和其原生父节点添加正常文档流样式，并在智绘姬误判生成结束时唤醒其原生 DOM 重扫。对 `[Unnamed Persona]` 与 JSON Patch 数组等误生成按钮会静默隐藏。

## 可选后台 AI 审计

启用后，每轮只发送当前 assistant 回复、已有 Prompt 位置、`IMG_COUNT` 与相关角色 DNA。AI 只能返回删除、替换或在指定段落后插入 Prompt 的 JSON 补丁，不能重写剧情。解析、结构验证全部成功才写回；任何失败均保留原文。

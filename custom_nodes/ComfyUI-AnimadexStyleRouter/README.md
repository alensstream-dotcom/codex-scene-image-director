# Animadex 画风白名单路由

这是一个独立的 ComfyUI 字符串节点。每张图的提示词决定该图的画风 LoRA，节点不读取或修改酒馆设置，也不加载模型文件。

固定使用 Harem 主模型的工作流中，只连接画风加载器：

1. 原正向提示词 → `AnimadexStyleRouter.prompt`。
2. `clean_prompt` → 正向 CLIP 编码器。
3. `lora_name` → 现有 `Anima2BTo29BLoraLoaderModelOnly` 画风加载器的 `lora_name`。
4. `strength` → 同一画风加载器的 `strength_model`。它是 **FLOAT** 输出。
5. 保持主模型、加速、质量、人物和体态等其它 LoRA 的连接与参数。

| 画风 | 可用控制词（大小写不敏感） | 固定文件 | 强度 | 保留或补入的实际训练触发词 |
| --- | --- | --- | ---: | --- |
| Mikko | `@Mikko`、`@mikkoani` | `CodexAnima\anima-mikkoani-v3.1.safetensors` | 0.55 | `@mikkoani` |
| BlueArchive | `@BlueArchive`、`@BlueArchStyle` | `BlueArchiveStyleB1.safetensors` | 0.75 | `@BlueArchStyle` |
| RDBT | `@RDBT` | `CodexAnima\rdbt_v2.1_base_anima_b1_lora.safetensors` | 0.85 | 无 |
| PC98 | `@PC98` | `CodexAnima\pc98gal_style-v0.1.safetensors` | 0.35 | `pc98gal_style` |

也支持 `@style:Mikko`、`@style:BlueArchive`、`@style:RDBT`、`@style:PC98`，以及表中其它别名的 `@style:` 写法。

提示词中没有已识别的控制词时，使用节点的 `default_style`。有多个控制词时，**最后一个已识别控制词优先**；节点清除其它已识别画风词，只保留或补入选中画风的训练触发词一次。普通的 `pc98gal_style` 训练标签已有时不会重复添加。

例如：

```text
输入：@Mikko, yor briar, red eyes, full body, @PC98
输出：pc98gal_style, yor briar, red eyes, full body
加载：CodexAnima\pc98gal_style-v0.1.safetensors，强度 0.35
```

控制词应独立使用，前后用空白、逗号或括号等分隔。支持中文逗号、句号与顿号作为终止符。单个英文句末句点在后面紧跟空白或输入结束时也支持，例如 `@PC98.`；`@PC98..`、`@PC98.,` 与 `@PC98/path.` 不会误识别为控制词。

未知 `@标签` 原样保留，不能变成文件路径；URL、邮箱和单词中间的 `@` 不会触发路由。白名单以外的路径与标签不参与加载。`<lora:...>`、`<wlr:...>` 和成对的 `<lora>...</lora>` / `<wlr>...</wlr>` 保留原文，交给原来的处理链处理。

`report` 输出 JSON，记录选择来源、已识别控制词数、未知控制词数、实际文件与强度。文件不存在时应由下游加载器明确报错，节点不会另找文件或悄悄改变其它 LoRA。

## 生图尺寸预算

同包提供 `AnimadexCanvasBudget`，用于将酒馆世界书请求的画布尺寸转为已选的固定预算。`requested_width` 和 `requested_height` 是 INT 输入，默认 704 与 1152，允许 64～8192。

| 请求比例 | 实际生图 width × height | 最终 output_width × output_height |
| --- | --- | --- |
| 高/宽 ≥ 1.15 | 704 × 1152 | 880 × 1440 |
| 宽/高 ≥ 1.15 | 1152 × 704 | 1440 × 880 |
| 其它接近方形的比例 | 896 × 896 | 1120 × 1120 |

例如世界书请求 1024 × 1536，工作流实际采样使用 704 × 1152，再由现有放大节点输出 880 × 1440。连接 `width`、`height` 到潜空间尺寸，连接 `output_width`、`output_height` 到原来的最终尺寸节点。四项输出都是 INT。节点只返回数值，不处理图像；这是按方向选择预设比例，会改变与预设不一致的原请求比例。

## 可选的精确角色 LoRA

`AnimadexCharacterRouter` 仅路由已实测的妮露角色 LoRA。输入为 `prompt` STRING（multiline、forceInput），输出依次为 `clean_prompt` STRING、`lora_name` STRING、`strength` FLOAT、`report` STRING。

只有独立的 `@character:Nilou`（大小写不敏感）会选择 `CodexAnima\Nilou-V2-E12.safetensors`、强度 0.4，并移除这个控制词。真实 `nilou genshin` 训练触发词由身份模块注入，路由节点不会补入或改写角色身份。

没有该控制词时仍输出同一个固定文件，强度为 0，避免空路径。未知 `@character:...` 保留为原文，绝不成为文件名。当提示词混入多个角色请求时，最后一个独立 `@character:` 请求决定是否启用；末尾是未支持的角色请求会禁用前面的妮露请求，避免把妮露 LoRA 错用在其它人物身上。风格与 `<lora>/<wlr>` 控制词由原来的处理链负责。

**仅在人物确实是妮露本人时启用。原创人物只是借用了妮露的外貌原型时，不能套用妮露角色 LoRA。** 目前没有其它已验证的角色绑定。将该节点的文件和强度输出只连接到可选人物 LoRA 加载器，保留其它 LoRA 的参数。

安装时将本文件夹放到 ComfyUI 的 `custom_nodes`，在队列空闲时重启 ComfyUI。没有额外 Python 依赖。当前交付只创建工作区源文件，未安装到正在运行的 ComfyUI，也未重启。

运行边界测试：

```text
python -m unittest discover -s tests -v
```

# 绘图策略集中与完整路径清单（v2.3.2）

本清单覆盖当前仓库的自动生图、选段 / 动作重绘、原生格式兼容、数据库构建，以及历史解析样本。按关键词扫描源文件后逐项读调用点；生成数据里的标签、注释里的单词和函数名本身不算执行拦截。本清单不能判断远端模型或用户以后导入的工作流内部行为。

## 可以复制的单文件

[drawing-policy.mjs](drawing-policy.mjs) 没有插件、宿主或数据库 import。复制它并从自己的代码 import 所需函数即可；它不会自动接管请求，调用方仍要传入年龄、人物特征或标签分类信息。

| 定义 | 作用 | 当前调用方 |
| --- | --- | --- |
| ageGroup | 外观年龄层，young 包含 13～29 岁，不能代替是否成年判断 | narrative-appearance.mjs |
| isMinorAppearance、protectStoryTraits | 保留原有判定语义，在剧情事实路径删除未成年胸型特征 | narrative-appearance.mjs |
| protectIdentityTags | 未绑定身份路径抑制 bust/build 分类标签；不改其他标签和顺序 | identity.mjs |
| isYouthAppearance | 选择人物描述中的年龄用词，不推断未知数值年龄 | compact-prompt.mjs |
| CONTENT_TAG | 编译提示词使用的 SFW 标签 | scene-planner.mjs、native-prompt.mjs、native-ai-profiles.mjs |
| nativeBodyVisibility、nativeBodyField、字段常量 | 旧格式 sfw/hidden 值和 SFW/NSFW 字段结构 | native-prompt.mjs、identity.mjs、native-manager.mjs、catalog.mjs |
| SUPPORTED_INTERACTIONS、INTERACTION_EVIDENCE | 互动类型白名单与对应证据表达式 | interaction-frame.mjs；镜头和人物归属仍在那里执行 |
| RENDER_POLICY | 既有主体和互动说明文字 | render-policy.mjs 兼容再导出 |
| CATALOG_PREVIEW_POLICY | 离线预览池的排除标签和已知儿童角色 ID | scripts/expand_v211_catalog.py 用 Node 读取同一份定义 |

离线 Python 扩池脚本需要可执行的 Node，可单独运行 node drawing-policy.mjs --export-catalog-policy 检查输出。本次没有重建数据库或改变既有候选池数据。字段名包含 NSFW 只代表兼容结构，不代表插件会添加或执行后端审查。

## 世界书中的模型边界

默认完整书的内容边界只有 3 条模型指令及 1 条执行说明，界面置顶。自动互动条目中分散的成年范围，以及衣装协议中分散的 No graphic content 已并入置顶边界条目；必要 JSON 字段和镜头词没有删去。

- auto.safety：自动插图范围、环境替代及支持的成年双人互动范围。
- manual.facets：特征字段格式和未成年衣着 / 胸型保护。
- manual.safety：选段插图范围、环境替代及双人互动边界。
- engine.reference：说明执行代码、离线筛选和后端范围，不发送模型。

worldbook-protection.json 是这 4 条的可复用默认导出。真实用户修改可在界面用「导出内容边界条目」导出。导入后保留适用阶段；模型指令和执行代码不是同一层，修改世界书不会关闭执行策略。

## 会改变 tags、人物或画面，但属于业务处理的地方

这些处理保持在原业务模块；集中策略没有将它们关闭。复制 drawing-policy.mjs 不会自动复制这些流程。

| 模块 / 入口 | 实际作用 |
| --- | --- |
| character-tools.mjs / sanitizeAppearanceText | 清掉与已保存外貌冲突的头发、眼睛、体型等动作片段；用于自动场景。 |
| identity.mjs / 角色解析 | 区分固定外貌、衣装、非人体附属物与发型冲突，按当前绑定策略生成稳定人物。年龄相关标签抑制已调用集中模块。 |
| compact-prompt.mjs / compactTags、compactActor | 去重复、精简冗余五官和动作、限制标签数量；动作部分排除固定外貌，不是成人关键词黑名单。 |
| scene-planner.mjs / compileScene | 场景、动作与固定外貌拆开；局部镜头只保留可见衣装；防止双人动作归属给自己；SFW 标记改为读取集中定义。 |
| native-prompt.mjs / transientDescription、sanitizeNativePrompt | 旧格式里避免重复外貌和衣装、替换对应人物 / 衣装引用、清掉格式控制符。 |
| render-policy.mjs / focusFrame | 女性主体偏好、无必要男性陪衬省略、环境镜头、互动和视角清理；不关闭这些构图流程。 |
| interaction-frame.mjs | 校验互动对象、支持的类型、证据、视角与可见部位，组织双人动作；类型和证据定义已集中。 |
| wardrobe-state.mjs、wardrobe.mjs | 衣装状态与可见部位处理，明确 removed 不作为身上衣物，不把缺失事实当脱下。 |
| manual-result.mjs、manual-scene.mjs | 接受已知字段变体，真正缺少数据 / 拒绝时停止，姓名必须能在剧情中确认；不通过捏造 tags 绕过错误。 |
| scene-planner.mjs / validateConfirmedPrompt | 限制控制代码、结构、人物数量和长度，属于数据协议验证。 |
| workflow-library.mjs、comfy-transport.mjs | 校验工作流、参考文件路径、尺寸和占位符；负面提示词采用配置，未另加成人排除词。 |

## 离线数据与历史文件

- catalog-source/tools/taxonomy.py：把源标签分类，包括 demographic/age_evidence、context/sensitive。分类结果保留源标签；这不是运行时图片请求过滤器。
- catalog-source/tools/build_catalog.py：记录 sensitive_context_in_source 标记；普通默认衣装资格排除内衣、泳装、颜色歧义，相关衣装仍可作为明确类别选择。
- catalog-source/tools/profile_filter.py：按已生成的默认资格和外貌质量选择数据配置。
- scripts/expand_v211_catalog.py：候选池排除定义已集中，原来的图片存在、源隐藏标志、女性及外貌完整度条件继续由脚本执行。
- catalog-source/tools/query_catalog.py：离线查询输出的 upperBodySFW/fullBodySFW 是旧格式字段名。
- native-ai-profiles.mjs：旧智绘姬兼容模板，标签值读取集中定义；本独立插件的自动 / 选段路径不以这些模板为入口。
- fixtures/chatu8-parser.original.js：未改动的历史解析测试样本，含 sfw/nsfw 分支，未安装到运行包。
- compat/shujuku/index.js：可选历史 SP 数据库适配中的原提示文字，独立绘图入口不调用其世界书提示模板。
- data/、catalog-source/source/：原始和编译数据标签，不能将其中出现的词等同于运行时屏蔽规则。

## 后端范围与复制后的接入

comfy-transport.mjs 向 /prompt 提交工作流和 client_id。扫描本插件运行代码及自定义 Python 节点，没有发现 enable_safety_checker、nsfw_filter、safety_checker 或 disable_safety 专用开关。不能由此断言 ComfyUI、模型或任何以后导入的工作流必定有审查功能。

推荐按以下顺序接入：读取明确人物事实 → protectStoryTraits / protectIdentityTags → 固定外貌和衣装绑定 → 镜头及动作组织 → 编译 CONTENT_TAG 与提示词 → 将用户工作流交给后端。各函数保留既有语义，没有将未知年龄默认判为成年，也没有实现完整的年龄识别器。SFW 是提示词，不是确定性的图片内容检测。

选段与自动共享动作、构图、光线、环境和标签指导，分别保留 ADCAP 与单帧 JSON 协议。导入分享书的文本不会自动翻译另一套输出协议；在保存前把冲突的格式条目修改或限定到正确阶段。

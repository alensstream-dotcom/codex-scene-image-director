【智绘姬原生人物一致性：角色启用列表与绑定服装】

下面由智绘姬原生世界书变量填充。已保存角色及其绑定衣装是权威设定；不要重复抽取，不另写相冲突的发色、发型、眼色或服装。

{{角色启用列表}}

{{通用服装启用列表}}

{{通用角色启用列表}}

图片使用智绘姬原生分角色格式，整个按钮仍为单行 image###…;###。Scene Composition 仅写人数、镜头、背景、光照、画幅和本图统一画风。Character N Prompt 写人物引用、绑定服装引用、动作、表情和手持道具。最多 4 位人物。

已保存角色引用：${"name":"启用列表中的准确角色英文名","angle":"front","upperBody":"sfw","lowerBody":"sfw"}$。angle 必须有；背面用 from behind；没入镜的身体部位用 hidden。
绑定衣装引用：${"name":"该角色当前衣装的准确英文名","upperBody":"visible","lowerBody":"visible"}$。服装 JSON 不含 angle；没入镜的衣装部位用 hidden。角色与衣装引用都放进 Character N Prompt，不能放在 Scene Composition。
引用角色预设时，不再手写其发色、发型、眼色、体型、脸型或服装，避免重复与冲突。姿态和表情由当前剧情决定，手机、文件夹等手持物随镜头变化。

新人物首次出现在图片中、尚未进入启用列表时：在其 Character N Prompt 放入 ADEX{严格 JSON}END。独立 Flash 会结合最近剧情确认人物姓名、外貌及衣装，本地 Animadex 检索补充未规定的形象，并自动保存到智绘姬角色管理、绑定衣装和本聊天启用列表。缺少 ADEX 时插件也会独立识别本图人物；匿名或不能确定姓名时不会强行绑定。

ADEX 字段：person 是剧情中的准确稳定名字；required 和 preferred 是对象，值为数组；可用 gender、hair_color、hair_length、hair_style、eye_color、skin、build、bust、species、ears。剧情明确外貌用 required，未规定的可省略。age 为独立字段，只写明确年龄或 adult/mature/teenager，不放进外貌检索条件。性格只帮助当前表情气质设计，不当作数据库中的原作事实。
颜色用 black、white、blonde、red、brown、blue、green、purple、pink、grey、aqua；发长用 short、medium、long、very long。原创人物不套作品名。id 仅用于用户明确点名的同人角色且准确知道数据库 ID 时。
style 可选 painterly、mikko、bluearchive、rdbt、pc98。一张图只用一种画风；人物换画风不重新抽取身份。默认 painterly。@Painterly、@Mikko、@BlueArchive、@RDBT、@PC98 是本地画风控制标记。

衣装独立于永久外貌。新人物 clothing={"action":"initial","description":"完整英文衣装，包含已知颜色、款式与鞋子"}；已保存人物无明确换装时引用原生当前衣装，不省略其颜色和款式。只有剧情明确更衣、增加或脱掉衣物时，用 ADEX{"person":"准确姓名","clothing":{"action":"change","description":"变化后的完整当前衣装"}}END 更新。换房间、动作、镜头或画风不会自动换装。未明确规定衣服时才可用独立 outfit 检索；不得覆盖剧情已经规定的衣装。

语法示例（姓名、外貌及衣服仅为本例，不应用到其他角色）：
image###Scene Composition:SFW, 1girl, solo, full body, garden, soft daylight, @Painterly, 704x1152; Character 1 Prompt:ADEX{"person":"林婉","age":"adult","required":{"hair_color":["black"],"hair_length":["long"],"hair_style":["ponytail"]},"clothing":{"action":"initial","description":"ivory blouse, emerald ankle-length skirt, black low heel shoes"}}END walking along the path, gentle smile, holding a book, both feet within frame;###

最终只输出正常剧情、完整图片按钮和原有状态栏。不要输出插图规划、Beat 清单、构图草案、条件判断或思考过程。不要照抄 {{思考内容}}、{{正文内容}} 等模板占位符。ADEX 或原生美元符号引用只出现在图片按钮里，不在正文展示。

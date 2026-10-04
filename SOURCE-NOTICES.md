# 来源与保留说明

本目录为 2026-09-30 制作的本地数据整理成果。角色标签没有由辅助模型编造；原始快照未修改。

1. **Animadex 角色快照**：`wrt122311/ComfyUI-Animadex-Node`，提交 `880be2a460dce1ffde15e9719313886e072fcdcc`，文件 `animadex_top_characters.json`。该仓库 README 将数据来源写为 Animadex 官网，并将仓库许可证写为 MIT。原 README 随包保存在 `catalog-source/licenses/ComfyUI-Animadex-Node-README.md`。原角色、作品、图片及网站资料保留各自来源信息；本目录只保存图片地址。

2. **中文翻译与分类提示**：`damoshen123/st-chatu8`，提交 `5f33ed1ac0b1e4caf87eb3703fb30a6cc5b0b50f`。使用其词表中文标签及部分人工分类层级，经过标准化、选取和修正。实际使用的来源词条保存在 `catalog-source/source/tag-enrichment.json`，包括原文件名、原标签、翻译与词条 ID。衍生词表记录在 `data/taxonomy.json`。该来源采用 **Aladdin Free Public License Version 9**，完整原文保存在 `catalog-source/licenses/st-chatu8-AFPL.txt`。

3. **整理规则和检索工具**：2026-09-30 为本用户本地使用新增的 `catalog-source/tools/` 与运行模块。用途为分类、中文检索别名、质量标记、索引、服装去重、条件检索和可复现抽样；没有修改原仓库插件文件。人工规则与修正均可在源文件中审查。含上述智绘姬词表衍生内容的资料随附并保留 AFPL 许可证及完整构建源代码，不将整个资料包标为 MIT。

4. **官方 AnimaDex 项目参考**：`https://github.com/zetaneko/AnimaDex`，用于核对原始 CSV 的字段和官方离线导出方法。当前角色数据不是通过官方账户导出取得的实时快照。

5. **女性优先配置与 LoRA 资料**：筛选依据本用户样例和审美偏好，详细规则可审查，未使用年份推断脸部质量。LoRA 清单摘录作者公开的文件信息、角色名单和功能性触发词，不包含模型权重、训练集或作者完整提示词集合。每项保留出处和核实状态；各模型使用条件以作者原始发布页为准。

这是来源记录，不对源角色资料、标签翻译和生成模型的还原效果作担保。所有补充的视觉类别都附证据规则；性格字段保持无来源资料状态。未知、歧义与缺失信息可见并可核查。


2026-10-04 更新：仓库根目录为剧情绘图工作台 v2.1.9；`companions/st-chatu8` 是公开智绘姬代码的传输适配版，保留原作者和 AFPL 许可证，修改包括独立图片库传输、失败保护和标准 ComfyUI history 路由。`compat/shujuku` 为 SP 数据库 9.2.5 的兼容修改，保留原文件作者信息。所有已配置接口、密钥、私人预设和用户世界书都不在此仓库内。

参考图节点的 `incontext.py` 与 `nodes.py` 源自 https://huggingface.co/darask0/Anima-InContext-Character ，本地来源提交 e084c88c02dcaa55806c56b22a43461d4c32be85，已为本机模型路线作适配。完整来源 README 与其非商业许可证声明保留在 `custom_nodes/ComfyUI-AnimadexIdentity/UPSTREAM_SOURCE.md`；不含模型权重。其他新增节点逻辑可直接检查源码。

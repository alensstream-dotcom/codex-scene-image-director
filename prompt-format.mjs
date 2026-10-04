/** Repair only the copied ICOT example in a reversible copy of the active preset. */
const CONTRACT='【连续剧情的最终输出格式】\n保留三段连续、逐段推进的真实剧情和原有对白风格。最终回复只包含实际剧情正文、完整 image###Scene Composition:…;### 图片块和既有状态栏。不要输出模板占位符、插图规划、思考步骤或分析清单。不要照抄示例。各段直接衔接，不需要 Interleaving 包装标签。';
export function repairInterleavedFormat(preset) {
    const copy=structuredClone(preset);let changed=0;
    for (const prompt of copy.prompts || []) {
        const text=prompt.content || '';
        if (!text.includes('{{思考内容}}') || !text.includes('{{正文内容}}')) continue;
        const start=text.indexOf('<Interleaved_thinking>'),end=text.indexOf('</Interleaved_thinking>');
        if (start<0 || end<start) continue;
        prompt.content=text.slice(0,start)+CONTRACT+text.slice(end+'</Interleaved_thinking>'.length);changed++;
    }
    return {preset:copy,changed};
}

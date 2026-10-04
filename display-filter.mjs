// Presentation only: leave persisted messages, prompts and image blocks intact.
export const PLANNING_REGEX = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?☆[ \t]*插图规划[^\n]*\n[\s\S]*?(?=(?:image###|<details\b|<AVS\b|<StatusBlock\b|<status(?:_block)?\b)|$)/gi;
export const PLANNING_TAIL_REGEX = /(?<=☆[ \t]*插图规划[\s\S]*;###)[\s\S]*?(?=(?:image###|<details\b|<AVS\b|<StatusBlock\b|<status(?:_block)?\b)|$)/gi;
// Keep complete legacy/saved image buttons. ADCAP drafts and unfinished examples
// cannot consume a real image after the closing reasoning tag.
export const THINKING_REGEX = /<(think|thinking|analysis|reasoning)\b[^>]*>(?:(?!image###(?!\s*ADCAP)(?:(?!<\/\1\s*>)[\s\S])*?###)[\s\S])*?<\/\1\s*>/gi;
// Exact template-only lines, never actual prose or a character's quoted dialogue.
export const PLACEHOLDER_REGEX = /(?:^|\n)[ \t]*(?:\{\{(?:思考内容|正文内容|可能要求的附加内容)\}\})[ \t]*(?=\r?\n|$)/g;
export const PLANNING_FILTER_ID = 'animadex-hide-image-planning-v1';
export function installPlanningFilter(settings) {
    settings.regex ??= [];
    const script = { id:PLANNING_FILTER_ID, scriptName:'Animadex：隐藏插图规划（只影响显示）', findRegex:PLANNING_REGEX.toString(), replaceString:'', trimStrings:[], placement:[2], disabled:false, markdownOnly:true, promptOnly:false, runOnEdit:true, substituteRegex:0, minDepth:null, maxDepth:null };
    const tail = { ...script, id:PLANNING_FILTER_ID + '-between', scriptName:'Animadex：隐藏图片之间的规划', findRegex:PLANNING_TAIL_REGEX.toString() };
    const thought = { ...script, id:PLANNING_FILTER_ID + '-thinking', scriptName:'Animadex：隐藏标签内思考', findRegex:THINKING_REGEX.toString() };
    const placeholder = { ...script, id:PLANNING_FILTER_ID + '-placeholder', scriptName:'Animadex：隐藏误抄的格式占位符', findRegex:PLACEHOLDER_REGEX.toString() };
    const before = JSON.stringify(settings.regex);
    settings.regex = settings.regex.filter(value => ![script.id, tail.id, thought.id, placeholder.id].includes(value.id));
    // Remove gaps while the original planning header still exists; then the header.
    const anchor={...script,id:PLANNING_FILTER_ID+'-scene-anchor',scriptName:'剧情绘图：独立图片位置',findRegex:'/image###ADSCENE\\{"id":"([a-zA-Z0-9_-]{1,80})","rev":([1-9][0-9]*)\\}END;###/g',replaceString:'<span class="ad-scene-anchor" data-ad-scene="$1" data-ad-revision="$2"></span>'};
    settings.regex=settings.regex.filter(value=>value.id!==anchor.id);
    settings.regex.push(thought, tail, script, placeholder,anchor);
    return before !== JSON.stringify(settings.regex);
}

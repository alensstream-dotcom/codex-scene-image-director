const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&!!v.trim();
function tags(value){return Array.isArray(value)&&value.length&&value.every(text)?value.join(', '):value;}
function invalid(fields){
    const names={object:'单个场景 JSON 对象',scene_composition:'scene_composition（场景标签）',people:'people（人物列表）',limit:'最多 4 位画面人物'};
    const error=new Error('选段接口返回格式不完整：'+fields.map(f=>names[f]).join('、')+'。请检查「世界书」中的选段必要格式；仅点击重新生成无法修复规则格式。');
    error.code='manual.result.invalid';error.fields=fields;return error;
}
/** Adapt known JSON field variants without guessing cast, actions or visual tags. */
export function normalizeManualResult(value,{excerpt=''}={}){
    if(!object(value))throw invalid(['object']);
    if(value.refusal||value.error)throw new Error('选段模型未提供可用场景，返回了拒绝或错误结果。请调整选段或检查 API；没有生成新 tags。');
    let data=value;
    if(!Object.hasOwn(data,'people')&&!Object.hasOwn(data,'scene_composition')&&!Object.hasOwn(data,'scene')){
        const wrappers=['result','data'].filter(k=>object(data[k]));
        if(wrappers.length===1)data=data[wrappers[0]];
    }
    if(data.refusal||data.error)throw new Error('选段模型未提供可用场景，返回了拒绝或错误结果。请调整选段或检查 API；没有生成新 tags。');
    const scene=tags(data.scene_composition??data.scene);
    const people=data.people??(data.environment_only===true?[]:undefined);
    const fields=[];
    if(!text(scene))fields.push('scene_composition');
    if(!Array.isArray(people))fields.push('people');else if(people.length>4)fields.push('limit');
    if(fields.length)throw invalid(fields);
    const result=structuredClone(data);
    result.scene_composition=scene;
    // Summary is a dialog caption. Missing captions must not discard valid visual data.
    result.summary=text(data.summary)?data.summary:(text(excerpt)?excerpt.trim().slice(0,240):'选中的剧情画面');
    result.people=people.map(actor=>{
        if(!object(actor))return actor;
        const copy=structuredClone(actor);
        copy.person=copy.person??copy.name;
        if(copy.action_prompt!==undefined)copy.action_prompt=tags(copy.action_prompt);else if(copy.action!==undefined)copy.action_prompt=tags(copy.action);
        if(copy.required===undefined&&object(copy.appearance?.required))copy.required=structuredClone(copy.appearance.required);
        if(copy.preferred===undefined&&object(copy.appearance?.preferred))copy.preferred=structuredClone(copy.appearance.preferred);
        return copy;
    });
    return result;
}

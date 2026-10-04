/** Public generation metadata only. Never copy API keys, headers, URLs or all host settings. */
export function extractArtistTags(prompt=''){
    return [...new Set((String(prompt).match(/@[^,;:{}|\r\n]+(?=[,;|\r\n]|$)/g)||[]).map(t=>t.trim()))];
}
export function generationRecipe(scene,native={},request={}){
    let graph={};try{graph=typeof native.worker==='string'?JSON.parse(native.worker):native.worker||{};}catch{}
    const refs=request.animadexReferenceFiles||[],referenceRoute=refs.length>0;
    const node=Object.values(graph).find(n=>n?.class_type==='AnimadexDrawingModel');
    const budget=Object.values(graph).find(n=>n?.class_type==='AnimadexIdentityCanvas');
    return {version:1,workflow:native.workerid||'',model:graph[referenceRoute?'31':'15']?.inputs?.unet_name||native.MODEL_NAME||'',style:scene.style||'model_default',artist_tags:extractArtistTags(request.change||scene.confirmed_prompt||''),seed:request.animadexSeed,width:Number(native.comfyui_width)||null,height:Number(native.comfyui_height)||null,reference_files:[...refs],reference_route:referenceRoute,steps:node?.inputs?.[referenceRoute?'reference_steps':'main_steps']??(Number(native.comfyui_steps)||null),canvas_budget:budget?.inputs?.main_budget||'',people:(scene.actors||[]).map(a=>({name:a.person,prototype_id:a.person_snapshot?.prototype_id||'',prototype_trigger:a.person_snapshot?.prototype_trigger||'',appearance:[...(a.person_snapshot?.chosen_appearance_tags||[])],reference_enabled:a.person_snapshot?.reference_enabled===true}))};
}
export function recipeDescription(recipe={},actual={}){
    const recorded=typeof actual.resolvedPrompt==='string';
    const artists=(recorded?extractArtistTags(actual.resolvedPrompt):recipe.artist_tags)?.join('、')||'未添加画师标签';
    return [`画师标签：${artists}（${recorded?'已核对绘图提示词；画面风格仍取决于模型':'绘图输入记录；未记录渲染端提示词'}）`,`工作流：${recipe.workflow||'未记录'} · 模型：${actual.model||recipe.model||'未记录'}`,`尺寸：${actual.width||recipe.width||'?'} × ${actual.height||recipe.height||'?'} · 步数：${actual.steps||recipe.steps||'?'} · seed：${actual.seed??recipe.seed??'未记录'}`,`参考图：${recipe.reference_files?.length||0} 张${recipe.reference_route?'，使用参考分支':''}`,...(recipe.people||[]).map(p=>p.name+'：'+p.appearance.join(', '))].join('\n');
}

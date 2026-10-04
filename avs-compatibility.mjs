const MARKER='Animadex AVS reasoning compatibility v2.1.7';
const FOOTER_MARKER='Animadex AVS status footer compatibility v2.1.7';
export function patchAvsSource(source){
    if(typeof source!=='string'||!source.includes("systemId: 'acgn_visual_system'"))return {changed:false,content:source};
    if(source.includes(MARKER)&&source.includes(FOOTER_MARKER))return {changed:false,content:source,alreadyPatched:true};
    const anchor=/function extractDelta\(text\) \{\s*const raw = String\(text \?\? ''\);/;
    if(!source.includes(MARKER)&&!anchor.test(source))return {changed:false,content:source,unsupported:true};
    let content=source.includes(MARKER)?source:source.replace(anchor,`function extractDelta(text) {
    // ${MARKER}: explanations and code examples are never state transactions.
    const raw = String(text ?? '')
      .replace(/<(think|thinking|analysis|reasoning)\\b[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)/gi, '')
      .replace(/\u0060\u0060\u0060[^\\n]*\\n[\\s\\S]*?\u0060\u0060\u0060/g, '');`).replace("runtimeVersion: '1.0.0'","runtimeVersion: '1.0.1'");
    if(!content.includes(FOOTER_MARKER)){
        const tail='raw.slice(match.index + match[0].length).trim()';
        if(!content.includes(tail))return {changed:false,content:source,unsupported:true};
        content=content.replace(tail,`raw.slice(match.index + match[0].length)
      // ${FOOTER_MARKER}: only the known display footer may follow a transaction.
      .replace(/<(status|status_block|StatusBlock|AVS)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>/gi, '').trim()`)
            .replace("runtimeVersion: '1.0.1'","runtimeVersion: '1.0.2'");
    }
    return {changed:true,content};
}
/** Use Tavern Helper's documented tree API; preserve every unrelated script. */
export function installAvsCompatibility(helper,settings){
    if(typeof helper?.getScriptTrees!=='function'||typeof helper?.updateScriptTreesWith!=='function')return {changed:0,unavailable:true};
    const options={type:'global'},trees=helper.getScriptTrees(options),backups=[],unsupported=[];
    const scripts=trees.flatMap(item=>item.type==='folder'?item.scripts:[item]);
    for(const script of scripts){const patch=patchAvsSource(script.content);if(patch.changed)backups.push({id:script.id,name:script.name,content:script.content,replacement:patch.content});else if(patch.unsupported)unsupported.push(script.id);}
    if(!backups.length)return {changed:0,unsupported};
    const replacements=new Map(backups.map(script=>[script.id,script]));
    helper.updateScriptTreesWith(current=>current.map(item=>{
        const update=script=>{const saved=replacements.get(script.id);if(!saved)return script;if(script.content!==saved.content)throw new Error('AVS 脚本已变化，本次兼容修复未覆盖。');return {...script,content:saved.replacement};};
        return item.type==='folder'?{...item,scripts:item.scripts.map(update)}:update(item);
    }),options);
    settings.avsCompatibilityBackups??=[];
    for(const {replacement,...original}of backups)if(!settings.avsCompatibilityBackups.some(v=>v.id===original.id))settings.avsCompatibilityBackups.push(original);
    return {changed:backups.length,unsupported};
}

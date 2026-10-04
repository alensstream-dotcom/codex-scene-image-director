/** Tauri exposes removeListener; stock extensions may use the equivalent off alias. */
export function ensureHostEventCompatibility(source){
    if(!source||typeof source.off==='function'||typeof source.removeListener!=='function')return false;
    Object.defineProperty(source,'off',{configurable:true,writable:true,value:function(event,listener){return this.removeListener(event,listener);}});
    return true;
}

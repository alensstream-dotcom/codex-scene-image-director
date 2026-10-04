import {DEFAULT_DRAWING_RULES} from './worldbook-defaults.mjs';
import {renderWorldbookRules} from './worldbook-scopes.mjs';
import {worldbookInstruction} from './worldbook-library.mjs';
// Compatibility export, generated from the visible JSON; no parallel prompt string.
export const MANUAL_INSTRUCTION=renderWorldbookRules(DEFAULT_DRAWING_RULES,'manual');
export function manualInstruction(settings={},payload={}){
    if(settings.worldbook_read_error)throw new Error('生图世界书读取失败，请重新读取文件后再选段。');
    const rules=worldbookInstruction(settings,'manual',{people:payload.current_people||[],outfits:payload.current_people?.filter(p=>p.outfit).map(p=>({name:p.person,outfit:p.outfit}))||[]});
    if(rules===null||rules==='')throw new Error('没有启用的选段生图规则，请在世界书中启用选段条目或恢复默认规则副本。');
    return rules??MANUAL_INSTRUCTION;
}

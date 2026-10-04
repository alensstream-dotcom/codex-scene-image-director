import {worldbookInstruction} from './worldbook-library.mjs';
import {DEFAULT_DRAWING_RULES} from './worldbook-defaults.mjs';
import {renderWorldbookRules} from './worldbook-scopes.mjs';
export const AUTOMATIC_INSTRUCTION=renderWorldbookRules(DEFAULT_DRAWING_RULES,'automatic');
export function automaticPrompt(story,settings={},outfits={}){
    if(settings.enabled===false||settings.automatic===false||settings.worldbook_read_error)return '';
    const people=Object.values(story?.cast?.people||{}).slice(-8).map(p=>({name:p.person,aliases:p.aliases||[],appearance:p.story_appearance?.traits||{},age:p.age_description||'',height_cm:p.story_appearance?.height_cm||null}));
    const clothes=Object.entries(outfits).slice(-4).filter(([,outfit])=>outfit?.known).map(([name,outfit])=>({name,items:outfit.items.slice(0,6).map(item=>({id:item.id,state:item.state,design:item.tags.join(', ').slice(0,80),state_tags:(item.state_tags||[]).join(', ').slice(0,60)}))}));
    const variables={people,outfits:clothes},rules=worldbookInstruction(settings,'automatic',variables);
    return rules??(rules===null?'':renderWorldbookRules(DEFAULT_DRAWING_RULES,'automatic',variables));
}

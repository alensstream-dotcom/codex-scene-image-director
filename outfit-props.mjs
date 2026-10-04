/** A garment explicitly off the body belongs to the scene, never a guessed shoulder pose. */
export function separateRemovedProps(outfit,{person,names=[],text=''}={}){
    const result=structuredClone(outfit),props=[];
    const all=[...new Set([person,...names].filter(Boolean))];let subject='';const sentences=[];
    for(const sentence of String(text).split(/[。！？!?\n]/)){
        const mentioned=all.filter(n=>sentence.includes(n));if(mentioned.length===1)subject=mentioned[0];else if(mentioned.length>1)subject='';
        if(subject===person)sentences.push(sentence);
    }
    const description=sentences.slice(-4).join(' ');
    for(const item of result.items||[]){
        if(item.state!=='draped')continue;
        const placement=(item.state_tags||[]).find(t=>/chair|desk|table|sofa|椅|桌|沙发/i.test(t));
        if(!placement&&(item.state_tags||[]).some(t=>/shoulders|around body|wearing/i.test(t)))continue;
        const last=(regex)=>[...description.matchAll(regex)].at(-1)?.index??-1;
        const lastOff=last(/脱下|脱掉|取下|摘下|took off|taken off|removed/gi),lastOn=last(/重新穿|再次穿|又穿|穿回|披在肩|披回|put back on|put on again/gi);
        if(!placement&&lastOn>lastOff)continue;
        const off=lastOff>=0;
        const location=/椅背|chair back/i.test(description)?'draped over chair back':/椅|chair/i.test(description)?'placed on a chair':/桌|table|desk/i.test(description)?'placed on a table':/沙发|sofa/i.test(description)?'placed on a sofa':'';
        const words=[item.name,item.id,...item.tags].filter(Boolean),named=words.some(w=>description.toLowerCase().includes(String(w).toLowerCase()))||item.id==='coat'&&/外套|coat/i.test(description);
        if(placement||off&&location&&named){item.state='removed';props.push(item.tags.join(' ')+' '+(placement||location));}
    }
    return {outfit:result,props};
}

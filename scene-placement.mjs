import {proseOf} from './scene-planner.mjs';

const excluded='.ad-scene-block,.ad-scene-anchor,script,style,textarea,details,[hidden]';
const placements=new WeakMap();
const normalize=text=>String(text).replace(/[\s*_`#]/g,'');
function sourceText(raw){
    const template=document.createElement('template');
    template.innerHTML=proseOf(raw).replace(/<[^>]*>/g,'');
    return normalize(template.content.textContent);
}
function segments(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),items=[];let node;
    while(node=walker.nextNode())if(!node.parentElement?.closest(excluded))items.push(node);
    return items;
}
/** The host may split a marker across Markdown/quote nodes. Remove only that marker. */
export function replaceVisibleMarker(root,marker,block){
    const nodes=segments(root),text=nodes.map(n=>n.data).join(''),at=text.indexOf(marker);
    if(at<0)return false;
    let total=0,start,end;
    for(const node of nodes){if(!start&&at<total+node.length)start={node,offset:at-total};if(at+marker.length<=total+node.length){end={node,offset:at+marker.length-total};break;}total+=node.length;}
    if(!start||!end)return false;
    const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);range.deleteContents();range.insertNode(block);return true;
}
function visibleMap(root){
    const chars=[],points=[];
    for(const node of segments(root))for(let i=0;i<node.length;i++)if(normalize(node.data[i])){chars.push(node.data[i]);points.push({node,offset:i+1});}
    return {text:chars.join(''),points};
}
function occurrences(text,quote){const ends=[];let at=0;while((at=text.indexOf(quote,at))!==-1){ends.push(at+quote.length);at++;}return ends;}
/** Resolve the source marker to visible prose, without rebuilding or changing the reply. */
export function scenePlacementPoint(root,raw,markerOffset){
    const prefix=sourceText(raw.slice(0,markerOffset)),source=sourceText(raw),visible=visibleMap(root);
    if(!prefix)return null;
    for(const length of [...new Set([240,160,100,60,30,16,8].map(n=>Math.min(n,prefix.length)))]){
        const quote=prefix.slice(-length),ends=occurrences(visible.text,quote);if(!ends.length)continue;
        const sourceEnds=occurrences(source,quote),rank=sourceEnds.indexOf(prefix.length);
        // Never guess which repeated passage survived a host display rule.
        const end=rank>=0&&ends.length===sourceEnds.length?ends[rank]:null;
        if(end!==null)return visible.points[end-1];
    }
    return null;
}
const inline=node=>node.nodeType===Node.TEXT_NODE||/^(SPAN|EM|STRONG|B|I|U|S|Q|A|SMALL|MARK)$/i.test(node.nodeName);
const empty=node=>node.nodeType===Node.TEXT_NODE?!node.data.trim():node.matches?.('.ad-scene-block,.ad-scene-anchor')||(!node.textContent.trim()&&!node.querySelector?.('img,video,iframe'));
function insertAtPoint(root,point,block,raw,markerOffset){
    const prior=[...root.querySelectorAll('.ad-scene-block')].filter(b=>{const p=placements.get(b);return b!==block&&p?.raw===raw&&p.node===point.node&&p.pointOffset===point.offset&&p.markerOffset<markerOffset;}).sort((a,b)=>placements.get(a).markerOffset-placements.get(b).markerOffset).at(-1);
    if(prior){prior.after(block);return;}
    let node=point.node;
    if(!node.data.slice(point.offset).trim()){
        while(node.parentNode!==root&&inline(node.parentNode)&&[...node.parentNode.childNodes].slice([...node.parentNode.childNodes].indexOf(node)+1).every(empty))node=node.parentNode;
        const parent=node.parentNode;
        if(parent!==root&&/^(P|LI|BLOCKQUOTE|H[1-6])$/.test(parent.nodeName)&&[...parent.childNodes].slice([...parent.childNodes].indexOf(node)+1).every(empty))parent.after(block);
        else node.after(block);
    }else{const range=document.createRange();range.setStart(point.node,point.offset);range.collapse(true);range.insertNode(block);}
}
export function placeSceneBlock(root,raw,markerOffset,block){
    const saved=placements.get(block);
    if(saved?.raw===raw&&saved.parent===block.parentNode&&saved.previous===block.previousSibling&&saved.node.isConnected&&saved.data===saved.node.data)return true;
    const point=scenePlacementPoint(root,raw,markerOffset);
    if(!point)return false;
    insertAtPoint(root,point,block,raw,markerOffset);block.classList.remove('ad-scene-unplaced');block.removeAttribute('title');
    placements.set(block,{raw,parent:block.parentNode,previous:block.previousSibling,node:point.node,data:point.node.data,pointOffset:point.offset,markerOffset});return true;
}

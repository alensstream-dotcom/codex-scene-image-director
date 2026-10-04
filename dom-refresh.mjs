/** One refresh per frame; a full refresh supersedes individual changed rows. */
export function createDomRefresh(refresh,{schedule=cb=>requestAnimationFrame(cb)}={}){
    let pending=false,full=false,rows=new Set();
    const stats={flushes:0,fullRefreshes:0,rowsRefreshed:0};
    function request(changed){
        if(changed==null){full=true;rows.clear();}else if(!full)for(const row of changed)rows.add(row);
        if(pending||!full&&!rows.size)return;pending=true;
        schedule(()=>{const selected=full?null:[...rows];pending=false;full=false;rows=new Set();
            stats.flushes++;if(selected===null)stats.fullRefreshes++;else stats.rowsRefreshed+=selected.length;
            refresh(selected);
        });
    }
    return {request,stats:()=>({...stats,pending})};
}
export function changedChatRows(records,chat){
    const rows=new Set(),add=(node,descendants=false)=>{
        const element=node?.nodeType===1?node:node?.parentElement;
        if(!element)return;
        const row=element.closest?.('.mes[mesid]');if(row&&chat.contains(row))rows.add(row);
        if(descendants)for(const nested of element.querySelectorAll?.('.mes[mesid]')||[])if(chat.contains(nested))rows.add(nested);
    };
    for(const record of records){add(record.target);for(const node of record.addedNodes||[])add(node,true);}
    return [...rows];
}

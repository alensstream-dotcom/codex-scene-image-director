/** Editable ST worldbooks. The host file is authoritative; settings keep the managed list. */
export const RULE_BOOK='Animadex_剧情绘图_生图规则';
const clone=structuredClone;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function validateWorldbook(value){
    if(!object(value)||!object(value.entries))throw new Error('需要 SillyTavern/TauriTavern 世界书 JSON，包含 entries 对象。');
    for(const [id,entry] of Object.entries(value.entries)){
        if(!object(entry)||typeof entry.content!=='string')throw new Error('条目 '+id+' 缺少文本 content。');
        for(const key of ['key','keysecondary'])if(entry[key]!==undefined&&(!Array.isArray(entry[key])||entry[key].some(x=>typeof x!=='string')))throw new Error('条目 '+id+' 的 '+key+' 应为文本数组。');
    }
    return clone(value);
}
export function worldbookInstruction(settings){
    const library=settings.worldbook_library;
    if(!library)return undefined; // Compatibility for callers predating editable worldbooks.
    const book=library.books.find(b=>b.name===library.active);
    if(!book)return null;
    if(book.mode==='native')return ''; // The host handles all native activation semantics.
    return Object.entries(book.data.entries).filter(([,e])=>!e.disable&&e.content.trim()).sort(([ka,a],[kb,b])=>Number(b.order??100)-Number(a.order??100)||String(ka).localeCompare(String(kb))).map(([,e])=>e.content).join('\n\n');
}
export function filterManagedLore(lore,settings){
    const library=settings.worldbook_library;if(!library)return;
    const active=library.books.find(b=>b.name===library.active);
    const allow=settings.enabled!==false&&settings.automatic!==false&&!settings.worldbook_read_error&&active?.mode==='native'?active.name:null;
    const names=new Set(library.books.map(b=>b.name));
    for(const rows of Object.values(lore||{}))if(Array.isArray(rows))for(let i=rows.length-1;i>=0;i--)if(names.has(rows[i].world)&&rows[i].world!==allow)rows.splice(i,1);
}
export function createWorldbookLibrary({setting,host,defaultBook,save=()=>{},changed=()=>{}}){
    let chain=Promise.resolve(),writing=new Set();
    const state=()=>setting().worldbook_library??={version:1,active:null,books:[]};
    const find=name=>{const book=state().books.find(b=>b.name===name);if(!book)throw new Error('世界书不存在，请刷新列表。');return book;};
    const emit=()=>{delete setting().worldbook_read_error;save();changed();};
    const serial=fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;};
    async function syncSelection(){await host.select?.(state().active,state().books);}
    async function write(name,data){writing.add(name);try{await host.save(name,clone(data));}finally{writing.delete(name);}}
    async function fresh(book){
        if(!(await host.names()).includes(book.name)){
            state().books=state().books.filter(b=>b.name!==book.name);if(state().active===book.name)state().active=null;
            emit();return null;
        }
        const data=await host.load(book.name);if(!data)throw new Error('无法读取世界书 '+book.name+'，请检查本地文件。');
        const checked=validateWorldbook(data);if(JSON.stringify(book.data)!==JSON.stringify(checked)){book.data=checked;emit();}return book;
    }
    async function unique(name){
        let base=String(name||'生图世界书').replace(/\.json$/i,'').trim();
        if(!base||/[\\/\x00-\x1f]/.test(base)||base==='.'||base==='..')throw new Error('世界书名称不能包含路径或控制字符。');
        const names=new Set([...(await host.names()),...state().books.map(b=>b.name)]);let next=base,n=2;
        while(names.has(next))next=base+' ('+(n++)+')';return next;
    }
    async function add(data,{name,mode='native',activate=true}={}){
        const checked=validateWorldbook(data);if(!['always','native'].includes(mode))throw new Error('世界书模式无效。');
        const safe=await unique(name||data.name||'生图世界书');await write(safe,checked);
        state().books.push({name:safe,mode,data:checked});if(activate)state().active=safe;await syncSelection();emit();return {name:safe};
    }
    return {
        initialize:()=>serial(async()=>{if(!setting().worldbook_library){const data=await defaultBook();state();await add(data,{name:RULE_BOOK,mode:'always'});}else{for(const book of [...state().books])await fresh(book);await syncSelection();}emit();}),
        list:()=>clone(state()),
        get:name=>clone(find(name)),
        refresh:()=>serial(async()=>{for(const book of [...state().books])await fresh(book);await syncSelection();return clone(state());}),
        import:(data,options)=>serial(()=>add(data,options)),
        restoreDefault:()=>serial(async()=>add(await defaultBook(),{name:RULE_BOOK,mode:'always'})),
        save:(name,data,{mode,expected}={})=>serial(async()=>{
            const checked=validateWorldbook(data),book=find(name);if(mode&&!['always','native'].includes(mode))throw new Error('世界书模式无效。');
            if(!await fresh(book))throw new Error('世界书已被删除，请另存为。');
            if(expected!==undefined&&expected!==JSON.stringify(book.data))throw new Error('世界书已在别处修改；请先导出草稿，再重新读取文件。');
            await write(name,checked);book.data=checked;if(mode)book.mode=mode;await syncSelection();emit();return clone(book);
        }),
        use:name=>serial(async()=>{if(name){if(!await fresh(find(name)))throw new Error('世界书已被删除。');}state().active=name||null;await syncSelection();emit();}),
        delete:name=>serial(async()=>{find(name);if((await host.names()).includes(name)&&!await host.delete(name))throw new Error('世界书删除失败，文件与配置保持原样。');state().books=state().books.filter(b=>b.name!==name);if(state().active===name)state().active=null;await syncSelection();emit();}),
        export:async name=>{await chain;const book=find(name);if(!await fresh(book))throw new Error('世界书已被删除。');return clone(book.data);},
        available:()=>host.names(),open:name=>host.open?.(name),
        copyExisting:name=>serial(async()=>{const data=await host.load(name);if(!data)throw new Error('无法读取所选世界书。');return add(data,{name:name+' · 生图副本',mode:'native',activate:false});}),
        accept:(name,data)=>{if(writing.has(name))return;const book=state().books.find(b=>b.name===name);if(!book)return;book.data=validateWorldbook(data);emit();},
        filter:rows=>filterManagedLore(rows,setting())
    };
}

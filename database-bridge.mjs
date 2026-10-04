/** Read-only SP 9.2.5 adapter. Only pictured identities, never latest clothes into history. */
const TABLES=new Set(['重要角色表','主角信息表','主角角色信息表','恋爱对象表']);
const text=v=>typeof v==='string'||typeof v==='number'?String(v).trim().slice(0,1200):'';
const pick=(row,keys)=>keys.map(k=>text(row[k])).find(Boolean)||'';
export function readDatabasePeople(names,{api=globalThis.window?.AutoCardUpdaterAPI,historical=false}={}){
    if(!names.length)return {people:[],status:'already_bound'};
    if(historical)return {people:[],status:'historical'};
    // SP hides this getter while its chat runtime is switching/loading.
    if(typeof api?.queryTableRows!=='function'||typeof api?.exportTableAsJson!=='function')return {people:[],status:'unavailable'};
    const schema=api.exportTableAsJson(),people=[];
    const sheets=Object.entries(schema||{}).filter(([key,s])=>key.startsWith('sheet_')&&TABLES.has(s?.name));
    for(const person of [...new Set(names)].slice(0,4)){
        const matches=[];
        for(const [key,sheet]of sheets){
            const header=sheet.content?.[0];if(!Array.isArray(header))continue;
            const nameColumn=header.find(h=>['姓名','name'].includes(h));if(!nameColumn)continue;
            const result=api.queryTableRows({sheetKey:key,where:{[nameColumn]:person},limit:2});
            if(!result||!Array.isArray(result.rows))continue;
            for(const row of result.rows){
                if(pick(row,['姓名','name'])!==person)continue;
                const appearance=pick(row,['外貌特征','appearance']);if(!appearance)continue;
                matches.push({person,appearance,gender:pick(row,['性别','gender']),age:pick(row,['年龄','age']),gender_age:pick(row,['性别/年龄','gender_age'])});
            }
        }
        if(matches.length===1)people.push(matches[0]);
    }
    return {people,status:people.length?'matched':'no_match'};
}

const forbidden=new Set(['__proto__','prototype','constructor']);
const clone=structuredClone;
export function validateWorkflow(value){
    let graph;try{graph=typeof value==='string'?JSON.parse(value):clone(value);}catch{throw new Error('工作流 JSON 无法解析。');}
    if(!graph||Array.isArray(graph)||typeof graph!=='object'||!Object.keys(graph).length||Object.keys(graph).length>800)throw new Error('请导入 ComfyUI API 格式的节点工作流。');
    const ids=new Set(Object.keys(graph));
    for(const[id,node]of Object.entries(graph)){
        if(forbidden.has(id)||!node||typeof node.class_type!=='string'||!node.class_type.trim()||!node.inputs||Array.isArray(node.inputs)||typeof node.inputs!=='object')throw new Error('节点 '+id+' 缺少 class_type 或 inputs；请使用 API 格式导出。');
        for(const value of Object.values(node.inputs))if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])&&(!ids.has(value[0])||value[1]<0))throw new Error('节点 '+id+' 的连线指向不存在的节点或输出。');
    }
    if(JSON.stringify(graph).length>2000000)throw new Error('工作流过大。');return graph;
}
export function createWorkflowLibrary({native,save}){
    const settings=()=>{const n=native();n.workers??={};return n;};
    const name=v=>{if(typeof v!=='string'||!v.trim()||v.length>120||forbidden.has(v))throw new Error('请输入 120 字以内的工作流名称。');return v.trim();};
    const list=()=>{const n=settings();return Object.entries(n.workers).map(([id,w])=>({id,name:id,workflow:typeof w==='string'?w:JSON.stringify(w,null,2),active:id===n.workerid}));};
    function get(id){const record=list().find(w=>w.id===id);if(!record)throw new Error('工作流不存在。');return record;}
    function use(id){const record=get(id),n=settings();validateWorkflow(record.workflow);n.workerid=id;n.worker=record.workflow;save();return get(id);}
    function put({id,name:label,workflow,activate=false}){const graph=validateWorkflow(workflow),n=settings(),nextName=name(label||id);if(id&&!Object.hasOwn(n.workers,id))throw new Error('原工作流已不存在。');if(nextName!==id&&Object.hasOwn(n.workers,nextName))throw new Error('同名工作流已存在，请换一个名称。');const text=JSON.stringify(graph,null,2),active=n.workerid===id;if(id&&id!==nextName)delete n.workers[id];n.workers[nextName]=text;if(activate||active){n.workerid=nextName;n.worker=text;}save();return get(nextName);}
    function remove(id){get(id);const n=settings();if(Object.keys(n.workers).length===1)throw new Error('至少保留一个工作流。');delete n.workers[id];if(n.workerid===id){const replacement=Object.entries(n.workers).find(([,w])=>{try{validateWorkflow(w);return true;}catch{return false;}});n.workerid=replacement?.[0]||'';n.worker=replacement?.[1]||'';}save();return list();}
    function exportData({id}={}){return {format:'animadex-workflows-v1',version:1,workflows:(id?[get(id)]:list()).map(w=>({name:w.name,workflow:validateWorkflow(w.workflow)}))};}
    function importData(data){let value;try{value=typeof data==='string'?JSON.parse(data):clone(data);}catch{throw new Error('导入文件不是有效 JSON。');}const records=value?.format==='animadex-workflows-v1'?value.workflows:[{name:value?.name||'导入的工作流',workflow:value?.workflow||value}];if(!Array.isArray(records)||!records.length||records.length>100)throw new Error('导入列表为空或超过 100 个。');const prepared=records.map(r=>({name:name(r.name),workflow:JSON.stringify(validateWorkflow(r.workflow),null,2)})),n=settings(),used=new Set(Object.keys(n.workers)),added=[];for(const r of prepared){let label=r.name,i=2;while(used.has(label))label=r.name+' ('+i+++')';used.add(label);added.push({...r,name:label});}for(const r of added)n.workers[r.name]=r.workflow;save();return added.map(r=>get(r.name));}
    return {listWorkflows:list,getWorkflow:get,saveWorkflow:put,deleteWorkflow:remove,useWorkflow:use,exportWorkflows:exportData,importWorkflows:importData};
}

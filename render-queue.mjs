/** A single worker; a failed render pauses pending work until an explicit resume. */
export function createRenderQueue({run,onChange=()=>{},valid=()=>true,maxPending=24}={}){
    const tasks=[],tokens=new Set();let running=false,paused=false;
    const snapshot=()=>tasks.map(({task,...row})=>structuredClone(row));
    const changed=()=>onChange(snapshot());
    async function pump(){
        if(running||paused)return;const row=tasks.find(t=>t.status==='queued');if(!row)return;
        if(!valid(row.task)){row.status='cancelled';row.reason='正文、分支或聊天已变化';changed();return pump();}
        running=true;row.status='generating';row.reason='正在绘图，完成后保存';row.started_at=Date.now();changed();
        try{await run(row.task);row.status='complete';row.reason='图片已保存';}
        catch(error){row.status='failed';row.reason=String(error?.message||error);paused=true;}
        finally{running=false;row.finished_at=Date.now();if(row.task.saved_asset_id)row.saved_asset_id=row.task.saved_asset_id;changed();pump();}
    }
    function add(task){
        if(tokens.has(task.token))return false;
        if(tasks.filter(t=>t.status==='queued'||t.status==='generating').length>=maxPending)throw new Error('绘图队列已满，请等待当前任务完成。');
        tokens.add(task.token);tasks.push({id:task.id,token:task.token,scene_id:task.scene.id,message_id:task.scene.message_id,chat_key:task.key,summary:task.scene.summary||'剧情插图',automatic:!!task.automatic,status:'queued',reason:'等待前一张完成',created_at:Date.now(),task});
        while(tasks.length>60){const at=tasks.findIndex(t=>!['queued','generating'].includes(t.status));if(at<0)break;tokens.delete(tasks[at].token);tasks.splice(at,1);}
        changed();queueMicrotask(pump);return true;
    }
    return {add,snapshot,isPaused:()=>paused,resume(){paused=false;changed();queueMicrotask(pump);},cancelQueued(reason='用户停止了后续任务',predicate=()=>true){for(const row of tasks)if(row.status==='queued'&&predicate(row.task)){row.status='cancelled';row.reason=reason;}changed();},retry(id){const row=tasks.find(t=>t.id===id);if(!row||row.status!=='failed')throw new Error('此任务不能重试。');if(!valid(row.task))throw new Error('原文或图片版本已变化，请使用当前图片按钮。');row.status='queued';row.reason='等待手动重试';paused=false;changed();queueMicrotask(pump);}};
}

/** Shared by the real extension and the clean local browser acceptance harness. */
import { STYLE_NAMES } from './scene-session.mjs';
import { wardrobeText } from './wardrobe.mjs';

export function createStudio({host=document.body,onPlan,onSave,onGenerate,onPersonSave,onSettings,onClose}={}) {
    const dialog=document.createElement('dialog');
    dialog.className='ad-studio';dialog.setAttribute('aria-label','剧情绘图工作台');host.append(dialog);
    let epoch=0;
    const personDrafts=new Map();
    const model={tab:'scene',source:'',messageId:null,selected:false,scenes:[],people:[],active:0,status:'选中剧情后，先检查这幅图的人物、动作和衣装。',error:false,busy:false,auto:false,autoGenerate:false,maxScenes:3};
    function element(tag,text,attrs={}) {
        const e=document.createElement(tag);if(text!==undefined)e.textContent=text;
        for(const [key,value]of Object.entries(attrs)){if(key==='class')e.className=value;else e.setAttribute(key,value);}return e;
    }
    const button=(text,fn,primary=false)=>{
        const b=element('button',text,{type:'button',class:primary?'ad-primary':''});b.addEventListener('click',fn);return b;
    };
    function field(container,label,value,key,{rows=3,options}={}) {
        const group=element('label',undefined,{class:'ad-field'});group.append(element('span',label));
        const input=element(options?'select':'textarea');input.dataset.field=key;
        if(options)for(const [val,name]of Object.entries(options)){const opt=element('option',name,{value:val});input.append(opt);}
        else input.rows=rows;
        input.value=value??'';
        input.addEventListener('input',()=>{
            const scene=model.scenes[model.active];
            if(model.tab!=='people'&&scene?.status==='saved'){
                scene.status='draft';model.status='本图已修改；请保存后再生成。';
                const status=dialog.querySelector('[role="status"]');if(status)status.textContent=model.status;
                const generate=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='生成图片');if(generate)generate.disabled=true;
            }
        });
        group.append(input);container.append(group);return input;
    }
    function readPerson(article,person){
        const value=key=>article.querySelector(`[data-field="${key}_${CSS.escape(person.person)}"]`)?.value || '';
        const description=value('current').trim();
        return {...structuredClone(person),chosen_appearance_tags:value('appearance').split(',').map(x=>x.trim()).filter(Boolean),face_description:value('face').trim(),style:value('default'),wardrobe:description===wardrobeText(person.wardrobe)?structuredClone(person.wardrobe):{version:1,description,tags:[],source:'manual-current'}};
    }
    function flush(){
        if(model.tab==='people')for(const article of dialog.querySelectorAll('.ad-person')){
            const person=model.people.find(p=>p.person===article.dataset.person);
            if(person){const draft=readPerson(article,personDrafts.get(person.person) || person);if(JSON.stringify(draft)===JSON.stringify(person))personDrafts.delete(person.person);else personDrafts.set(person.person,draft);}
        }
        const s=model.scenes[model.active];
        if(s&&model.tab!=='people'){
            const confirmed=dialog.querySelector('[data-field="confirmed_prompt"]');if(confirmed)s.confirmed_prompt=confirmed.value;
            const composition=dialog.querySelector('[data-field="composition"]'),style=dialog.querySelector('[data-field="style"]'),dimensions=dialog.querySelector('[data-field="dimensions"]');
            if(composition)s.composition=composition.value.trim();if(style)s.style=style.value;if(dimensions)s.dimensions=dimensions.value;
            (s.actors || []).forEach((actor,i)=>{
                const action=dialog.querySelector(`[data-field="action_${i}"]`),outfit=dialog.querySelector(`[data-field="outfit_${i}"]`);
                if(action)actor.action_prompt=action.value.trim();
                if(outfit&&outfit.value.trim()!==wardrobeText(actor.wardrobe))actor.wardrobe={version:1,description:outfit.value.trim(),tags:[],source:'manual-frame'};
            });
        }
    }
    async function perform(fn){
        flush();if(model.busy)return;const currentEpoch=epoch;
        model.busy=true;model.error=false;model.status='正在处理，选段和修改会保留。';render();
        try{const update=await fn?.(model);if(update&&currentEpoch===epoch)Object.assign(model,update);}
        catch(error){if(currentEpoch===epoch){model.error=true;model.status=String(error.message || error);}}
        finally{if(currentEpoch===epoch){model.busy=false;render();}}
    }
    function render(){
        dialog.replaceChildren();
        const heading=element('header');const title=element('div');title.append(element('h2','剧情绘图'),element('p','把这段故事，画成这一刻。'));heading.append(title,button('关闭',()=>dialog.close()));dialog.append(heading);
        const tabs=element('nav',undefined,{'aria-label':'绘图功能'});
        for(const [key,name]of [['scene','选段生图'],['reply','本条插图'],['people','人物与衣装']]){
            const b=button(name,()=>{flush();model.tab=key;render();});b.setAttribute('aria-pressed',String(model.tab===key));tabs.append(b);
        }dialog.append(tabs);
        const body=element('div',undefined,{class:'ad-body'});
        if(model.tab==='people'){
            if(!model.people.length)body.append(element('p','还没有保存的人物。先选一段描写人物的剧情，准备一幅插图。',{class:'ad-empty'}));
            for(const person of model.people){
                const draft=personDrafts.get(person.person) || person;
                const article=element('section',undefined,{class:'ad-person'});article.dataset.person=person.person;article.append(element('h3',person.person),element('p','外貌固定保存；每幅图的动作和当时衣装独立保存。'));
                if(person.reference_source)article.append(element('p','首次外貌参考：'+person.reference_source,{class:'ad-note'}));
                field(article,'固定外貌标签',(draft.chosen_appearance_tags || []).join(', '),'appearance_'+person.person);
                field(article,'脸型与五官',draft.face_description,'face_'+person.person,{rows:2});
                field(article,'当前衣装',wardrobeText(draft.wardrobe),'current_'+person.person,{rows:2});
                field(article,'默认画风',draft.style || 'painterly','default_'+person.person,{options:STYLE_NAMES});
                article.append(button('保存 '+person.person,()=>{
                    const update=readPerson(article,draft),savedEpoch=epoch;
                    return perform(async()=>{const result=await onPersonSave?.(update);if(savedEpoch===epoch)personDrafts.delete(person.person);return result;});
                }));body.append(article);
            }
        } else {
            if(model.tab==='reply'){
                const controls=element('div',undefined,{class:'ad-reply-controls'});
                const label=element('label');const auto=element('input',undefined,{type:'checkbox'});auto.checked=model.auto;
                const saveOptions=()=>onSettings?.({auto:model.auto,autoGenerate:model.autoGenerate,maxScenes:model.maxScenes});
                auto.addEventListener('change',()=>{model.auto=auto.checked;saveOptions();});label.append(auto,document.createTextNode('回复完成后自动准备插图按钮'));
                const generateLabel=element('label'),automatic=element('input',undefined,{type:'checkbox'});automatic.checked=model.autoGenerate;
                automatic.addEventListener('change',()=>{model.autoGenerate=automatic.checked;saveOptions();});generateLabel.append(automatic,document.createTextNode('同时自动生成图片'));
                const count=element('label','每条最多 ');const number=element('select',undefined,{'aria-label':'每条最多插图数'});
                for(let i=1;i<=4;i++)number.append(element('option',String(i),{value:String(i)}));number.value=String(model.maxScenes);
                number.addEventListener('change',()=>{model.maxScenes=Number(number.value);saveOptions();});count.append(number);controls.append(label,generateLabel,count);body.append(controls);
            }
            if(model.scenes.length>1){const frames=element('div',undefined,{class:'ad-frames','aria-label':'候选插图'});model.scenes.forEach((s,i)=>{
                const b=button(`${i+1}. ${s.reason || '插图'}`,()=>{flush();model.active=i;render();});b.setAttribute('aria-pressed',String(model.active===i));frames.append(b);
            });body.append(frames);}
            const grid=element('div',undefined,{class:'ad-grid'});const excerpt=element('section',undefined,{class:'ad-excerpt'});
            excerpt.append(element('h3','对应剧情'),element('p',model.messageId===null?'尚未选择正文':`来自第 ${model.messageId+1} 条消息`));
            const scene=model.scenes[model.active];
            const quote=element('blockquote',undefined);const text=scene?.excerpt || model.source;
            if(scene?.anchor&&text.includes(scene.anchor)){
                const at=text.indexOf(scene.anchor);quote.append(document.createTextNode(text.slice(0,at)),element('mark',scene.anchor),document.createTextNode(text.slice(at+scene.anchor.length)));
            }else quote.textContent=text || '在聊天里选中一段人物动作或环境描写，再点“选段生图”。';excerpt.append(quote);
            const frame=element('section',undefined,{class:'ad-frame'});frame.append(element('h3','这幅图'));
            if(scene?.manual){
                frame.append(element('h4','将绘制的动作与场景'),element('p',scene.summary || '以保存的 tags 为准。'));
                field(frame,'最终 tags',scene.confirmed_prompt,'confirmed_prompt',{rows:10});
                frame.append(element('p','修改后以 tags 为准，保存后再生成图片。',{class:'ad-note'}));
            }else if(scene){
                field(frame,'镜头与环境',scene.composition,'composition',{rows:2});
                const format=element('div',undefined,{class:'ad-format'});field(format,'本图画风',scene.style,'style',{options:STYLE_NAMES});
                field(format,'画幅',scene.dimensions || '704x1152','dimensions',{options:{'704x1152':'竖图','896x896':'方图','1152x704':'横图'}});frame.append(format);
                if(scene.status==='draft'&&!scene.history){const label=element('label',undefined,{class:'ad-include'}),include=element('input',undefined,{type:'checkbox'});include.checked=!scene.excluded;include.addEventListener('change',()=>scene.excluded=!include.checked);label.append(include,document.createTextNode('保留这幅插图'));frame.append(label);}
                if(scene.environment_only)frame.append(element('p','本图使用中性环境转场。',{class:'ad-note'}));
                for(const [i,actor]of (scene.actors || []).entries()){
                    const person=model.people.find(p=>p.person===actor.person);const part=element('section',undefined,{class:'ad-actor'});part.append(element('h4',actor.person),element('p',(person?.chosen_appearance_tags || []).join(', '),{class:'ad-locked'}));
                    field(part,'动作与表情',actor.action_prompt,'action_'+i,{rows:2});field(part,'当时衣装',wardrobeText(actor.wardrobe),'outfit_'+i,{rows:2});frame.append(part);
                }
            }else frame.append(element('p','先准备镜头，人物和当时衣装会在这里显示。',{class:'ad-empty'}));grid.append(excerpt,frame);body.append(grid);
        }dialog.append(body);
        const footer=element('footer');const status=element('p',model.status,{role:model.error?'alert':'status','aria-live':'polite',class:model.error?'ad-error':''});footer.append(status);
        if(model.tab!=='people'){
            const actions=element('div',undefined,{class:'ad-actions'});
            const plan=button(model.scenes.length?'重新准备':'准备镜头',()=>perform(onPlan));plan.disabled=model.busy||!model.source;
            const save=button('保存插图按钮',()=>perform(onSave),true);save.disabled=model.busy||!model.scenes.length;
            const generate=button('生成图片',()=>perform(m=>onGenerate?.(m.scenes[m.active])));generate.disabled=model.busy||model.scenes[model.active]?.status!=='saved';
            actions.append(plan,save,generate);footer.append(actions);
        }
        dialog.append(footer);if(model.busy)for(const b of dialog.querySelectorAll('button,textarea,select,input'))if(b.textContent!=='关闭')b.disabled=true;
    }
    dialog.addEventListener('close',()=>{epoch++;model.busy=false;onClose?.();});
    return {dialog,model,open(update={}){flush();personDrafts.clear();epoch++;Object.assign(model,{busy:false},update);render();if(!dialog.open)dialog.showModal();},update(update){flush();Object.assign(model,update);render();},close(){dialog.close();},destroy(){dialog.remove();}};
}

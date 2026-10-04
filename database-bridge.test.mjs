import test from 'node:test';import assert from 'node:assert/strict';
import {readDatabasePeople}from './database-bridge.mjs';
import {prepareScenes}from './scene-session.mjs';
const apiFor=(rows,ready=true)=>({exportTableAsJson:()=>({sheet_chars:{name:'重要角色表',content:[['row_id','姓名','外貌特征','穿着打扮','年龄']]}}),queryTableRows:ready?({where,limit})=>{assert.equal(limit,2);return {rows:rows.filter(r=>r.name===where['姓名'])};}:undefined});
test('SP query reads only pictured identity fields, never wardrobe or private history',()=>{
    const result=readDatabasePeople(['Alice'],{api:apiFor([{name:'Alice',appearance:'brown hair, green eyes',age:38,outfit_text:'later red dress',past_experience:'private history'},{name:'Beth',appearance:'blonde hair'}])});
    assert.deepEqual(result.people,[{person:'Alice',appearance:'brown hair, green eyes',gender:'',age:'38',gender_age:''}]);assert(!JSON.stringify(result).includes('private history'));assert(!JSON.stringify(result).includes('red dress'));
});
test('unavailable runtime and historical selections never query latest database',()=>{
    assert.equal(readDatabasePeople(['Alice'],{api:apiFor([],false)}).status,'unavailable');
    const api={queryTableRows:()=>assert.fail('historical read'),exportTableAsJson:()=>assert.fail('historical export')};assert.equal(readDatabasePeople(['Alice'],{api,historical:true}).status,'historical');
});
test('ambiguous same-name database rows do not choose an identity',()=>{
    assert.equal(readDatabasePeople(['Alice'],{api:apiFor([{name:'Alice',appearance:'red hair'},{name:'Alice',appearance:'blue hair'}])}).people.length,0);
});
test('custom Chinese database result columns are recognized',()=>{
    const api={exportTableAsJson:()=>({sheet_chars:{name:'重要角色表',content:[['姓名','外貌特征','性别/年龄']]}}),queryTableRows:()=>({rows:[{'姓名':'三船诗织','外貌特征':'深栗色及肩短发，淡褐色瞳孔','性别/年龄':'女/18'}]})};
    const result=readDatabasePeople(['三船诗织'],{api});assert.equal(result.people[0].gender_age,'女/18');assert.equal(result.people[0].appearance,'深栗色及肩短发，淡褐色瞳孔');
});
test('bound people are excluded from database reference requests',async()=>{
    const state={version:1,scope:'one',people:{alice:{person:'Alice',scope:'one',chosen_appearance_tags:['black hair'],wardrobe:{description:'grey shirt'},style:'painterly'}}},payloads=[],namesRead=[];
    await prepareScenes([{excerpt:'Alice sits.',end:11,people:['Alice'],composition:'sitting'}],{chat:[{mes:'Alice sits.'}],messageId:0,state,resolver:{resolvePrompt(_p,s){return {state:s};}},databaseReader:names=>{namesRead.push(names);return {people:[],status:'no_match'};},fetcher:async(_url,opts)=>{payloads.push(JSON.parse(opts.body));return new Response(JSON.stringify({people:[{person:'Alice',clothing:{action:'keep'}}]}));}});
    assert.deepEqual(namesRead,[[]]);assert.deepEqual(payloads[0].reference_people,[]);assert.equal(state.people.alice.chosen_appearance_tags[0],'black hair');
});
test('new actor receives only permitted database facts and records provenance',async()=>{
    const state={version:1,scope:'one',people:{}},fact={person:'Alice',appearance:'brown hair, green eyes',age:'38',gender:'female',gender_age:''};let payload;
    const result=await prepareScenes([{excerpt:'Alice sits.',end:11,people:['Alice'],composition:'sitting'}],{chat:[{mes:'Alice sits.'}],messageId:0,state,databaseReader:names=>{assert.deepEqual(names,['Alice']);return {people:[fact],status:'matched'};},resolver:{resolvePrompt(_p,s){return {state:{...s,people:{alice:{person:'Alice',scope:'one',chosen_appearance_tags:['brown hair','green eyes'],wardrobe:{description:'grey shirt'},style:'painterly'}}}};}},fetcher:async(_url,opts)=>{payload=JSON.parse(opts.body);return new Response(JSON.stringify({people:[{person:'Alice',clothing:{action:'initial',description:'grey shirt'}}]}));}});
    assert.deepEqual(payload.reference_people,[fact]);assert.equal(result.state.people.alice.reference_source,'SP数据库');assert.deepEqual(state.people,{});
});

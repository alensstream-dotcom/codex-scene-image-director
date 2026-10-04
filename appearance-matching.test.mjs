import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createCatalog} from './catalog.mjs';import {listActorCandidates} from './character-tools.mjs';import {actorMatchProfile,extractAppearance} from './appearance-profile.mjs';
import {createIdentityResolver} from './identity.mjs';import {rerollActor} from './automatic-scene.mjs';
const read=async p=>JSON.parse(await fs.readFile(new URL(p,import.meta.url),'utf8'));
const [characters,taxonomy,index]=await Promise.all([read('./data/characters.browser.json'),read('./data/taxonomy.json'),read('./indexes/character-index.json')]);
const catalog=createCatalog({characters,taxonomy,index}),state={scope:'matching-qa',people:{}},person={person:'Alice',scope:'matching-qa',initial_query:{required:{gender:'female',hair_color:'black',hair_length:'long'}},chosen_appearance_tags:['1girl','black hair','long hair']};
test('all hard matches remain reachable beyond sixty with stable non-overlapping pages',()=>{
    const first=listActorCandidates(person,{catalog,state,limit:24}),ids=[];assert(first.total>60);
    for(let offset=0;offset<first.total;offset+=60){const page=listActorCandidates(person,{catalog,state,offset,limit:60});ids.push(...page.candidates.map(c=>c.id));assert(page.candidates.every(c=>c.evidence.every(e=>e.matched)));}
    assert.equal(ids.length,first.total);assert.equal(new Set(ids).size,first.total);
});
test('Chinese shorthand, overlapping colour/length and black-long-straight yield separate facts',()=>{
    const facts=extractAppearance('乌黑头发、黑色长发、黑长直，眼睛是蓝色眼睛，齐刘海',catalog);
    for(const tag of ['black hair','long hair','straight hair','blue eyes','blunt bangs'])assert(facts.some(m=>m.tag===tag),tag);
});
test('named narrative overrides accidental prototype attributes and never borrows another person',()=>{
    const p={...person,chosen_appearance_tags:['1girl','blonde hair','short hair','red eyes']};
    const profile=actorMatchProfile(p,{catalog,text:'Alice has long black hair and blue eyes. Beth has blonde hair and green eyes.',otherNames:['Beth']});
    assert.deepEqual(profile.query.required.hair_color,['black']);assert.deepEqual(profile.query.required.hair_length,['long']);assert.deepEqual(profile.query.required.eye_color,['blue']);
});
test('longer hairstyle phrase and explicit negation do not add contradictory traits',()=>{
    assert(!extractAppearance('双马尾，没有雀斑，不是黑发',catalog).some(m=>m.tag==='ponytail'||m.tag==='freckles'||m.tag==='black hair'));
});
test('explicit preferences and indexed facial details are strict until user broadens',()=>{
    const p={...person,initial_query:{required:{gender:'female',hair_color:'black'},preferred:{hair_length:'long'}},face_description:'freckles'};
    const strict=listActorCandidates(p,{catalog,state});assert(strict.profile.query.required.hair_length.includes('long'));assert(strict.profile.query.required_tags.includes('freckles'));
    assert(strict.candidates.every(c=>c.evidence.every(e=>e.matched)));
    const wide=listActorCandidates(p,{catalog,state,relax:true});assert(wide.total>=strict.total);assert(wide.candidates.every(c=>c.relaxed));
});
test('current matching identity is included and marked rather than silently hidden',()=>{
    const one=listActorCandidates(person,{catalog,state}).candidates[0],p={...person,prototype_id:one.id};const page=listActorCandidates(p,{catalog,state,query:one.name||one.id});assert(page.candidates.some(c=>c.current&&c.id===one.id));
});
test('editable conditions exclude clothing and control strings; colours mean OR',()=>{
    const p=actorMatchProfile(person,{catalog,filters:'黑发, 金发, 长发, 泪痣'});assert.deepEqual(p.query.required.hair_color,['black','blonde']);assert(p.query.required_tags.includes('mole under eye'));
    assert.throws(()=>actorMatchProfile(person,{catalog,filters:'black shirt'}),/无法识别/);assert.throws(()=>actorMatchProfile(person,{catalog,filters:'ADSCENE{}'}),/无法识别/);
});
test('raw provenance and curated eligibility survive taxonomy enrichment',()=>{
    assert.equal(characters.length,21541);assert.equal(characters.filter(r=>r.quality.eligible_default).length,8000);assert.equal(taxonomy.matching_revision,'2.1.5');
    for(const r of characters)assert(r.source_tag_string&&r.tags.every(t=>taxonomy.tags[t]));
});
test('strict candidate selection cannot bypass current filters by passing an unrelated id',()=>{
    const wrong=characters.find(r=>r.facets.gender?.includes('female')&&r.facets.hair_color?.includes('blonde')&&!r.facets.hair_color.includes('black')&&r.profile?.review_eligible!==false);
    const scene={id:'qa',composition:'library',actors:[{person:'Alice',person_snapshot:person,wardrobe:{description:'white shirt'},action_prompt:'reading'}]},resolver=createIdentityResolver(catalog,{taxonomy});
    assert.throws(()=>rerollActor(scene,'Alice',{state,catalog,resolver,candidateId:wrong.id}),/不符合当前剧情/);assert.equal(scene.actors[0].person_snapshot,person);
});
test('combined face marks remain conjunctive rather than being dropped as conflicts',()=>{
    const profile=actorMatchProfile(person,{catalog,text:'Alice has freckles and a mole under eye.'});
    assert(profile.query.required_tags.includes('freckles'));assert(profile.query.required_tags.includes('mole under eye'));
});
test('alternative colours remain a single OR condition with truthful evidence',()=>{
    const p={...person,initial_query:{required:{gender:'female',hair_color:['black','brown'],hair_length:'long'}}},page=listActorCandidates(p,{catalog,state});assert(page.total>0);assert(page.candidates.every(c=>c.evidence.every(e=>e.matched)));
});
test('unambiguous hair and eye evidence precedes high-popularity mixed variants',()=>{
    const page=catalog.matches({required:{gender:'female',hair_color:'black',hair_length:'long',eye_color:'blue'},include_limited:true},{limit:60});assert(page.total>60);assert(page.results.slice(1).every((r,i)=>r.source_ambiguity>=page.results[i].source_ambiguity));assert.equal(page.results[0].source_ambiguity,0);
});
test('Chinese alias search intersects multiple canonical tags without changing appearance conditions',()=>{
    const page=listActorCandidates(person,{catalog,state,query:'黑发, 长发, 蓝瞳'});assert(page.total>0);assert(page.candidates.every(c=>catalog.get(c.id).tags.includes('blue eyes')));assert.deepEqual(page.profile.query.required.hair_color,['black']);
});
test('a named observer or relative never supplies the subject appearance',()=>{
    const profile=actorMatchProfile(person,{catalog,text:"Alice saw a woman with blonde hair. Alice's sister has green eyes. Alice has black hair and blue eyes."});assert.deepEqual(profile.query.required.hair_color,['black']);assert.deepEqual(profile.query.required.eye_color,['blue']);
});

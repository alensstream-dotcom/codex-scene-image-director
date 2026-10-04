import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapWardrobes } from './wardrobe.mjs';
import { readIdentityControls } from './identity.mjs';
import { syncNativeManagers, applyNativeEdits } from './native-manager.mjs';
import { repairInterleavedFormat } from './prompt-format.mjs';
import { PLANNING_REGEX, PLANNING_TAIL_REGEX, PLACEHOLDER_REGEX, installPlanningFilter } from './display-filter.mjs';
const scope='wardrobe-test';
const state=()=>({version:1,scope,people:{a:{scope,person:'Alice',prototype_id:'fixture',chosen_appearance_tags:['1girl','black hair','blue eyes'],style:'mikko'}}});

test('active ICOT format repair preserves source preset, other prompts and sampling',()=>{
 const original={temperature:0.9,prompts:[{identifier:'format',content:'prefix <Interleaved_thinking>\n{{思考内容}}\n{{正文内容}}\n</Interleaved_thinking> suffix'},{identifier:'character',content:'user character rules'}]};
 const result=repairInterleavedFormat(original);
 assert.equal(result.changed,1);assert.equal(result.preset.temperature,0.9);
 assert.deepEqual(result.preset.prompts[1],original.prompts[1]);assert(original.prompts[0].content.includes('{{思考内容}}'));
 assert(!result.preset.prompts[0].content.includes('{{思考内容}}'));assert(result.preset.prompts[0].content.startsWith('prefix '));
 assert.equal(repairInterleavedFormat(result.preset).changed,0);
});
test('existing chat backfills complete clothing without altering appearance',()=>{
 const first='image###Scene Composition:ADEX{"person":"Alice"}END An adult woman stands in a dark blue fitted dress, black heels, smiling, 704x1152;###';
 const later='image###Scene Composition:ADEX{"person":"Alice"}END She wears her fitted dress, 704x1152;###';
 const original=state();
 const result=bootstrapWardrobes(original,[{mes:first},{mes:later}],readIdentityControls);
 assert.equal(original.people.a.wardrobe,undefined);
 assert.ok(result.state.people.a.wardrobe.description.includes('dark blue'));
 assert.ok(result.state.people.a.wardrobe.description.includes('black heels'));
 assert.deepEqual(result.state.people.a.chosen_appearance_tags,original.people.a.chosen_appearance_tags);
});
test('native outfit links its owner; edits update clothing and preserve media',()=>{
 const original=state(); original.people.a.wardrobe={description:'gray t-shirt and dark shorts',tags:[]};
 const native={characterPresets:{},outfitPresets:{}};
 const synced=syncNativeManagers(original,native,{},{}), link=synced.selected[0];
 assert.deepEqual(native.characterPresets[link.character].outfits,[link.outfit]);
 assert.equal(native.outfitPresets[link.outfit].upperBody,'gray t-shirt');
 assert.equal(native.outfitPresets[link.outfit].fullBody,'dark shorts');
 native.outfitPresets[link.outfit].upperBody='red blouse';
 native.characterPresets[link.character].photoMedia=[{id:'keep-my-photo'}];
 const edited=applyNativeEdits(original,native,synced.links);
 assert.ok(edited.state.people.a.wardrobe.description.includes('red blouse'));
 assert.equal(edited.state.people.a.prototype_id,'fixture');
 syncNativeManagers(edited.state,native,synced.links,{});
 assert.deepEqual(native.characterPresets[link.character].photoMedia,[{id:'keep-my-photo'}]);
});
test('display hides planning while preserving every image block, prose and status',()=>{
 const img=n=>`image###Scene Composition:person ${n}, 704x1152;###`;
 const source=`正文保留。\n☆插图规划（共 3 张）\n图1\n①构图草案 ${img(1)}\n图2\n②思考草案 ${img(2)}\n图3\n③规划草案 ${img(3)}\n尾部规划\n<details>状态栏</details>`;
 const hidden=source.replace(PLANNING_TAIL_REGEX,'').replace(PLANNING_REGEX,'');
 assert.ok(hidden.includes('正文保留。'));
 assert.ok(hidden.includes('<details>状态栏</details>'));
 assert.equal(hidden.includes('规划'),false);
 assert.deepEqual(hidden.match(/image###.*?###/g),[img(1),img(2),img(3)]);
 const ordinary=`普通剧情\n${img(1)}\n普通后续剧情\n${img(2)}`;
 assert.equal(ordinary.replace(PLANNING_TAIL_REGEX,'').replace(PLANNING_REGEX,''),ordinary);
 const settings={regex:[{id:'user-regex'}]}; installPlanningFilter(settings); installPlanningFilter(settings);
 assert.equal(settings.regex.length,5); assert.equal(settings.regex[0].id,'user-regex');
});

test('literal ICOT template lines disappear without removing actual prose or image buttons',()=>{
 const image='image###Scene Composition:1girl, reading, blue blouse;###';
 const source=`真实正文。\n${image}\n{{思考内容}}\n{{正文内容}}\n\n{{思考内容}}\n{{正文内容}}\n<Status_block>状态</Status_block>`;
 const output=source.replace(PLACEHOLDER_REGEX,'');
 assert(output.includes('真实正文'));assert(output.includes(image));assert(output.includes('<Status_block>'));
 assert(!output.includes('{{思考内容}}'));assert(!output.includes('{{正文内容}}'));
 assert.equal('她说：{{正文内容}}不是小说。'.replace(PLACEHOLDER_REGEX,''),'她说：{{正文内容}}不是小说。');
});

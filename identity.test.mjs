import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog } from './catalog.mjs';
import { createIdentityResolver } from './identity.mjs';

const root = new URL('./', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [characters, outfits, taxonomy, index] = await Promise.all([
  read('data/characters.browser.json'), read('data/outfits.browser.json'), read('data/taxonomy.json'), read('indexes/character-index.json'),
]);
const catalog = createCatalog({ characters, outfits, taxonomy, index });
const resolver = createIdentityResolver(catalog, { taxonomy });
const marker = spec => `ADEX${JSON.stringify(spec)}END`;
const blank = () => ({ version: 1, people: {} });
const bind = (spec, state = blank(), scope = 'test-chat') => resolver.resolvePrompt(marker(spec), state, { scope });

test('age remains descriptive; it cannot invalidate a valid catalog identity',()=>{
  const out=bind({person:'AgeFixture',required:{gender:['female'],hair_color:['black'],hair_length:['medium'],age:['mature']},preferred:{bust:['large']}});
  assert.equal(out.bindings.length,1);assert.equal(out.bindings[0].status,'ok');
  assert(out.text.includes('mature adult'));assert(!out.warnings.some(x=>x.code==='invalid_query'));
  const saved=Object.values(out.state.people)[0];assert(!('age' in saved.initial_query.required));
  const teen=bind({person:'NonsexualAgeFixture',required:{age:['teenager'],hair_color:['black']}});
  assert.equal(teen.bindings.length,1);assert(teen.text.includes('teenage'));
});

test('ordinary borrowed appearances exclude unrequested nonhuman anatomy and pets',()=>{
  const forced = createIdentityResolver({ ...catalog, retrieve:()=>({results:[{id:'imhotep_(neural_cloud)',prepared:{appearance_tags:['1girl','black hair','animal ears','tail','wings','horns','cat']}}]}) }, {taxonomy});
  const plain=forced.resolvePrompt(marker({person:'Human'}),blank());
  assert.deepEqual(plain.bindings[0].chosen_appearance_tags,['1girl','black hair','long hair']);
  const ears=forced.resolvePrompt(marker({person:'Catgirl',required_tags:['animal ears']}),blank());
  assert(ears.bindings[0].chosen_appearance_tags.includes('animal ears'));
  assert(!ears.bindings[0].chosen_appearance_tags.includes('cat'));
  const exact=bind({person:'Imhotep',id:'imhotep_(neural_cloud)'});
  assert(exact.bindings[0].chosen_appearance_tags.includes('animal ears'));
  assert(!exact.bindings[0].chosen_appearance_tags.includes('cat'));
});

test('clothing color persists across pose/style changes; explicit change keeps identity', () => {
  const first = resolver.resolvePrompt(`${marker({ person:'Clothes' })} An adult woman is wearing a dark blue fitted dress and black heels.`, blank(), { scope:'wardrobe' });
  const repeated = resolver.resolvePrompt(`${marker({ person:'Clothes', style:'rdbt', clothing:{action:'keep'} })} The woman sits in her fitted dress.`, first.state, { scope:'wardrobe' });
  assert.equal(repeated.bindings[0].prototype_id, first.bindings[0].prototype_id);
  assert.ok(repeated.text.includes('dark blue fitted dress'));
  const changed = resolver.resolvePrompt(`${marker({ person:'Clothes', clothing:{action:'change',description:'opaque red blouse and black trousers'} })} She walks.`, repeated.state, { scope:'wardrobe' });
  assert.equal(changed.bindings[0].prototype_id, first.bindings[0].prototype_id);
  assert.ok(changed.text.includes('opaque red blouse'));
  assert.equal(changed.text.includes('dark blue fitted dress'), false);
  assert.ok(repeated.bindings[0].wardrobe.description.includes('dark blue'));
});

test('malformed wardrobe change keeps previous clothing', () => {
  const first = bind({ person:'SafeClothes', clothing:{action:'initial',description:'blue dress'} });
  const invalid = bind({ person:'SafeClothes', clothing:{action:'change',description:'@PC98; image###'} }, first.state);
  assert.equal(invalid.bindings[0].wardrobe.description, 'blue dress');
  assert.ok(invalid.warnings.some(value => value.code === 'invalid_clothing'));
});

test('loads the actual 21541-character female-first catalog', () => {
  assert.equal(catalog.stats.characters, 21541);
  assert.equal(characters.filter(record => record.facets.gender?.includes('male')).length, 10);
  assert.ok(catalog.stats.outfits > 1000);
});

test('generic female identity is stable, immutable, and carries no prototype trigger', () => {
  const state = blank(), original = JSON.stringify(state);
  const first = bind({ person: '旅店老板娘', required: { hair_color: 'black' }, preferred: { eye_color: 'green' } }, state);
  assert.equal(JSON.stringify(state), original);
  assert.equal(first.bindings[0].status, 'ok');
  assert.ok(first.bindings[0].chosen_appearance_tags.includes('1girl'));
  assert.equal(first.bindings[0].trigger_included, true);
  assert.equal(first.bindings[0].style, 'model_default');
  assert.equal(first.text.includes(catalog.get(first.bindings[0].prototype_id).trigger), true);
  assert.equal((first.text.match(/@style:/g) || []).length, 1);
  const saved = JSON.stringify(first.state);
  const second = bind({ person: '旅店老板娘', required: { hair_color: 'blonde' }, preferred_tags: ['blue eyes'] }, first.state);
  assert.equal(second.bindings[0].prototype_id, first.bindings[0].prototype_id);
  assert.deepEqual(second.bindings[0].chosen_appearance_tags, first.bindings[0].chosen_appearance_tags);
  assert.equal(second.changed, false);
  assert.equal(JSON.stringify(first.state), saved);
  assert.ok(second.warnings.some(warning => warning.code === 'identity_conflict'));
});

test('different people use different prototypes and restarting from empty state is deterministic', () => {
  const spec = { person: 'Alice', preferred: { hair_color: 'black', eye_color: 'green' } };
  const one = bind(spec);
  const same = bind(spec);
  assert.equal(one.bindings[0].prototype_id, same.bindings[0].prototype_id);
  const two = bind({ ...spec, person: 'Beatrice' }, one.state);
  assert.notEqual(one.bindings[0].prototype_id, two.bindings[0].prototype_id);
  assert.equal(Object.keys(two.state.people).length, 2);
  const otherScope = bind(spec, two.state, 'another-chat');
  assert.equal(Object.keys(otherScope.state.people).length, 3);
  assert.notEqual(otherScope.bindings[0].key, one.bindings[0].key);
});

test('hard no-match never relaxes, and explicit appearance remains stable', () => {
  const first = bind({ person: 'Impossible', required: { hair_color: 'nonexistent color' }, required_tags: ['blue eyes'] });
  assert.equal(first.bindings[0].prototype_id, null);
  assert.equal(first.bindings[0].status, 'no_match');
  assert.ok(first.text.includes('blue eyes'));
  assert.ok(first.text.includes('1girl'));
  assert.ok(first.warnings.some(warning => warning.code === 'no_match'));
  const again = bind({ person: 'Impossible', required: { hair_color: 'black' } }, first.state);
  assert.equal(again.bindings[0].prototype_id, null);
  assert.deepEqual(again.bindings[0].chosen_appearance_tags, first.bindings[0].chosen_appearance_tags);
});

test('exact Yor lookup includes her trigger; outfit changes persist without changing appearance', () => {
  const first = bind({ person: 'Yor', id: 'yor_briar', outfit: { required_tags: ['dress'] } });
  assert.equal(first.bindings[0].prototype_id, 'yor_briar');
  assert.equal(first.bindings[0].trigger_included, true);
  assert.ok(first.text.includes(catalog.get('yor_briar').trigger));
  assert.ok(first.bindings[0].outfit_id);
  const second = bind({ person: 'Yor', outfit: { required_tags: ['pants'] } }, first.state);
  assert.equal(second.bindings[0].prototype_id, 'yor_briar');
  assert.deepEqual(second.bindings[0].chosen_appearance_tags, first.bindings[0].chosen_appearance_tags);
  assert.notEqual(second.bindings[0].outfit_id, first.bindings[0].outfit_id);
  assert.equal(second.changed, true);
  assert.notDeepEqual(second.state, first.state);
  assert.equal(Object.values(first.state.people).some(entry => 'outfit_id' in entry), false);
});

test('an inexact ID never falls back to character-name substring', () => {
  const out = bind({ person: 'Yor', id: 'yor' });
  assert.equal(out.bindings[0].prototype_id, null);
  assert.equal(out.bindings[0].trigger_included, false);
  assert.ok(out.warnings.some(warning => warning.code === 'no_match'));
});

test('JSON nesting and quoted braces parse without altering SceneComposition', () => {
  const spec = { person: 'A {brace} "quoted"', required: { hair_color: ['black', 'brown'] },
    outfit: { required: { color: ['white', 'blue'] }, preferred_tags: ['dress'] }, style: 'bluearchive' };
  const head = '<SceneComposition><Subjects> ', tail = ' </Subjects><Action>reading together</Action></SceneComposition>';
  const out = resolver.resolvePrompt(`${head} ADEX \n${JSON.stringify(spec, null, 2)} \nEND ${tail}`, blank(), { scope: 'composition' });
  assert.equal(out.bindings.length, 1);
  assert.ok(out.text.startsWith(head));
  assert.ok(out.text.endsWith(tail));
  assert.equal(out.text.includes('ADEX'), false);
  assert.ok(out.text.includes('@style:bluearchive'));
  assert.equal(out.warnings.some(warning => warning.code === 'invalid_marker'), false);
});

test('multi-person output keeps names, one focus style, and disables global Nilou LoRA', () => {
  const source = `${marker({ person: 'Nilou', id: 'nilou_(genshin_impact)', style: 'pc98' })} facing ${marker({ person: 'Alice', style: 'rdbt' })}`;
  const out = resolver.resolvePrompt(source, blank(), { scope: 'two-person' });
  assert.equal(out.bindings.length, 2);
  assert.ok(out.text.startsWith('Nilou: '));
  assert.ok(out.text.includes('Alice: '));
  assert.equal((out.text.match(/@style:/g) || []).length, 1);
  assert.ok(out.text.includes('@style:rdbt'));
  assert.equal(out.text.includes('@character:Nilou'), false);
  assert.ok(out.warnings.some(warning => warning.code === 'character_lora_disabled_multi_person'));
  assert.equal(out.bindings[0].trained_character_binding.auto_apply, false);
});

test('only a single exact Nilou binding emits the tested character selector', () => {
  const exact = bind({ person: 'Nilou', id: 'nilou_(genshin_impact)' });
  assert.ok(exact.text.includes('@character:Nilou'));
  assert.equal(exact.bindings[0].trained_character_binding.suggested_strength, 0.4);
  const generic = bind({ person: 'Nilou', required: { hair_color: 'red', eye_color: 'aqua' } });
  assert.equal(generic.text.includes('@character:Nilou'), false);
  assert.equal(generic.bindings[0].trained_character_binding, undefined);
});

test('explicit style update is allowed without resampling; invalid style is retained with warning', () => {
  const first = bind({ person: 'Alice', style: 'mikko' });
  const switched = bind({ person: 'Alice', style: 'rdbt' }, first.state);
  assert.equal(switched.bindings[0].prototype_id, first.bindings[0].prototype_id);
  assert.equal(switched.changed, true);
  assert.ok(switched.text.includes('@style:rdbt'));
  const invalid = bind({ person: 'Alice', style: 'not-a-file-or-style' }, switched.state);
  assert.ok(invalid.text.includes('@style:rdbt'));
  assert.ok(invalid.warnings.some(warning => warning.code === 'invalid_style'));
});

test('malformed markers are preserved, and protected property-like names remain ordinary people', () => {
  const bad = '<SceneComposition>ADEX{"person":"oops"} trailing</SceneComposition>';
  const unchanged = resolver.resolvePrompt(bad, blank(), { scope: 'invalid' });
  assert.equal(unchanged.text, bad);
  assert.equal(unchanged.bindings.length, 0);
  assert.ok(unchanged.warnings.some(warning => warning.code === 'invalid_marker'));
  const out = bind({ person: '__proto__' });
  assert.equal(out.bindings[0].person, '__proto__');
  assert.equal(Object.getPrototypeOf(out.state.people), Object.prototype);
  assert.equal(Object.keys(out.state.people).length, 1);
});

test('invalid required-query shapes are warned instead of silently converted to no conditions', () => {
  const source = marker({ person: 'Alice', required: [] });
  const out = resolver.resolvePrompt(source, blank());
  assert.equal(out.bindings.length, 0);
  assert.equal(out.text, source);
  assert.equal(Object.keys(out.state.people).length, 0);
  assert.ok(out.warnings.some(warning => warning.code === 'invalid_query'));
});

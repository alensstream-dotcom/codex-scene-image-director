/** Pure stable story identities. The caller owns the state and the catalog. */
import { resolveWardrobe, wardrobeText } from './wardrobe.mjs';
import {findPerson} from './character-tools.mjs';
import {protectIdentityTags,nativeBodyField} from './drawing-policy.mjs';
// Missing flags retain the behavior of old saved profiles and image snapshots.
export const usesPrototypeTrigger = person => person?.trigger_enabled ?? !!person?.exact_id;
export const usesImageReference = person => person?.reference_enabled ?? !!person?.reference_ids?.length;
export function migrateIdentityFlags(people,catalog) {
  let changed=false;
  for(const person of Object.values(people || {})) {
    if(!person || typeof person!=='object')continue;
    if(typeof person.trigger_enabled!=='boolean'){person.trigger_enabled=!!person.exact_id;changed=true;}
    if(typeof person.reference_enabled!=='boolean'){person.reference_enabled=!!person.reference_ids?.length;changed=true;}
    if(!person.prototype_trigger && person.prototype_id) {
      const trigger=catalog?.get?.(person.prototype_id)?.trigger;
      if(trigger){person.prototype_trigger=trigger;changed=true;}
    }
    if(!person.style_explicit&&person.style!=='model_default'){person.previous_auto_style=person.style;person.style='model_default';person.style_chosen=true;changed=true;}
    if(!person.prototype_id&&!person.chosen_appearance_tags?.some(t=>/^(very |absurdly )?(short|medium|long) hair$/.test(t))){
      const length=[...(person.initial_query?.required?.hair_length||[]),...(person.initial_query?.preferred?.hair_length||[])].find(t=>['short','medium','long','very long'].includes(t))||'long';
      person.chosen_appearance_tags=[...(person.chosen_appearance_tags||[]),length+' hair'];person.appearance_completion='missing_hair_length_locked';changed=true;
    }
  }
  return changed;
}
const STYLES = new Set(['model_default','painterly', 'mikko', 'bluearchive', 'rdbt', 'pc98']);
const QUERY_FIELDS = ['required', 'preferred', 'required_tags', 'preferred_tags', 'archetypes', 'preferred_archetypes'];
const MARKER_FIELDS = new Set(['person', 'id', 'style', 'outfit', 'clothing', 'face_description', 'age', ...QUERY_FIELDS]);
const GENDER_TAGS = { female: '1girl', male: '1boy', ambiguous: '1other' };
const uniq = values => [...new Set(values)];
const clean = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const array = value => Array.isArray(value) ? value : [value];
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const json = value => JSON.stringify(stable(value));
const clone = value => JSON.parse(JSON.stringify(value));
const FACETS = new Set(['gender','height','age_group','age_evidence','species','hair_color','hair_length','hair_pattern','hair_style','bangs','eye_color','eye_features','skin','build','bust','ears','horns','tail','wings','face','marks','anatomy','facial_hair']);
const FACET_ALIASES = {'性别':'gender','发色':'hair_color','发长':'hair_length','发型':'hair_style','瞳色':'eye_color','肤色':'skin','体型':'build','胸型':'bust','种族':'species','耳朵':'ears'};
function ageDescription(spec) {
  const value=array(spec.age ?? spec.required?.age ?? spec.required?.['年龄'] ?? spec.preferred?.age ?? spec.preferred?.['年龄'] ?? []).map(clean)[0];
  if (!value) return '';
  if (/^\d{1,3}$/.test(value) && Number(value)>0 && Number(value)<=110) return `${value} years old`;
  return ({adult:'adult',mature:'mature adult',middle_aged:'middle-aged adult','middle-aged':'middle-aged adult',teenager:'teenage',teen:'teenage',child:'child',elderly:'elderly adult','成年':'adult','成熟':'mature adult','中年':'middle-aged adult','青少年':'teenage'})[value.toLowerCase()] || '';
}

/** Braces inside quoted JSON strings never count as nesting. */
function scanMarker(text, start) {
  let at = start + 4;
  while (at < text.length && /\s/.test(text[at])) at++;
  if (text[at] !== '{') return null;
  const open = at;
  let depth = 0, inString = false, escaped = false;
  for (; at < text.length; at++) {
    const char = text[at];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      let end = at + 1;
      while (end < text.length && /\s/.test(text[end])) end++;
      if (!text.startsWith('END', end)) return { error: 'missing_END', end: at + 1 };
      return { source: text.slice(open, at + 1), end: end + 3 };
    }
  }
  return { error: 'unclosed_json', end: start + 4 };
}

export function readIdentityControls(text) {
  const markers = [];
  for (let at = 0; at < text.length;) {
    const start = text.indexOf('ADEX', at);
    if (start < 0) break;
    const marker = scanMarker(text, start);
    if (!marker) { at = start + 4; continue; }
    if (!marker.error) {
      try { const spec = JSON.parse(marker.source); if (typeof spec.person === 'string' && clean(spec.person)) markers.push({ start, end:marker.end, spec }); } catch {}
    }
    at = marker.end;
  }
  return markers;
}

export function createIdentityResolver(catalog, { taxonomy } = {}) {
  if (!catalog || typeof catalog.retrieve !== 'function' || typeof catalog.get !== 'function'
    || typeof catalog.normalizeQuery !== 'function') throw new TypeError('A catalog API is required');
  if (!taxonomy?.tags) throw new TypeError('The catalog taxonomy is required');
  const info = taxonomy.tags;
  const warn = (warnings, code, person, scope, message) => warnings.push({ code, person: person ?? null, scope, message });

  function queryFor(marker, scope, person, excluded, isBound, warnings) {
    if (own(marker, 'required') && (!marker.required || typeof marker.required !== 'object' || Array.isArray(marker.required)))
      throw new Error('required must be a facet-query object');
    const query = { kind: 'character', limit: 1, include_trigger: false, seed: json([scope, person]), exclude_ids: excluded };
    for (const field of QUERY_FIELDS) if (own(marker, field)) query[field] = marker[field];
    for (const field of ['required','preferred']) {
      if (query[field] && (typeof query[field]!=='object' || Array.isArray(query[field]))) throw new Error(`${field} must be a facet-query object`);
      query[field] = Object.fromEntries(Object.entries(query[field] || {}).filter(([key])=>{
        if (['age','年龄'].includes(key)) return false; // Descriptive age is not an indexed catalog fact.
        if (FACETS.has(FACET_ALIASES[key] || key)) return true;
        warn(warnings,'unsupported_facet',person,scope,`未索引的外貌条件 ${key} 已跳过；其余条件继续匹配。`);return false;
      }).map(([key,value])=>[key,(FACET_ALIASES[key] || key)==='bust' ? array(value).map(x=>['small','medium','large','huge'].includes(x)?`${x} breasts`:x) : value]));
    }
    query.required = { ...(query.required || {}) };
    if (!own(query.required, 'gender') && !own(query.required, '性别') && !marker.id && !isBound) {
      const requested = array(query.required_tags || []).map(tag => info[tag]?.facet === 'gender' ? info[tag]?.value : null).filter(Boolean);
      query.required.gender = requested.length ? requested : 'female';
    }
    return catalog.normalizeQuery(query);
  }

  function explicitTags(query) {
    const tags = [...query.required_tags];
    for (const [facet, values] of Object.entries(query.required)) {
      const value = values[0]; // Values within a facet mean OR, not an impossible conjunction.
      if (facet === 'gender' && GENDER_TAGS[value]) { tags.push(GENDER_TAGS[value]); continue; }
      const options = Object.entries(info).filter(([, meta]) => meta.facet === facet && meta.value === value)
        .map(([tag]) => tag).sort((a, b) => a.length - b.length || a.localeCompare(b));
      if (options.length) tags.push(options.includes(value) ? value : options[0]);
    }
    return uniq(tags);
  }

  function prepareExact(record, query) {
    let tags = uniq([...(record.appearance_tags || []), ...(record.tags || []).filter(tag => info[tag]?.facet === 'species' && tag !== 'no humans')]);
    const lengths = ['very short', 'short', 'medium', 'long', 'very long', 'absurdly long'];
    for (const facet of ['hair_color', 'eye_color', 'hair_length', 'bust']) {
      const values = record.facets[facet] || [];
      if (!values.length) continue;
      const choices = [...(query.required[facet] || []), ...query.required_tags.filter(tag => info[tag]?.facet === facet).map(tag => info[tag].value),
        ...(query.preferred[facet] || []), ...query.preferred_tags.filter(tag => info[tag]?.facet === facet).map(tag => info[tag].value)];
      let chosen = choices.find(value => values.includes(value));
      const multicolor = facet === 'hair_color' && (record.facets.hair_pattern || []).length
        || facet === 'eye_color' && ['heterochromia', 'multicolored eyes', 'two-tone eyes', 'gradient eyes'].some(tag => record.tags.includes(tag));
      if (multicolor && chosen === undefined) continue;
      if (chosen === undefined) chosen = facet === 'hair_length' ? [...values].sort((a, b) => lengths.indexOf(b) - lengths.indexOf(a))[0] : values[0];
      tags = tags.filter(tag => info[tag]?.facet !== facet || info[tag].value === chosen);
    }
    const gender = [...(query.required.gender || []), ...(record.facets.gender || [])].find(value => (record.facets.gender || []).includes(value));
    if (GENDER_TAGS[gender]) tags.unshift(GENDER_TAGS[gender]);
    return uniq(tags);
  }

  function mismatches(entry, query, record) {
    const facets = {};
    for (const tag of entry.chosen_appearance_tags || []) {
      const meta = info[tag];
      if (meta) (facets[meta.facet] ||= []).push(meta.value);
    }
    const tags = new Set(entry.chosen_appearance_tags || []), problems = [];
    for (const [facet, values] of Object.entries(query.required)) {
      const actual = facets[facet]?.length ? facets[facet] : record?.facets?.[facet] || [];
      if (!values.some(value => actual.includes(value))) problems.push(facet);
    }
    for (const tag of query.required_tags) {
      if (tags.has(tag)) continue;
      const meta = info[tag], actual = facets[meta?.facet];
      if (!(actual?.length ? actual.includes(meta.value) : record?.tags?.includes(tag))) problems.push(`tag:${tag}`);
    }
    for (const archetype of query.archetypes) if (!(record?.archetypes || []).some(value => value.id === archetype)) problems.push(`archetype:${archetype}`);
    return problems;
  }

  return { resolvePrompt, catalog };

  function resolvePrompt(input, inputState, { scope: rawScope = 'default' } = {}) {
    const text = String(input ?? ''), scope = clean(rawScope) || 'default', warnings = [], bindings = [];
    const validState = inputState?.version === 1 && inputState.people && typeof inputState.people === 'object' && !Array.isArray(inputState.people);
    const state = { version: 1, people: validState ? clone(inputState.people) : {} };
    if (inputState && !validState) warn(warnings, 'invalid_state', null, scope, 'Identity state was invalid and has been initialized.');
    let changed = false;
    const markers = [];
    for (let at = 0; at < text.length;) {
      const start = text.indexOf('ADEX', at);
      if (start < 0) break;
      const marker = scanMarker(text, start);
      if (!marker) { at = start + 4; continue; }
      if (marker.error) { warn(warnings, 'invalid_marker', null, scope, `Unchanged marker: ${marker.error}.`); at = marker.end; continue; }
      try {
        const spec = JSON.parse(marker.source);
        if (!spec || typeof spec !== 'object' || Array.isArray(spec) || typeof spec.person !== 'string' || !clean(spec.person)) throw new Error('person must be a nonempty string');
        if (own(spec, 'id') && (typeof spec.id !== 'string' || !spec.id.trim())) throw new Error('id must be an exact nonempty catalog ID');
        markers.push({ start, end: marker.end, spec, person: clean(spec.person) });
      } catch (error) { warn(warnings, 'invalid_marker', null, scope, `Unchanged marker: ${error.message}.`); }
      at = marker.end;
    }
    const replacements = [], multiplePeople = new Set(markers.map(marker => marker.person)).size > 1;
    for (const marker of markers) {
      const { spec } = marker, matched=findPerson(state.people,marker.person,scope),person=matched?.[1].person||marker.person,key=matched?.[0]||json([scope,person]);
      for (const field of Object.keys(spec)) if (!MARKER_FIELDS.has(field)) warn(warnings, 'unknown_field', person, scope, `Ignored field: ${field}. Personality is not canonical catalog evidence.`);
      const existing = own(state.people, key) ? state.people[key] : null;
      if(existing&&marker.person!==person&&!(existing.aliases||[]).includes(marker.person)){existing.aliases=[...(existing.aliases||[]),marker.person];changed=true;}
      const excluded = Object.entries(state.people).filter(([otherKey, entry]) => otherKey !== key && entry?.scope === scope)
        .map(([, entry]) => entry.prototype_id).filter(Boolean);
      let query;
      try { query = queryFor(spec, scope, person, excluded, !!existing, warnings); }
      catch (error) { warn(warnings, 'invalid_query', person, scope, error.message); continue; }
      let entry;
      if (existing && Array.isArray(existing.chosen_appearance_tags)) {
        entry = existing;
        if (spec.id && spec.id !== entry.prototype_id) warn(warnings, 'identity_conflict', person, scope, 'A different exact ID was requested; the stored identity is retained.');
        const record = entry.prototype_id ? catalog.get(entry.prototype_id) : null;
        if (entry.prototype_id && !record) warn(warnings, 'prototype_missing', person, scope, 'Stored prototype is absent from the current catalog; stored appearance is retained.');
        const conflicts = mismatches(entry, query, record);
        if (conflicts.length) warn(warnings, 'identity_conflict', person, scope, `New hard conditions conflict with the stored appearance: ${conflicts.join(', ')}. The identity is retained.`);
        if (entry.status === 'no_match') warn(warnings, 'no_match', person, scope, 'The stored identity has no matching prototype; explicit appearance is retained.');
      } else {
        let record = null, result = null;
        if (spec.id) {
          record = catalog.isExcluded?.(spec.id)?null:catalog.get(spec.id);
          if (!record) warn(warnings, 'no_match', person, scope, 'The exact catalog ID does not exist; no name-substring fallback was attempted.');
        } else if(!query.required.gender?.includes('male')) result = catalog.retrieve(query).results[0] || null;
        let appearance = record ? prepareExact(record, query) : result?.prepared.appearance_tags || explicitTags(query);
        const requestedFacets = new Set([...Object.keys(query.required), ...Object.keys(query.preferred),
          ...query.required_tags.map(tag=>info[tag]?.facet), ...query.preferred_tags.map(tag=>info[tag]?.facet)]);
        const nonhuman = new Set(['ears','tail','wings','horns','species']);
        appearance=appearance.filter(tag=> {
          const meta=info[tag];
          // Pet/object tags in a character's reference image are not its anatomy.
          if (meta?.source_tree_hints?.some(path=>path[0]==='物品'&&path.includes('动物'))) return false;
          return !!record || !nonhuman.has(meta?.facet) || requestedFacets.has(meta.facet);
        });
        if (!record) {
          // A hairstyle supplied by the story excludes incompatible catalog
          // variants such as a ponytail plus two braids on the same person.
          const hair=query.required.hair_style || query.preferred.hair_style;
          if (hair?.length) appearance=appearance.filter(tag=>info[tag]?.facet!=='hair_style'||hair.includes(info[tag].value));
          const age=ageDescription(spec);
          appearance=protectIdentityTags(appearance,age,info);
        }
        if (!record && !result && !appearance.some(tag => ['1girl', '1boy', '1other'].includes(tag))) appearance.unshift('1girl');
        if(!appearance.some(tag=>info[tag]?.facet==='hair_length'))appearance.push((query.required.hair_length?.[0]||query.preferred.hair_length?.[0]||'long')+' hair');
        const prototypeId = record?.id || result?.id || null;
        entry = { scope, person, prototype_id: prototypeId, chosen_appearance_tags: appearance, exact_id: !!record,
          prototype_trigger: record?.trigger || result?.prepared.prototype_trigger || null, trigger_enabled: !!prototypeId, reference_enabled: false, status: prototypeId ? 'ok' : query.required.gender?.includes('male')?'narrative':'no_match', initial_query: query, style: 'model_default',aliases:[],artist_tags:[],source_tag_string:(record||catalog.get(prototypeId))?.source_tag_string||null };
        if (!prototypeId) warn(warnings, 'no_match', person, scope, 'No prototype satisfies the hard conditions. Constraints were not relaxed; only explicit appearance is rendered.');
        if (record) {
          const conflicts = mismatches(entry, query, record);
          if (conflicts.length) warn(warnings, 'identity_conflict', person, scope, `The exact character conflicts with these hard conditions: ${conflicts.join(', ')}. Its exact identity is retained.`);
          if (excluded.includes(record.id)) warn(warnings, 'duplicate_exact_id', person, scope, 'This explicitly requested prototype is already bound to another person.');
        }
        Object.defineProperty(state.people, key, { value: entry, enumerable: true, writable: true, configurable: true });
        changed = true;
      }
      if (!entry.exact_id && !entry.face_description && typeof spec.face_description === 'string'
        && spec.face_description.length <= 700 && !/[;{}@<>]/.test(spec.face_description)) {
        entry.face_description = clean(spec.face_description); changed = true;
      }
      const describedAge=ageDescription(spec);
      if (describedAge && !entry.age_description) { entry.age_description=describedAge;changed=true; }
      if (!STYLES.has(entry.style)) { entry.style = 'model_default'; changed = true; }
      if (own(spec, 'style')) {
        if (!STYLES.has(spec.style)) warn(warnings, 'invalid_style', person, scope, 'Style must be painterly, mikko, bluearchive, rdbt, or pc98; the stored style is retained.');
        else if (entry.style_chosen && entry.style !== spec.style) warn(warnings, 'style_locked', person, scope, 'The saved style is retained; change it explicitly in the character manager.');
        else if (entry.style !== spec.style) { entry.style = spec.style; changed = true; }
      }
      let outfit = null;
      if (own(spec, 'outfit')) {
        try {
          if (!spec.outfit || typeof spec.outfit !== 'object' || Array.isArray(spec.outfit)) throw new Error('outfit must be a query object');
          outfit = catalog.retrieve({ ...spec.outfit, kind: 'outfit', limit: 1, include_trigger: false, seed: json([scope, person, spec.outfit]) }).results[0] || null;
          if (!outfit) warn(warnings, 'outfit_no_match', person, scope, 'No outfit satisfies its hard conditions; the identity was not changed.');
        } catch (error) { warn(warnings, 'invalid_outfit', person, scope, error.message); }
      }
      const following = text.slice(marker.end, markers[markers.indexOf(marker) + 1]?.start);
      const clothing = resolveWardrobe(entry.wardrobe || null, spec, following, outfit);
      if (clothing.changed) { entry.wardrobe = clothing.wardrobe; changed = true; }
      for (const message of clothing.warnings) warn(warnings, 'invalid_clothing', person, scope, message);
      const tags = [...(usesPrototypeTrigger(entry) && entry.prototype_trigger ? [entry.prototype_trigger] : []), ...entry.chosen_appearance_tags];
      const appearancePrompt = [...tags, entry.age_description, entry.face_description].filter(Boolean).join(', ');
      const binding = { person, scope, key, prototype_id: entry.prototype_id, status: entry.status, exact_id: entry.exact_id,
        chosen_appearance_tags: [...entry.chosen_appearance_tags], appearance_prompt: appearancePrompt, trigger_included: !!(usesPrototypeTrigger(entry) && entry.prototype_trigger),
        style: entry.style, outfit_id: entry.wardrobe?.outfit_id || null, outfit_tags: entry.wardrobe?.tags || [], wardrobe:entry.wardrobe || null };
      if (entry.exact_id && entry.prototype_id === 'nilou_(genshin_impact)') binding.trained_character_binding = {
        status: 'candidate', character_id: entry.prototype_id, profile_id: 'nilou', lora_name: 'CodexAnima\\Nilou-V2-E12.safetensors', trigger: 'nilou genshin', suggested_strength: 0.4, auto_apply: false,
      };
      bindings.push(binding);
      const namePrefix = multiplePeople && /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(person) ? `${person}: ` : '';
      const frameStart = Math.max(0, text.lastIndexOf('image###', marker.start));
      const frameEnd = text.indexOf(';###', marker.end);
      const frame = text.slice(frameStart, frameEnd < 0 ? undefined : frameEnd);
      const back = /\b(?:from (?:side )?behind|back view|rear view)\b/i.test(frame);
      const full = /\b(?:full body|medium-full|cowboy shot)\b/i.test(frame);
      const extraBody = entry.native_prompt_fields?.[nativeBodyField({full,back})] || '';
      const outfitText = wardrobeText(entry.wardrobe, { back });
      replacements.push({ start: marker.start, end: marker.end, value: `${namePrefix}${appearancePrompt}${extraBody ? `, ${extraBody}` : ''}${outfitText ? `. Current outfit: ${outfitText}.` : ''}`, explicit_style: STYLES.has(spec.style) ? spec.style : null });
    }
    if (replacements.length) {
      const focus = [...replacements].reverse().find(replacement => replacement.explicit_style)?.explicit_style || bindings.at(-1).style || 'painterly';
      replacements.at(-1).value += `, @style:${focus}`;
      const exactNilou = bindings.filter(binding => binding.exact_id && binding.prototype_id === 'nilou_(genshin_impact)');
      if (bindings.length === 1 && exactNilou.length) replacements[0].value += ', @character:Nilou';
      else if (exactNilou.length) warn(warnings, 'character_lora_disabled_multi_person', exactNilou[0].person, scope,
        'Character LoRAs affect the whole image. The Nilou marker is not applied to a multi-person image.');
    }
    let output = '', at = 0;
    for (const replacement of replacements) { output += text.slice(at, replacement.start) + replacement.value; at = replacement.end; }
    output += text.slice(at);
    return { text: output, state, bindings, changed, warnings };
  }
}

"""Expand the locally reviewable pool using source popularity and existing diversity."""
import json,re,collections,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'data/characters.browser.json'
records=json.loads(path.read_text(encoding='utf-8'))
raw={r['slug']:r for r in json.loads((ROOT/'catalog-source/source/animadex_top_characters.json').read_text(encoding='utf-8'))}
original=set(json.loads((ROOT/'catalog-source/profiles/prior-category-pool.json').read_text(encoding='utf-8'))['female_ids'])
preview_policy=json.loads(subprocess.check_output(['node',str(ROOT/'drawing-policy.mjs'),'--export-catalog-policy'],encoding='utf-8'))
blocked=set(preview_policy['blockedTags'])
known_child=set(preview_policy['knownChildIds'])
eligible=[]
for r in records:
    s=raw.get(r['id'],{})
    review=bool(r['facets'].get('gender')==['female'] and not(set(r['tags'])&blocked) and r['id'] not in known_child and not s.get('is_hidden') and s.get('has_image') and s.get('thumb_url'))
    r['preview_full_url']=s.get('img_url') or r.get('preview_url')
    r['source_count']=s.get('count',0)
    r['profile']={**r.get('profile',{}),'review_eligible':review,'pool_version':'expanded-female-8000-v211','rank_basis':'source_popularity_with_previous_category_coverage'}
    r['quality']['eligible_default']=False
    if review and all(r['facets'].get(f) for f in ('hair_color','hair_length','eye_color')):eligible.append(r)
eligible.sort(key=lambda r:(-r['source_count'],r['id']))
assert len(eligible)>=8000,len(eligible)
selected=[r for r in eligible if r['id'] in original]
selected_ids={r['id']for r in selected}
for r in eligible:
    if len(selected)>=8000:break
    if r['id'] not in selected_ids:selected.append(r);selected_ids.add(r['id'])
for r in selected:r['quality']['eligible_default']=True
path.write_text(json.dumps(records,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
report={'version':'2.1.1','default_pool':len(selected),'all_reviewable_female_records':sum(r['profile']['review_eligible']for r in records),'all_records':len(records),'full_preview_urls':sum(bool(r.get('preview_full_url'))for r in selected),'female_only':all(r['facets']['gender']==['female']for r in selected),'series_count':len({r['series']for r in selected}),'prior_category_coverage_preserved':original.issubset(selected_ids),'rank_basis':'source count (popularity), complete fixed hair and eyes, prior category coverage. No beauty/arousal score.','deletion':'per-user persistent exclusions; source files and existing story bindings are preserved'}
(ROOT/'v211-catalog-expansion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True))

"""Extend labels/classification from existing source tags; retain every original tag and record."""
import collections,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data';taxonomy=json.loads((DATA/'taxonomy.json').read_text(encoding='utf-8'));records=json.loads((DATA/'characters.browser.json').read_text(encoding='utf-8'));info=taxonomy['tags'];added=[];reclassified=[]
def alias(tag,values):
    if tag not in info:return
    old=info[tag]['aliases_zh'];new=[v for v in values if v not in old];old.extend(new);added.extend((tag,v)for v in new)
colors={'black':['黑','乌黑'],'white':['白'],'blonde':['金','金黄'],'brown':['棕','褐'],'grey':['灰'],'silver':['银'],'red':['红'],'blue':['蓝'],'green':['绿'],'pink':['粉'],'purple':['紫'],'aqua':['青'],'orange':['橙']}
for color,words in colors.items():
    alias(color+' hair',[w+s for w in words for s in ['发','色头发','色长发','色短发','色中长发','色卷发']])
    eye='yellow'if color=='blonde'else color
    alias(eye+' eyes',[w+s for w in words for s in ['瞳','眸','眼睛','色眼睛','色瞳孔']])
extras={'long hair':['长头发','长发及腰','及腰长发'],'short hair':['短头发','齐耳短发'],'medium hair':['中等长度头发','及肩发','齐肩发'],'very long hair':['超长头发'],'straight hair':['直长发','长直发','顺直头发'],'wavy hair':['波浪卷发','波浪长发'],'curly hair':['卷曲头发','卷曲长发'],'ponytail':['单马尾','高马尾','扎马尾'],'twintails':['双马尾辫'],'bob cut':['波波短发'],'blunt bangs':['整齐刘海'],'parted bangs':['中分刘海'],'swept bangs':['斜刘海'],'freckles':['脸上雀斑'],'mole under eye':['泪痣'],'mature female':['成熟女性','成熟女性形象'],'muscular female':['肌肉女性','肌肉发达女性'],'dark skin':['深肤色','黝黑皮肤'],'pale skin':['苍白肤色']}
for tag,values in extras.items():alias(tag,values)
fixes={'sunken cheeks':'face','faceless':'face','faceless female':'face','faceless male':'face','marking on cheek':'marks'}
for tag,facet in fixes.items():
    if tag in info and info[tag]['facet']=='other':
        info[tag].update(section='appearance',facet=facet,rule='source-tag-classification-v215');reclassified.append(tag)
for r in records:
    for tag in reclassified:
        if tag not in r['tags']:continue
        facet=info[tag]['facet'];r['facets'].setdefault(facet,[])
        if info[tag]['value']not in r['facets'][facet]:r['facets'][facet].append(info[tag]['value'])
        if tag not in r['appearance_tags']:r['appearance_tags'].append(tag)
index=json.loads((ROOT/'indexes/character-index.json').read_text(encoding='utf-8'));by_id={r['id']:r for r in records};postings={}
for i,id in enumerate(index['id_order']):
    r=by_id[id]
    for facet,values in r['facets'].items():
        for value in values:postings.setdefault(facet,{}).setdefault(value,[]).append(i)
index['facet']=postings
taxonomy['matching_revision']='2.1.5'
for p,data in [(DATA/'taxonomy.json',taxonomy),(DATA/'characters.browser.json',records),(ROOT/'indexes/character-index.json',index)]:p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
report={'characters':len(records),'source_tags':len(info),'new_aliases':len(added),'reclassified_existing_tags':reclassified,'new_character_facts_invented':0,'full_source_tag_strings_retained':True,'default_character_count':sum(r['quality']['eligible_default']for r in records)}
(ROOT/'v215-taxonomy-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=True))

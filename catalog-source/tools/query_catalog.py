"""Local structured retrieval and prepared prompts. No auxiliary AI/API needed."""
import argparse, json, math, pathlib, re, sqlite3, sys
from taxonomy import normalize, HAIR_LENGTHS

ROOT=pathlib.Path(__file__).resolve().parents[1]
COLOR_ZH={"黑":"black","黑色":"black","白":"white","白色":"white","蓝":"blue","蓝色":"blue",
          "红":"red","红色":"red","绿":"green","绿色":"green","粉":"pink","粉色":"pink",
          "紫":"purple","紫色":"purple","棕":"brown","棕色":"brown","褐色":"brown",
          "灰":"grey","灰色":"grey","银":"silver","银色":"silver","金":"blonde","金色":"blonde",
          "黄":"yellow","黄色":"yellow","橙":"orange","橙色":"orange","青":"aqua","青色":"aqua",
          "浅蓝":"light blue","浅蓝色":"light blue","浅棕":"light brown","浅棕色":"light brown"}
FIELD_ZH={"性别":"gender","发色":"hair_color","发长":"hair_length","发型":"hair_style","瞳色":"eye_color",
          "肤色":"skin","体型":"build","胸型":"bust","种族":"species","耳朵":"ears","服装风格":"style","颜色":"color"}
WEIGHTS={"hair_color":4,"hair_length":3,"hair_style":3,"eye_color":4,"skin":3,"build":2,"bust":1,"species":4,"ears":3,"horns":3,"wings":3,"style":4,"color":2,"gender":4}

def as_list(v): return v if isinstance(v,list) else [v]
def unique(items): return list(dict.fromkeys(items))

class SeededRandom:
    """FNV-1a UTF-8 seed + Mulberry32; identical to the browser module."""
    def __init__(self,seed):
        self.state=2166136261
        for b in str(seed).encode("utf-8"): self.state=((self.state^b)*16777619)&0xffffffff
    def random(self):
        self.state=(self.state+0x6d2b79f5)&0xffffffff
        t=self.state
        t=((t^(t>>15))*(t|1))&0xffffffff
        t^=(t+(((t^(t>>7))*(t|61))&0xffffffff))&0xffffffff
        return ((t^(t>>14))&0xffffffff)/4294967296

class Catalog:
    def __init__(self,root=ROOT):
        self.root=pathlib.Path(root)
        self.db=sqlite3.connect(f"file:{(self.root/'data'/'animadex.sqlite').as_posix()}?mode=ro",uri=True)
        self.taxonomy=json.loads((self.root/'data'/'taxonomy.json').read_text(encoding="utf-8"))
        self.tags=self.taxonomy["tags"]
        self.aliases={}
        for tag,info in self.tags.items():
            for alias in [tag]+info["raw_variants"]+info["aliases_zh"]:
                self.aliases.setdefault(normalize(alias),[]).append(tag)
        self.archetype_alias={k:k for k in self.taxonomy["archetypes"]}
        self.archetype_alias.update({normalize(v["label_zh"]):k for k,v in self.taxonomy["archetypes"].items()})

    def tag(self,value):
        n=normalize(value)
        if n in self.tags: return n
        found=unique(self.aliases.get(n,[]))
        if len(found)==1: return found[0]
        if len(found)>1: raise ValueError(f"中文标签存在多个对应值，请使用英文标签：{value} -> {found}")
        raise ValueError(f"资料库不存在这个标签：{value}")

    def value(self,facet,value):
        n=normalize(value)
        if facet in {"hair_color","eye_color","color"}:
            for suffix in ["头发","眼睛","色头发","色眼睛","发","瞳","眼"]:
                if n.endswith(suffix) and n[:-len(suffix)] in COLOR_ZH: n=n[:-len(suffix)]; break
            n=COLOR_ZH.get(n,n).replace("gray","grey")
            if facet in {"eye_color","color"} and n=="blonde": n="yellow" if facet=="eye_color" else "gold"
            for suffix in [" hair"," eyes"]:
                if n.endswith(suffix): n=n[:-len(suffix)]
            return n
        if facet=="gender": return {"女":"female","女性":"female","男":"male","男性":"male","未定":"ambiguous","性别不明":"ambiguous","1girl":"female","1boy":"male","1other":"ambiguous"}.get(n,n)
        if facet=="hair_length":
            n={"极短发":"very short","短发":"short","中长发":"medium","长发":"long","超长发":"very long","极长发":"absurdly long"}.get(n,n)
            return n[:-5] if n.endswith(" hair") else n
        if facet=="style":
            if n in self.archetype_alias: return self.archetype_alias[n]
            if value in self.archetype_alias: return self.archetype_alias[value]
            return n
        try:
            tag=self.tag(n)
            return self.tags[tag]["value"]
        except ValueError:
            return n

    def query_normalized(self,q):
        allowed={"kind","required","preferred","required_tags","preferred_tags","exclude_tags","exclude_ids",
                 "archetypes","preferred_archetypes","limit","seed","include_limited","include_partial",
                 "allow_underwear","allow_swimwear","include_accessories","include_trigger","score_window","temperature"}
        extra=set(q)-allowed
        if extra: raise ValueError("未知查询字段："+", ".join(sorted(extra)))
        kind=q.get("kind","character")
        if kind not in {"character","outfit"}: raise ValueError("kind 必须是 character 或 outfit")
        out={**q,"kind":kind,"required":{},"preferred":{}}
        for field in ["required","preferred"]:
            if not isinstance(q.get(field,{}),dict): raise ValueError(field+" 必须是对象")
            for facet,values in q.get(field,{}).items():
                facet=FIELD_ZH.get(facet,facet)
                valid={"gender","age_evidence","species","hair_color","hair_length","hair_pattern","hair_style","bangs","eye_color","eye_features","skin","build","bust","ears","horns","tail","wings","face","marks","anatomy","facial_hair"} if kind=="character" else {"color","style","slot","gender"}
                if facet not in valid: raise ValueError(f"{kind} 不支持条件 {facet}")
                out[field][facet]=unique(self.value(facet,v) for v in as_list(values))
                if not out[field][facet]: raise ValueError(f"{facet} 条件不能为空数组")
        for field in ["required_tags","preferred_tags","exclude_tags"]:
            out[field]=unique(self.tag(v) for v in as_list(q.get(field,[])))
        for field in ["archetypes","preferred_archetypes"]:
            out[field]=[]
            for v in as_list(q.get(field,[])):
                aid=self.archetype_alias.get(normalize(v))
                if aid is None: raise ValueError("未知形象类别："+str(v))
                out[field].append(aid)
        out["limit"]=min(100,max(1,int(q.get("limit",8))))
        out["seed"]=str(q.get("seed","animadex-default"))
        out["score_window"]=float(q.get("score_window",6))
        out["temperature"]=float(q.get("temperature",4))
        if out["score_window"]<0 or out["temperature"]<=0: raise ValueError("score_window 必须非负，temperature 必须为正")
        return out

    def retrieve(self,q):
        q=self.query_normalized(q)
        kind=q["kind"]; table="character" if kind=="character" else "outfit"
        fk="character_id" if kind=="character" else "outfit_id"
        clauses=[]; params=[]
        if kind=="character" and not q.get("include_limited",False): clauses.append("c.eligible=1")
        # Outfit policies are independent, so partial bundles can be inspected without silently enabling underwear.
        if kind=="outfit":
            if not q.get("include_partial",False): clauses.append("json_extract(c.record_json,'$.quality.has_core')=1")
            if not q.get("allow_underwear",False): clauses.append("json_extract(c.record_json,'$.quality.contains_underwear')=0")
            if not q.get("allow_swimwear",False): clauses.append("json_extract(c.record_json,'$.quality.contains_swimwear')=0")
            if not q.get("include_limited",False): clauses.append("json_array_length(json_extract(c.record_json,'$.quality.color_alternatives'))=0")
        for facet,values in q["required"].items():
            marks=",".join("?" for _ in values)
            clauses.append(f"EXISTS(SELECT 1 FROM {table}_facet f WHERE f.{fk}=c.id AND f.facet=? AND f.value IN ({marks}))")
            params += [facet]+values
        for tag in q["required_tags"]:
            clauses.append(f"EXISTS(SELECT 1 FROM {table}_tag t WHERE t.{fk}=c.id AND t.tag=?)"); params.append(tag)
        for tag in q["exclude_tags"]:
            clauses.append(f"NOT EXISTS(SELECT 1 FROM {table}_tag t WHERE t.{fk}=c.id AND t.tag=?)"); params.append(tag)
        for aid in q["archetypes"]:
            if kind=="character":
                clauses.append("EXISTS(SELECT 1 FROM character_archetype a WHERE a.character_id=c.id AND a.archetype=?)")
            else:
                clauses.append("EXISTS(SELECT 1 FROM outfit_facet a WHERE a.outfit_id=c.id AND a.facet='style' AND a.value=?)")
            params.append(aid)
        excluded=as_list(q.get("exclude_ids",[]))
        if excluded:
            clauses.append("c.id NOT IN ("+",".join("?" for _ in excluded)+")"); params+=excluded
        sql=f"SELECT c.record_json FROM {table} c"+(" WHERE "+" AND ".join(clauses) if clauses else "")+" ORDER BY c.id"
        candidates=[json.loads(x[0]) for x in self.db.execute(sql,params)]
        ranked=[]
        for r in candidates:
            feats=r["facets"] if kind=="character" else {"color":r["colors"],"style":r["styles"],"slot":list(r["slots"]),"gender":r["gender_evidence"]}
            tags=set(r["tags"]); aids={a["id"] for a in r["archetypes"]} if kind=="character" else set(r["styles"])
            matches=[]; score=0.0
            for f,vs in q["preferred"].items():
                match=set(vs)&set(feats.get(f,[]))
                if match: score+=WEIGHTS.get(f,2); matches.append({"facet":f,"values":sorted(match)})
            for tag in q["preferred_tags"]:
                if tag in tags: score+=2; matches.append({"tag":tag})
            for aid in q["preferred_archetypes"]:
                if aid in aids: score+=3; matches.append({"archetype":aid})
            penalty=min(2,0.25*len(r["quality"].get("alternatives",[]))) if kind=="character" else 0
            ranked.append((r,score-penalty,matches))
        best=max((x[1] for x in ranked),default=0)
        shortlist=[x for x in ranked if x[1]>=best-q["score_window"]]
        # Weighted sampling without replacement. Source popularity is intentionally absent.
        rng=SeededRandom(q["seed"])
        chosen=[]; remaining=list(shortlist)
        while remaining and len(chosen)<q["limit"]:
            weights=[math.exp((x[1]-best)/q["temperature"]) for x in remaining]
            draw=rng.random()*sum(weights); pos=0
            for i,w in enumerate(weights):
                draw-=w
                if draw<=0: pos=i; break
            r,score,matches=remaining.pop(pos)
            prepared=prepare_character(r,self.tags,q) if kind=="character" else prepare_outfit(r,self.tags,q)
            chosen.append({"id":r["id"],"name":r.get("name"),"series":r.get("series"),"score":round(score,3),"matched_preferences":matches,
                           "quality":r["quality"],"prepared":prepared,"provenance_ids":[r["id"]] if kind=="character" else r["source_character_ids"]})
        return {"status":"ok" if chosen else "no_match","kind":kind,"candidate_count":len(candidates),"sampling_pool_count":len(shortlist),
                "query":q,"results":chosen,"relaxed_constraints":[],
                "note":"硬条件之间取交集，同一字段多个值取并集。无匹配时不自动放宽条件。"}

    def get(self,cid,kind="character"):
        if kind not in {"character","outfit"}: raise ValueError("unknown kind")
        r=self.db.execute(f"SELECT record_json FROM {kind} WHERE id=?",(cid,)).fetchone()
        return json.loads(r[0]) if r else None

def prepare_character(r,info,q):
    tags=unique(r["appearance_tags"]+[t for t in r["sections"].get("demographic",[]) if info[t]["facet"]=="species" and t!="no humans"]) if "sections" in r else unique(r["appearance_tags"]+[t for t in r["tags"] if info[t]["facet"]=="species" and t!="no humans"])
    decisions=[]
    for facet in ["hair_color","eye_color","hair_length","bust"]:
        vals=r["facets"].get(facet,[])
        if not vals: continue
        candidates=q["required"].get(facet,[])+[info[t]["value"] for t in q["required_tags"] if info[t]["facet"]==facet]+q["preferred"].get(facet,[])+[info[t]["value"] for t in q["preferred_tags"] if info[t]["facet"]==facet]
        desired=next((x for x in candidates if x in vals),None)
        multicolor=(facet=="hair_color" and bool(r["facets"].get("hair_pattern"))) or (facet=="eye_color" and any(x in r["tags"] for x in ["heterochromia","multicolored eyes","two-tone eyes","gradient eyes"]))
        if multicolor and desired is None:
            decisions.append({"facet":facet,"kept":vals,"reason":"explicit_multicolor_evidence"}); continue
        if desired is None:
            desired=max(vals,key=lambda x:HAIR_LENGTHS.index(x)) if facet=="hair_length" else vals[0]
        removed=[t for t in tags if info[t]["facet"]==facet and info[t]["value"]!=desired]
        tags=[t for t in tags if t not in removed]
        decisions.append({"facet":facet,"kept":[desired],"removed_tags":removed,"reason":"query_value" if candidates and desired in candidates else "most_specific_length" if facet=="hair_length" else "first_source_value"})
    # Animal-type alternatives are not the same as generic 'animal ears' modifiers.
    animal_types="cat|dog|fox|wolf|rabbit|horse|tiger|bear|cow|mouse|sheep|lion|goat|deer|squirrel|raccoon|bat|dragon"
    for facet,part,multi_tag in [("ears","ears","extra ears"),("tail","tail","multiple tails")]:
        choices=[t for t in tags if re.fullmatch(r"(?:.+ )?(?:"+animal_types+r") "+part,t)]
        types={re.search(r"("+animal_types+r") "+part+r"$",t).group(1) for t in choices}
        if len(types)<2:continue
        requested=[t for t in q["required_tags"] if t in choices]+[v for v in q["required"].get(facet,[]) if v in choices]
        preferred=[v for v in q["preferred"].get(facet,[]) if v in choices]
        if len(requested)>1 or (multi_tag in tags and not requested):continue
        selected=(requested+preferred+choices)[0]
        chosen_type=re.search(r"("+animal_types+r") "+part+r"$",selected).group(1)
        removed=[t for t in choices if not re.search(r"\b"+chosen_type+r" "+part+r"$",t)]
        tags=[t for t in tags if t not in removed]
        decisions.append({"facet":facet,"kept":[selected],"removed_tags":removed,"reason":"query_value" if requested or preferred else "first_source_animal_type"})
    gender=q["required"].get("gender",[])+r["facets"].get("gender",[])
    gender_tag={"female":"1girl","male":"1boy","ambiguous":"1other"}.get(next((v for v in gender if v in r["facets"].get("gender",[])),None))
    if gender_tag: tags.insert(0,gender_tag)
    mutable=r["accessory_tags"] if q.get("include_accessories",False) else []
    face=[t for t in tags if info[t]["facet"] in {"eye_color","eye_features","face","facial_hair"}]
    general=[t for t in tags if t not in face]
    appearance=unique(tags+mutable)
    prompt=", ".join(([r["trigger"]] if q.get("include_trigger",False) else [])+appearance)
    return {"appearance_tags":appearance,"appearance_prompt":prompt,"prototype_trigger":r["trigger"],
            "trigger_included":bool(q.get("include_trigger",False)),"resolved_facets":decisions,
            "outfit_tags_separate":r["outfit_tags"],"accessory_tags_separate":r["accessory_tags"],
            "chatu8_fields":{"characterTraits":", ".join(([r["trigger"]] if q.get("include_trigger",False) else [])+general),"facialFeatures":", ".join(face+mutable),"upperBodySFW":"","fullBodySFW":""},
            "binding":{"prototype_id":r["id"],"chosen_appearance_tags":appearance,"trigger_included":bool(q.get("include_trigger",False)),"seed":q["seed"],"persist_for_same_story_character":True}}

def prepare_outfit(r,info,q):
    # Condition is scene-dependent; preserve source evidence but omit it from the reusable outfit.
    tags=[t for t in r["tags"] if info[t]["facet"]!="condition"]
    if not q.get("include_accessories",True): tags=[t for t in tags if info[t]["section"]!="accessory"]
    chosen_colors=q["required"].get("color",[])
    decisions=[]
    for a in r["quality"]["color_alternatives"]:
        selected=next((c for c in chosen_colors if c in a["values"]),a["values"][0])
        removed=[c+" "+a["garment"] for c in a["values"] if c!=selected]
        tags=[t for t in tags if t not in removed]
        decisions.append({**a,"kept":selected,"removed_tags":removed})
    lower={"bottom","legwear","footwear"}
    upper=[t for t in tags if info[t]["section"]=="outfit" and info[t]["facet"] not in lower]
    bottom=[t for t in tags if info[t]["facet"] in lower]
    accessories=[t for t in tags if info[t]["section"]=="accessory"]
    return {"outfit_tags":tags,"outfit_prompt":", ".join(tags),"slots":{s:[t for t in ts if t in tags] for s,ts in r["slots"].items()},
            "resolved_colors":decisions,"source_character_ids":r["source_character_ids"],
            "chatu8_fields":{"upperBodySFW":", ".join(upper+accessories),"fullBodySFW":", ".join(bottom)},
            "binding":{"outfit_id":r["id"],"chosen_outfit_tags":tags,"seed":q["seed"]}}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--query",type=pathlib.Path,help="UTF-8 查询 JSON")
    p.add_argument("--json",help="inline query JSON")
    p.add_argument("--id",help="look up an exact original character ID")
    p.add_argument("--kind",choices=["character","outfit"],default="character")
    p.add_argument("--output",type=pathlib.Path)
    args=p.parse_args(); cat=Catalog()
    try:
        if args.id: result=cat.get(args.id,args.kind)
        elif args.query: result=cat.retrieve(json.loads(args.query.read_text(encoding="utf-8-sig")))
        elif args.json: result=cat.retrieve(json.loads(args.json))
        else: p.error("请指定 --query、--json 或 --id")
        text=json.dumps(result,ensure_ascii=False,indent=2)
        if args.output: args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(text,encoding="utf-8")
        else: print(text)
    except (ValueError,TypeError) as e:
        print(json.dumps({"status":"invalid_query","message":str(e)},ensure_ascii=False)); sys.exit(2)

if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8"); main()

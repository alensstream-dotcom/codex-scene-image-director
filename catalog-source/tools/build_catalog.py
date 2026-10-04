"""Build the complete local Animadex catalog. Standard-library Python only."""
import argparse, collections, datetime, hashlib, json, pathlib, shutil, sqlite3, sys
from taxonomy import normalize, classify, derive_archetypes, VERSION, LABEL_OVERRIDES, FACET_LABELS, ARCHETYPE_RULES, COLORS
from profile_filter import apply_profile

ROOT = pathlib.Path(__file__).resolve().parents[1]
def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def create_enrichment(vocab_path, tags):
    data=json.loads(vocab_path.read_text(encoding="utf-8"))
    tree=data["tags.json"]
    subs={s["id_index"]:(g["name"],s["name"]) for g in tree["tag_groups"] for s in g.get("subgroups",[])}
    out={t:{"labels":[],"tree_hints":[],"dictionary_entries":[]} for t in tags}
    for filename,part in data.items():
        if not filename.startswith("danbooru_"): continue
        for entry in part.get("danbooru_tag",[]):
            tag=normalize(entry["tag"])
            if tag in out:
                if entry.get("translate") and entry["translate"] not in out[tag]["labels"]:
                    out[tag]["labels"].append(entry["translate"])
                out[tag]["dictionary_entries"].append({"file":filename,"tag":entry["tag"],"translate":entry.get("translate"),"id":entry.get("id_index")})
    for entry in tree["tag_tags"]:
        tag=normalize(entry["text"])
        if tag in out and entry.get("subgroup_id") in subs:
            hint=list(subs[entry["subgroup_id"]])
            if hint not in out[tag]["tree_hints"]: out[tag]["tree_hints"].append(hint)
            if entry.get("desc") and entry["desc"] not in out[tag]["labels"]:
                out[tag]["labels"].append(entry["desc"])
    dump(ROOT/"source"/"tag-enrichment.json",out)
    return out

def organize(row, tag_info):
    tags=list(dict.fromkeys(normalize(t) for t in row["tags"] if normalize(t)))
    sections=collections.defaultdict(list)
    facets=collections.defaultdict(list)
    for t in tags:
        info=tag_info[t]
        sections[info["section"]].append(t)
        if info["section"] in {"appearance","demographic"}:
            value=info["value"] or t
            if value not in facets[info["facet"]]: facets[info["facet"]].append(value)
    conflicts=[]
    for facet in ["gender","hair_color","eye_color","bust"]:
        vals=facets.get(facet,[])
        if len(vals)>1:
            multi=(facet=="hair_color" and bool(facets.get("hair_pattern"))) or (facet=="eye_color" and any(x in tags for x in ["heterochromia","multicolored eyes","two-tone eyes","gradient eyes"]))
            conflicts.append({"facet":facet,"values":vals,"status":"multicolor_evidence" if multi else "alternative_values", "resolution":"query_choice_or_first_source_value"})
    lengths=facets.get("hair_length",[])
    if any(x in lengths for x in ["very short","short","medium"]) and any(x in lengths for x in ["long","very long","absurdly long"]):
        conflicts.append({"facet":"hair_length","values":lengths,"status":"mixed_lengths", "resolution":"query_choice_or_most_specific"})
    nonhuman="no humans" in tags or any(t in tags for t in ["pokemon (creature)","mecha","mobile suit"])
    meaningful=bool(facets.get("hair_color") or facets.get("eye_color") or facets.get("hair_style"))
    single=not any(t.startswith("multiple ") and t.split(" ",1)[1] in {"girls","boys","others"} for t in tags)
    gender_conflict=len(facets.get("gender",[]))>1
    eligible=bool(tags and meaningful and single and not nonhuman and not gender_conflict)
    flags=[]
    if not tags: flags.append("missing_tags")
    if tags and not meaningful: flags.append("insufficient_appearance")
    if nonhuman: flags.append("nonhuman_explicit")
    if not single or gender_conflict: flags.append("subject_ambiguity")
    if conflicts: flags.append("facet_alternatives")
    if any(tag_info[t]["facet"]=="sensitive" for t in tags): flags.append("sensitive_context_in_source")
    unknown=[t for t in tags if tag_info[t]["section"]=="other"]
    identity=[t for t in tags if tag_info[t]["section"]=="appearance"]
    # Structural appearance excludes non-character context and all wardrobe/accessories.
    archetypes=derive_archetypes(tags)
    return {"id":row["slug"],"name":row["name"],"series":row.get("copyright_name") or row.get("copyright"),
            "copyright_id":row.get("copyright"),"trigger":row["trigger"],"source_count":row.get("count",0),
            "source_urls":{"danbooru":row.get("url"),"thumbnail":row.get("thumb_url"),"image":row.get("img_url")},
            "source_tags":row["tags"],"tags":tags,"sections":dict(sections),"facets":dict(facets),
            "appearance_tags":identity,"outfit_tags":sections.get("outfit",[]),"accessory_tags":sections.get("accessory",[]),
            "archetypes":archetypes,"personality":{"status":"not_provided_by_source","traits":[]},
            "quality":{"eligible_default":eligible,"flags":flags,"alternatives":conflicts,"unclassified_tags":unknown,
                       "appearance_tag_count":len(identity),"tier":"missing" if not tags else "usable" if eligible else "limited"}}

MAIN_SLOTS={"top","bottom","full_body","outerwear","footwear","legwear","gloves","headwear","armor","underwear","swimwear"}
def wardrobe(record, info):
    selected=record["outfit_tags"]+record["accessory_tags"]
    if not record["outfit_tags"]: return None
    selected=sorted(set(selected))
    key=hashlib.sha256("\n".join(selected).encode("utf-8")).hexdigest()[:20]
    slots=collections.defaultdict(list)
    colors=[]
    for t in selected:
        i=info[t]; slots[i["facet"]].append(t)
        for c in sorted(COLORS,key=len,reverse=True):
            if t.startswith(c+" "):
                c=c.replace("gray","grey")
                if c not in colors: colors.append(c)
                break
    has_core=bool(slots.get("full_body") or slots.get("swimwear") or (slots.get("top") and slots.get("bottom")))
    is_intimate=bool(slots.get("underwear"))
    # A swimsuit / undergarment by itself is an explicit selectable class, not a generic outfit.
    ordinary_core=bool(slots.get("full_body") or (slots.get("top") and slots.get("bottom")))
    issues=[]
    if not has_core: issues.append("partial_bundle")
    color_alternatives=[]
    for slot in MAIN_SLOTS:
        by_garment=collections.defaultdict(set)
        for t in slots.get(slot,[]):
            for c in sorted(COLORS,key=len,reverse=True):
                if t.startswith(c+" "): by_garment[t[len(c)+1:]].add(c); break
        for garment,vals in by_garment.items():
            if len(vals)>1:
                color_alternatives.append({"slot":slot,"garment":garment,"values":sorted(vals)})
    if color_alternatives: issues.append("garment_color_alternatives")
    return {"id":"outfit-"+key,"tags":selected,"slots":dict(slots),"colors":sorted(colors),
            "styles":sorted({a["id"] for a in record["archetypes"] if a["id"] not in {"fantasy_elf","animal_eared","horned","winged","mechanical"}}),
            "source_character_ids":[record["id"]],"gender_evidence":record["facets"].get("gender",[]),
            "quality":{"has_core":has_core,"ordinary_core":ordinary_core,"partial":not has_core,"contains_underwear":is_intimate,
                       "contains_swimwear":bool(slots.get("swimwear")),"issues":issues,"color_alternatives":color_alternatives,
                       "eligible_default":ordinary_core and not is_intimate and not slots.get("swimwear") and not color_alternatives},
            "provenance":"observed_tag_bundle_not_verified_complete_outfit"}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",type=pathlib.Path,default=ROOT/"source"/"animadex_top_characters.json")
    p.add_argument("--vocabulary",type=pathlib.Path)
    p.add_argument("--full",action="store_true",help="Rebuild the original full catalog instead of the default user profile")
    args=p.parse_args()
    for d in ["source","data","indexes","reports","licenses"]: (ROOT/d).mkdir(parents=True,exist_ok=True)
    source_target=ROOT/"source"/"animadex_top_characters.json"
    if args.source.resolve()!=source_target.resolve(): shutil.copy2(args.source,source_target)
    rows=json.loads(source_target.read_text(encoding="utf-8"))
    variants=collections.defaultdict(set); frequencies=collections.Counter()
    for row in rows:
        ntags=set()
        for tag in row["tags"]:
            n=normalize(tag)
            if n: variants[n].add(tag); ntags.add(n)
        frequencies.update(ntags)
    enrich=create_enrichment(args.vocabulary,variants) if args.vocabulary else json.loads((ROOT/"source"/"tag-enrichment.json").read_text(encoding="utf-8"))
    infos={}
    for tag in sorted(variants):
        e=enrich.get(tag,{"labels":[],"tree_hints":[]})
        item=classify(tag,e["tree_hints"])
        labels=list(dict.fromkeys(([LABEL_OVERRIDES[tag]] if tag in LABEL_OVERRIDES else [])+e["labels"]))
        infos[tag]={"tag":tag,**item,"value":item["value"] or tag,"label_zh":labels[0] if labels else None,
                    "aliases_zh":labels,"raw_variants":sorted(variants[tag]),"character_count":frequencies[tag],
                    "source_tree_hints":e["tree_hints"],"translation_source":"manual_override" if tag in LABEL_OVERRIDES else "st-chatu8_dictionary" if labels else "unavailable"}
    records=[organize(row,infos) for row in rows]
    profile_path=ROOT/"profiles"/"female-focused.json"
    profile_report=None
    if profile_path.exists() and not args.full:
        records,profile_report=apply_profile(records,json.loads(profile_path.read_text(encoding="utf-8")))
        dump(ROOT/"reports"/"profile-exclusions.json",profile_report)
    outfits={}
    for rec in records:
        o=wardrobe(rec,infos)
        if o is None: continue
        if o["id"] in outfits:
            previous=outfits[o["id"]]; previous["source_character_ids"].append(rec["id"])
            previous["gender_evidence"]=sorted(set(previous["gender_evidence"]+o["gender_evidence"]))
        else: outfits[o["id"]]=o
    db_path=ROOT/"data"/"animadex.sqlite"
    staging=ROOT/"data"/"animadex.building.sqlite"
    if staging.exists(): staging.unlink()
    con=sqlite3.connect(staging)
    con.executescript('''
      CREATE TABLE character(id TEXT PRIMARY KEY,name TEXT,series TEXT,eligible INTEGER,record_json TEXT NOT NULL);
      CREATE TABLE tag(tag TEXT PRIMARY KEY,section TEXT,facet TEXT,value TEXT,label_zh TEXT,record_json TEXT NOT NULL);
      CREATE TABLE character_tag(character_id TEXT,tag TEXT,PRIMARY KEY(character_id,tag));
      CREATE INDEX ct_tag ON character_tag(tag,character_id);
      CREATE TABLE character_facet(character_id TEXT,facet TEXT,value TEXT,PRIMARY KEY(character_id,facet,value));
      CREATE INDEX cf_value ON character_facet(facet,value,character_id);
      CREATE TABLE character_archetype(character_id TEXT,archetype TEXT,PRIMARY KEY(character_id,archetype));
      CREATE INDEX ca_type ON character_archetype(archetype,character_id);
      CREATE TABLE outfit(id TEXT PRIMARY KEY,eligible INTEGER,record_json TEXT NOT NULL);
      CREATE TABLE outfit_tag(outfit_id TEXT,tag TEXT,PRIMARY KEY(outfit_id,tag));
      CREATE INDEX ot_tag ON outfit_tag(tag,outfit_id);
      CREATE TABLE outfit_facet(outfit_id TEXT,facet TEXT,value TEXT,PRIMARY KEY(outfit_id,facet,value));
      CREATE INDEX of_value ON outfit_facet(facet,value,outfit_id);
    ''')
    encoding=lambda r:json.dumps(r,ensure_ascii=False,separators=(",",":"))
    con.executemany("INSERT INTO tag VALUES(?,?,?,?,?,?)",[(t,i["section"],i["facet"],i["value"],i["label_zh"],encoding(i)) for t,i in infos.items()])
    inverted=collections.defaultdict(list); facets=collections.defaultdict(lambda:collections.defaultdict(list)); archetypes=collections.defaultdict(list)
    with (ROOT/"data"/"characters.jsonl").open("w",encoding="utf-8") as fh:
        for idx,r in enumerate(records):
            fh.write(encoding(r)+"\n")
            con.execute("INSERT INTO character VALUES(?,?,?,?,?)",(r["id"],r["name"],r["series"],int(r["quality"]["eligible_default"]),encoding(r)))
            con.executemany("INSERT INTO character_tag VALUES(?,?)",[(r["id"],t) for t in r["tags"]])
            con.executemany("INSERT INTO character_facet VALUES(?,?,?)",[(r["id"],f,v) for f,values in r["facets"].items() for v in values])
            con.executemany("INSERT INTO character_archetype VALUES(?,?)",[(r["id"],a["id"]) for a in r["archetypes"]])
            for t in r["tags"]: inverted[t].append(idx)
            for f,values in r["facets"].items():
                for v in values: facets[f][v].append(idx)
            for a in r["archetypes"]: archetypes[a["id"]].append(idx)
    with (ROOT/"data"/"outfits.jsonl").open("w",encoding="utf-8") as fh:
        for r in outfits.values():
            fh.write(encoding(r)+"\n")
            con.execute("INSERT INTO outfit VALUES(?,?,?)",(r["id"],int(r["quality"]["eligible_default"]),encoding(r)))
            con.executemany("INSERT INTO outfit_tag VALUES(?,?)",[(r["id"],t) for t in r["tags"]])
            ff=[(r["id"],"color",c) for c in r["colors"]]+[(r["id"],"style",v) for v in r["styles"]]+[(r["id"],"slot",v) for v in r["slots"]]+[(r["id"],"gender",v) for v in r["gender_evidence"]]
            con.executemany("INSERT INTO outfit_facet VALUES(?,?,?)",ff)
    con.commit(); con.close(); staging.replace(db_path)
    dump(ROOT/"data"/"taxonomy.json",{"schema_version":VERSION,"facet_labels":FACET_LABELS,"tags":infos,
         "archetypes":{k:{"label_zh":v[0],"evidence_pattern":v[1],"meaning":"visual_category_not_personality"} for k,v in ARCHETYPE_RULES.items()}})
    dump(ROOT/"indexes"/"character-index.json",{"schema_version":VERSION,"id_order":[r["id"] for r in records],"tag":inverted,"facet":facets,"archetype":archetypes})
    # Browser/plugin export omits large source URLs and redundant translations; full records stay in SQLite/JSONL.
    compact=[{k:r[k] for k in ["id","name","series","trigger","tags","facets","appearance_tags","outfit_tags","accessory_tags","archetypes","quality","profile"] if k in r} for r in records]
    dump(ROOT/"data"/"characters.browser.json",compact)
    dump(ROOT/"data"/"outfits.browser.json",list(outfits.values()))
    category_counts=collections.Counter((v["section"],v["facet"]) for v in infos.values())
    weighted_counts=collections.Counter()
    for t,i in infos.items(): weighted_counts[(i["section"],i["facet"])]+=frequencies[t]
    unknown=sorted([{"tag":t,"label_zh":i["label_zh"],"character_count":frequencies[t]} for t,i in infos.items() if i["section"]=="other"],key=lambda x:(-x["character_count"],x["tag"]))
    dump(ROOT/"reports"/"unclassified-tags.json",unknown)
    dump(ROOT/"indexes"/"facet-summary.json",{f:{"label_zh":FACET_LABELS.get(f,f),"values":[{"value":v,"character_count":len(indices)} for v,indices in sorted(values.items(),key=lambda x:-len(x[1]))]} for f,values in facets.items()})
    flag_counts=collections.Counter(f for r in records for f in r["quality"]["flags"])
    active_frequencies=collections.Counter(t for r in records for t in r["tags"])
    active_unknown=sum(n for t,n in active_frequencies.items() if infos[t]["section"]=="other")
    report={"source_characters_total":len(rows),"active_profile":profile_report["profile"]["id"] if profile_report else "full",
        "characters_total":len(records),"characters_tagged":sum(bool(r["tags"]) for r in records),
        "characters_default_eligible":sum(r["quality"]["eligible_default"] for r in records),
        "raw_unique_tags":sum(len(v) for v in variants.values()),"canonical_unique_tags":len(infos),
        "source_character_tag_postings":sum(frequencies.values()),"character_tag_postings":sum(active_frequencies.values()),"translated_unique_tags":sum(bool(i["label_zh"]) for i in infos.values()),
        "unclassified_unique_tags":len(unknown),"source_unclassified_postings":sum(x["character_count"] for x in unknown),"unclassified_postings":active_unknown,
        "classified_posting_coverage":round(1-active_unknown/max(1,sum(active_frequencies.values())),6),
        "outfits_total":len(outfits),"outfits_default_eligible":sum(o["quality"]["eligible_default"] for o in outfits.values()),
        "outfits_partial":sum(o["quality"]["partial"] for o in outfits.values()),"quality_flag_counts":dict(flag_counts),
        "category_counts":[{"section":s,"facet":f,"label_zh":FACET_LABELS.get(f,f),"unique_tags":n,"character_tag_postings":weighted_counts[(s,f)]} for (s,f),n in sorted(category_counts.items())],
        "personality_records_from_source":0,"raw_source_sha256":sha(source_target)}
    dump(ROOT/"reports"/"catalog-statistics.json",report)
    artifact_paths=[p for d in ["source","data","indexes","reports"] for p in (ROOT/d).glob("*") if p.is_file()]
    manifest={"schema_version":VERSION,"built_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "character_source":{"repository":"https://github.com/wrt122311/ComfyUI-Animadex-Node","commit":"880be2a460dce1ffde15e9719313886e072fcdcc","snapshot_commit_date":"2026-05-26","file":"animadex_top_characters.json","sha256":report["raw_source_sha256"],"is_live_site_export":False},
        "enrichment_source":{"repository":"https://github.com/damoshen123/st-chatu8","commit":"5f33ed1ac0b1e4caf87eb3703fb30a6cc5b0b50f","license_file":"licenses/st-chatu8-AFPL.txt","purpose":"Chinese translations and fallback category hints"},
        "official_source_repository":"https://github.com/zetaneko/AnimaDex","limitations":["Public May 2026 snapshot; not claimed current live database","No reliable personality records","Missing source tags retained","Wardrobes are observed tag bundles; partial and ambiguous bundles flagged","Chinese translations inherit source dictionary limitations"],
        "artifacts":{str(p.relative_to(ROOT)).replace("\\","/"):{"bytes":p.stat().st_size,"sha256":sha(p)} for p in artifact_paths}}
    dump(ROOT/"manifest.json",manifest)
    print(json.dumps({k:v for k,v in report.items() if k!="category_counts"},ensure_ascii=False,indent=2))

if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

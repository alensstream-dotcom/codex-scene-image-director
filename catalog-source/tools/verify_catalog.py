"""Dataset conservation, semantic boundaries and retrieval integration checks."""
import collections, hashlib, json, pathlib, sqlite3, sys, time
from taxonomy import normalize
from query_catalog import Catalog, prepare_character
ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
    start=time.perf_counter(); checks=[]
    def check(name,condition,details=None):
        if not condition: raise AssertionError(name+": "+str(details))
        checks.append({"name":name,"passed":True,"details":details})
    src_path=ROOT/"source"/"animadex_top_characters.json"
    source=json.loads(src_path.read_text(encoding="utf-8"))
    rows=[json.loads(x) for x in (ROOT/"data"/"characters.jsonl").read_text(encoding="utf-8").splitlines()]
    outfits=[json.loads(x) for x in (ROOT/"data"/"outfits.jsonl").read_text(encoding="utf-8").splitlines()]
    cat=Catalog(); stats=json.loads((ROOT/"reports"/"catalog-statistics.json").read_text(encoding="utf-8"))
    index=json.loads((ROOT/"indexes"/"character-index.json").read_text(encoding="utf-8"))
    manifest=json.loads((ROOT/"manifest.json").read_text(encoding="utf-8"))
    check("原始快照哈希一致",hashlib.sha256(src_path.read_bytes()).hexdigest()==manifest["character_source"]["sha256"])
    active_ids={r["id"] for r in rows}
    selected_source=[s for s in source if s["slug"] in active_ids]
    check("原始全部角色仍在源快照",len(source)==36492)
    check("当前角色均来自源快照并保持顺序",[s["slug"] for s in selected_source]==[r["id"] for r in rows],len(rows))
    check("角色主键唯一",len({r["id"] for r in rows})==len(rows))
    check("每个保留角色的原始 tag 逐条保留",all(s["tags"]==r["source_tags"] for s,r in zip(selected_source,rows)))
    check("归一化只消除空白和下划线差异",all(r["tags"]==list(dict.fromkeys(normalize(t) for t in s["tags"] if normalize(t))) for s,r in zip(selected_source,rows)))
    variants=collections.defaultdict(set)
    for s in source:
        for t in s["tags"]: variants[normalize(t)].add(t)
    check("全部原始拼写进入受控词表",all(set(cat.tags[t]["raw_variants"])==v for t,v in variants.items()),sum(len(v) for v in variants.values()))
    check("每个 tag 恰有一个主分类",all(len([t for ts in r["sections"].values() for t in ts])==len(r["tags"]) and set(t for ts in r["sections"].values() for t in ts)==set(r["tags"]) for r in rows))
    check("固定外貌没有服装、配饰、动作和场景",all(all(cat.tags[t]["section"]=="appearance" for t in r["appearance_tags"]) for r in rows))
    check("性格未被凭空补写",all(r["personality"]=={"status":"not_provided_by_source","traits":[]} for r in rows))
    check("缺失 tags 源记录完整保留且不自动抽取",sum(not r["tags"] for r in source)==7679 and all(not r["quality"]["eligible_default"] for r in rows if not r["tags"]))
    if stats.get("active_profile")!="full":
        check("活动库只保留女性和最多十名男性",sum(r["facets"].get("gender")==["male"] for r in rows)<=10 and all(r["facets"].get("gender") in [["female"],["male"]] for r in rows))
        check("明确卡通脸样例已排除",not {"kemomimi-chan_(naga_u)","lucia_(scott_malin)"}&active_ids)
        check("沙耶香本体与魔法少女形态保留",{"miki_sayaka","miki_sayaka_(magical_girl)"}<=active_ids)
        check("复古插画作品没有按年代整批删除",any(r["copyright_id"]=="reverse:1999" for r in rows))
    check("中文词表覆盖统计一致",sum(bool(t["label_zh"]) for t in cat.tags.values())==stats["translated_unique_tags"])
    check("SQLite 完整性",cat.db.execute("PRAGMA integrity_check").fetchone()[0]=="ok")
    check("角色与 tag 的数据库索引没有丢记录",cat.db.execute("SELECT COUNT(*) FROM character_tag").fetchone()[0]==sum(len(r["tags"]) for r in rows)==stats["character_tag_postings"])
    check("浏览器索引能还原全部 tag 关联",all(sorted(index["tag"].get(t,[]))==[i for i,r in enumerate(rows) if t in r["tags"]] for t in ["black hair","blue eyes","maid","no humans"] ))
    check("浏览器记录与 SQLite 输入保持一致",len(json.loads((ROOT/"data"/"characters.browser.json").read_text(encoding="utf-8")))==len(rows))
    row_by_id={r["id"]:r for r in rows}
    for file in ["character-story.json","character-diverse.json","outfit-school.json","outfit-maid.json"]:
        q=json.loads((ROOT/"examples"/file).read_text(encoding="utf-8")); t0=time.perf_counter(); result=cat.retrieve(q)
        check(file+" 有真实候选",result["status"]=="ok",{"candidate_count":result["candidate_count"],"elapsed_ms":round((time.perf_counter()-t0)*1000)})
        (ROOT/"examples"/(file.replace(".json","-result.json"))).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        check(file+" 同种子结果可复现",result==cat.retrieve(q))
        if q["kind"]=="character":
            for pick in result["results"]:
                original=row_by_id[pick["id"]]
                for f,values in result["query"]["required"].items(): check(file+" 必须条件 "+f+"/"+pick["id"],bool(set(values)&set(original["facets"].get(f,[]))))
                check(file+" 输出外貌不含衣服",not set(pick["prepared"]["appearance_tags"])&set(original["outfit_tags"]))
            q2={**q,"exclude_ids":[r["id"] for r in result["results"]]}
            check(file+" 已使用原型能排除",not set(q2["exclude_ids"])&{r["id"] for r in cat.retrieve(q2)["results"]})
        else:
            check(file+" 只抽取含核心服装的非泳装非内衣组合",all(p["quality"]["has_core"] and not p["quality"]["contains_underwear"] and not p["quality"]["contains_swimwear"] for p in result["results"]))
    no_match=cat.retrieve({"required":{"hair_color":"nonexistent color"},"seed":"impossible"})
    check("无匹配时不放宽硬条件",no_match["status"]=="no_match" and not no_match["results"] and no_match["relaxed_constraints"]==[])
    try:cat.retrieve({"required":{"personality":"冷淡"}}); rejected=False
    except ValueError:rejected=True
    check("拒绝把无数据的性格当作既有筛选条件",rejected)
    # Real ambiguous record, queried via a mandatory tag rather than a facet.
    dual=next(r for r in rows if len(r["facets"].get("hair_color",[]))>1 and not r["facets"].get("hair_pattern"))
    color=dual["facets"]["hair_color"][-1]; target=next(t for t in dual["appearance_tags"] if cat.tags[t]["facet"]=="hair_color" and cat.tags[t]["value"]==color)
    query=cat.query_normalized({"required_tags":[target],"seed":"ambiguity-test"})
    prepared=prepare_character(dual,cat.tags,query)
    check("必选 tag 指定的发色优先于原始首项",[t for t in prepared["appearance_tags"] if cat.tags[t]["facet"]=="hair_color"]==[target],dual["id"])
    ear_record=cat.get("nureha_(log_horizon)")
    ear_prepared=prepare_character(ear_record,cat.tags,cat.query_normalized({"seed":"ear-test"}))
    check("原型耳型歧义提前处理",not ({"fox ears","wolf ears"}<=set(ear_prepared["appearance_tags"])))
    elf_record=next(r for r in rows if "elf" in r["tags"] and r["quality"]["eligible_default"])
    elf_prepared=prepare_character(elf_record,cat.tags,cat.query_normalized({"seed":"elf-test"}))
    check("种族证据进入形象 prompt", "elf" in elf_prepared["appearance_tags"])
    check("服装组合仅含衣服和可摘配饰",all(all(cat.tags[t]["section"] in {"outfit","accessory"} for t in o["tags"]) for o in outfits))
    check("局部服装不会默认当成完整核心服装",all(not o["quality"]["eligible_default"] for o in outfits if o["quality"]["partial"]))
    bad_identity=["wolf cut","stuffed cat","bird on head","tall hat","arm across chest","hair ribbon","head-mounted display","floating hair","shirt","holding sword"]
    check("易误分类标签语义边界",all(cat.tags[t]["section"]!="appearance" for t in bad_identity if t in cat.tags and t!="wolf cut") and cat.tags.get("wolf cut",{}).get("facet")=="hair_style")
    report={"status":"passed","checks_passed":len(checks),"elapsed_seconds":round(time.perf_counter()-start,2),"checks":checks}
    (ROOT/"reports"/"validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in report.items() if k!="checks"},ensure_ascii=False))

if __name__=="__main__":sys.stdout.reconfigure(encoding="utf-8");main()

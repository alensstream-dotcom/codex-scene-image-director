"""Apply explicit user preferences; no guessed release year or facial-quality scores."""
import collections,json,pathlib

def apply_profile(records,profile):
    selected=[];excluded=[];counts=collections.Counter();male_ids=set(profile["male_keep_ids"])
    if len(male_ids)>10:raise ValueError("男性原型不得超过10个")
    for r in records:
        reasons=[];genders=r["facets"].get("gender",[]);tags=set(r["tags"])
        is_reserved_male=r["id"] in male_ids and genders==["male"]
        if not is_reserved_male and genders!=["female"]:reasons.append("not_female_or_reserved_male")
        if not r["quality"]["eligible_default"]:reasons.append("insufficient_or_ambiguous_appearance")
        if r["id"] in profile["excluded_ids"]:reasons.append("user_or_curated_cartoon_face")
        if any(a in r["id"] for a in profile["excluded_author_tokens"]):reasons.append("specified_cartoon_character_author")
        if tags&set(profile["excluded_tags"]):reasons.append("explicit_chibi_or_lowpoly_variant")
        if r["copyright_id"] in profile["excluded_copyright_ids"]:reasons.append("clearly_exaggerated_cartoon_series")
        # Beast faces are distinguished from normal human faces with animal ears.
        if (tags&{"furry","furry female","anthro"}) and (tags&{"snout","muzzle","beak","animal nose"}):reasons.append("animal_face_not_human_faced_kemonomimi")
        if reasons:
            excluded.append({"id":r["id"],"name":r["name"],"series":r["series"],"reasons":reasons});counts.update(set(reasons));continue
        r["profile"]={"id":profile["id"],"face_quality":"unreviewed","preserves_retro_illustration":True,"reserved_male":is_reserved_male}
        selected.append(r)
    present={r["id"] for r in selected}
    report={"profile":profile,"source_records":len(records),"retained":len(selected),"female":sum(r["facets"].get("gender")==["female"] for r in selected),
            "male":sum(r["facets"].get("gender")==["male"] for r in selected),"exclusion_reason_counts":dict(counts),
            "male_reserves_present":[i for i in profile["male_keep_ids"] if i in present],"male_reserves_missing":[i for i in profile["male_keep_ids"] if i not in present],
            "preserve_base_checks":{i:i in present for i in profile["preserve_base_ids"]},"excluded":excluded,
            "limit_zh":"没有图片逐张评分；不能声称已经识别全部粗糙脸。明确样例和可判定的类别已排除，剩余脸部质量可进一步复核。"}
    return selected,report

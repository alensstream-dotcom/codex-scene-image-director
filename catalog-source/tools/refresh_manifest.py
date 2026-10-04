"""Refresh all deliverable hashes after rebuilding/verifying the existing snapshot."""
import hashlib,json,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
path=ROOT/"manifest.json"
data=json.loads(path.read_text(encoding="utf-8"))
statistics=json.loads((ROOT/"reports"/"catalog-statistics.json").read_text(encoding="utf-8"))
data["active_profile"]=statistics.get("active_profile","full")
data["catalog_counts"]={k:statistics[k] for k in ["source_characters_total","characters_total","outfits_total","outfits_default_eligible"] if k in statistics}
data["limitations"]=[x for x in data.get("limitations",[]) if x!="Missing source tags retained"]
data["limitations"].extend(x for x in ["Original full snapshot is retained; active indexes reflect the selected profile","Retained faces are not all visually scored","LoRA recommendations are author declarations and file-list checks, not local inference tests"] if x not in data["limitations"])
data["artifacts"]={}
for p in sorted(ROOT.rglob("*")):
    if not p.is_file() or p==path or "__pycache__" in p.parts or p.suffix in {".pyc",".building"}:continue
    data["artifacts"][p.relative_to(ROOT).as_posix()]={"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps({"artifacts":len(data["artifacts"]),"bytes":sum(x["bytes"] for x in data["artifacts"].values())},ensure_ascii=False))

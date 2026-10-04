"""Create a portable archive of this completed catalog; verify archive CRCs."""
import argparse,hashlib,json,pathlib,sys,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument("--output",type=pathlib.Path,required=True);args=p.parse_args()
if args.output.resolve().is_relative_to(ROOT.resolve()):raise ValueError("Archive must be outside the catalog directory")
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts and path.suffix!=".pyc":z.write(path,(pathlib.Path(ROOT.name)/path.relative_to(ROOT)).as_posix())
with zipfile.ZipFile(args.output) as z:
    bad=z.testzip()
    if bad:raise ValueError("CRC failed: "+bad)
    members=len(z.infolist())
sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps({"archive":str(args.output),"bytes":args.output.stat().st_size,"sha256":hashlib.sha256(args.output.read_bytes()).hexdigest(),"files":members,"crc":"passed"},ensure_ascii=False))

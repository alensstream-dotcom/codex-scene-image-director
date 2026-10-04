import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const files=readdirSync(root).filter(f=>f.endsWith('.test.mjs'));
const r=spawnSync(process.execPath,['--test','--test-concurrency=2','--test-reporter=tap',...files],{cwd:root,stdio:'inherit'});
process.exit(r.status??1);

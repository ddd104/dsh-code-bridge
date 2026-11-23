import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(new URL('../.test-state/',import.meta.url),{recursive:true});
const result=spawnSync(process.execPath,['--test',...process.argv.slice(2),'test/*.test.mjs'],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;

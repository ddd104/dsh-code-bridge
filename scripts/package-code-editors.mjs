import {spawnSync} from 'node:child_process';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyFile, readFile, writeFile, readdir, mkdir, rename} from 'node:fs/promises';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=join(root,'dist/code-editors');
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error('Run with npm run package:editors or npm run package:dsh');
function run(command,args,cwd=root,options={}){
  const result=spawnSync(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:true,...options});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} exited with ${result.status}: ${result.stderr??''}`);
  return result;
}
const release={version:manifest.version,packages:{dsh:`dsh-code-bridge-${manifest.version}.tgz`},skipped:[]};
run(process.execPath,[join(root,'scripts/build-code-editors.mjs')]);
// Preserve old releases while ensuring this directory contains one current version.
for(const name of await readdir(out)){
  if(/\.(tgz|vsix|zip)$/.test(name)&&!name.endsWith(`-${manifest.version}.${name.split('.').at(-1)}`)){
    const previous=join(out,'previous',String(Date.now()));await mkdir(previous,{recursive:true});await rename(join(out,name),join(previous,name));
  }
}
run(process.execPath,[npmCli,'pack',root,'--pack-destination',out,'--ignore-scripts']);
if(!process.argv.includes('--dsh-only')){
  release.packages.vscode=`ask-for-dsh-vscode-${manifest.version}.vsix`;
  // Local VSIX packaging does not need keytar's native credential-store build.
  run(process.execPath,[npmCli,'exec','--ignore-scripts','--yes','--package=@vscode/vsce@3.6.2','--','vsce','package','--no-dependencies','--out',join(out,release.packages.vscode)],join(out,'vscode'));
  for(const ide of ['rider','android-studio']){
    const sdk=JSON.parse(run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/resolve-ide.ps1'),'-Ide',ide,'-AsJson'],root,{stdio:'pipe',encoding:'utf8'}).stdout.trim());
    if(!sdk.compatible){
      if(process.argv.includes('--require-all'))throw new Error(sdk.reason);
      release.skipped.push({component:ide,reason:sdk.reason});console.log(`SKIPPED ${ide}: ${sdk.reason}`);continue;
    }
    run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/build-jetbrains.ps1'),'-Ide',ide,'-IdeHome',sdk.home]);
    release.packages[ide]=`ask-for-dsh-${ide}-${manifest.version}.zip`;
  }
}
for(const name of ['install-code-editors.ps1','resolve-dsh-cli.ps1'])await copyFile(join(root,'scripts',name),join(out,name));
await copyFile(join(root,'README.md'),join(out,'README.md'));
await writeFile(join(out,'install.bat'),'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-code-editors.ps1" %*\r\nif errorlevel 1 (pause & exit /b 1)\r\npause\r\n');
await writeFile(join(out,'release.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify(release,null,2));console.log(`Release ready: ${out}`);

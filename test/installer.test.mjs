import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const windows=process.platform==='win32';
const root=resolve('.test-state');
const psQuote=value=>`'${value.replaceAll("'","''")}'`;
function powershell(args,env={}){
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass',...args],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,...env}});
  if(result.error)throw result.error;return result;
}
const exists=async path=>access(path).then(()=>true,()=>false);
async function fixture(t){
  const base=await mkdtemp(join(root,'installer-'));
  t.after(async()=>{assert.equal(dirname(base),root);await rm(base,{recursive:true,force:true});});
  const packages=join(base,'release bundle'),profile=join(base,'dsh-home/profiles/test'),rider=join(base,'Rider config'),android=join(base,'Android config'),cli=join(base,'cli tools'),calls=join(base,'calls.jsonl');
  for(const dir of [packages,profile,rider,android,cli,join(base,'zip/ask-for-dsh/lib')])await mkdir(dir,{recursive:true});
  await writeFile(join(profile,'package.json'),' {"private":true,"marker":"keep"}\n');
  await writeFile(join(profile,'cordis.patch.yml'),'existing: true\n');
  for(const dir of [rider,android]){await mkdir(join(dir,'plugins/ask-for-dsh/lib'),{recursive:true});await writeFile(join(dir,'plugins/ask-for-dsh/lib/old.jar'),'old');}
  await writeFile(join(base,'zip/ask-for-dsh/lib/ask-for-dsh.jar'),'new');
  const release={version:'0.3.0',packages:{dsh:'dsh-code-bridge-0.3.0.tgz',vscode:'ask-for-dsh-vscode-0.3.0.vsix',rider:'ask-for-dsh-rider-0.3.0.zip','android-studio':'ask-for-dsh-android-studio-0.3.0.zip'}};
  await writeFile(join(packages,'release.json'),JSON.stringify(release));
  for(const key of ['dsh','vscode'])await writeFile(join(packages,release.packages[key]),'fixture');
  const zipped=powershell(['-Command',`Compress-Archive -LiteralPath ${psQuote(join(base,'zip/ask-for-dsh'))} -DestinationPath ${psQuote(join(packages,release.packages.rider))}; Copy-Item -LiteralPath ${psQuote(join(packages,release.packages.rider))} -Destination ${psQuote(join(packages,release.packages['android-studio']))}`]);
  assert.equal(zipped.status,0,zipped.stderr);
  await writeFile(join(cli,'mock.cjs'),"require('node:fs').appendFileSync(process.env.DSH_INSTALL_TEST_LOG,JSON.stringify(process.argv.slice(2))+'\\n');process.exit(process.env.DSH_INSTALL_TEST_FAIL==='1'?7:0);\n");
  for(const name of ['dsh.cmd','code.cmd'])await writeFile(join(cli,name),`@echo off\r\n"${process.execPath}" "%~dp0mock.cjs" %*\r\nexit /b %errorlevel%\r\n`);
  const env={DSH_HOME:join(base,'dsh-home'),DSH_INSTALL_TEST_LOG:calls,DSH_INSTALL_TEST_FAIL:'0'};
  const args=['-File',resolve('scripts/install-code-editors.ps1'),'-PackageDirectory',packages,'-Profile','test','-DshCli',join(cli,'dsh.cmd'),'-VSCodeCli',join(cli,'code.cmd'),'-RiderConfig',rider,'-AndroidStudioConfig',android];
  return {base,packages,profile,rider,android,calls,env,run:(extra=[],moreEnv={})=>powershell([...args,...extra],{...env,...moreEnv})};
}
test('installer updates all four targets, preserves configuration and replaces stale IDE jars',{skip:!windows},async t=>{
  const f=await fixture(t),result=f.run();assert.equal(result.status,0,result.stdout+result.stderr);
  const calls=(await readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(calls.length,2);
  assert.deepEqual(calls[0].slice(0,4),['plugin','--profile','test','add']);assert.equal(calls[0].at(-1),'--ignore-scripts');
  assert.equal(calls[1][0],'--install-extension');assert.equal(calls[1].at(-1),'--force');
  const backups=join(f.profile,'.plugin-manager/dsh-code-bridge-backups');const [stamp]=await readdir(backups);
  assert.equal(await readFile(join(backups,stamp,'package.json'),'utf8'),await readFile(join(f.profile,'package.json'),'utf8'));
  for(const dir of [f.rider,f.android]){
    assert.equal(await readFile(join(dir,'plugins/ask-for-dsh/lib/ask-for-dsh.jar'),'utf8'),'new');
    assert.equal(await exists(join(dir,'plugins/ask-for-dsh/lib/old.jar')),false);
    assert.equal(await readFile(join(dir,'dsh-code-bridge-backups',stamp,'ask-for-dsh/lib/old.jar'),'utf8'),'old');
    assert.deepEqual(await readdir(join(dir,'plugins')),['ask-for-dsh']);
  }
});
test('WhatIf checks the plan without invoking CLIs or altering plugins',{skip:!windows},async t=>{
  const f=await fixture(t),result=f.run(['-WhatIf']);assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(await exists(f.calls),false);assert.equal(await exists(join(f.profile,'.plugin-manager')),false);
  assert.equal(await readFile(join(f.rider,'plugins/ask-for-dsh/lib/old.jar'),'utf8'),'old');
});
test('invalid ZIP fails preflight before any DSH or editor installation',{skip:!windows},async t=>{
  const f=await fixture(t);const archive=join(f.packages,'ask-for-dsh-android-studio-0.3.0.zip');
  const result=powershell(['-Command',`Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip=[IO.Compression.ZipFile]::Open(${psQuote(archive)},[IO.Compression.ZipArchiveMode]::Update); $null=$zip.CreateEntry('ask-for-dsh/../escaped.txt'); $zip.Dispose()`]);
  assert.equal(result.status,0,result.stderr);const installed=f.run();assert.notEqual(installed.status,0);assert.match(installed.stderr,/Unexpected ZIP entry/);
  assert.equal(await exists(f.calls),false);assert.equal(await exists(join(f.profile,'.plugin-manager')),false);
});
test('DSH CLI failure preserves backups and stops subsequent editor installs',{skip:!windows},async t=>{
  const f=await fixture(t),result=f.run([],{DSH_INSTALL_TEST_FAIL:'1'});assert.notEqual(result.status,0);assert.match(result.stderr,/DSH installation failed/);
  assert.equal((await readFile(f.calls,'utf8')).trim().split('\n').length,1);
  assert.equal((await readdir(join(f.profile,'.plugin-manager/dsh-code-bridge-backups'))).length,1);
  assert.equal(await readFile(join(f.rider,'plugins/ask-for-dsh/lib/old.jar'),'utf8'),'old');
});

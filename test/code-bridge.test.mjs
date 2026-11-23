import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, writeFile} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodeBridge} from '../editors/dsh-code-bridge/src/server.mjs';
import {discoverTargets, currentTarget, request, sendCapture} from '../editors/shared/transport.mjs';
import {captureSchema, formatCapture} from '../editors/shared/protocol.mjs';
import {appendCapture, receiptStore, SOURCE, readAttachment, attachmentReference, serializeAttachment, editAttachment, occurrenceSpan} from '../editors/dsh-code-bridge/src/delivery.mjs';
import {captureEditor} from '../editors/vscode/src/capture.mjs';

const session = 'session-A';
const registration = () => ({clientId:randomUUID(), label:'测试对话', projectPath:'F:/项目'});
const capture = (targetId = randomUUID(), text = 'abc') => ({id:randomUUID(), targetId, editor:'vscode', filePath:'F:/项目/玩家.cpp', projectPath:'F:/项目', language:'cpp', dirty:true, documentVersion:'42', capturedAt:new Date().toISOString(), selections:[{start:{line:7,column:3}, end:{line:7,column:3+text.length}, text}]});
async function server(t, options = {}) {
  const base = resolve('.test-state'); const directory = await mkdtemp(join(base, 'code-'));
  const bridge = new CodeBridge({directory, ...options});
  t.after(async () => {await bridge.close(); if (dirname(directory) !== base) throw new Error('Unexpected cleanup target'); await rm(directory, {recursive:true, force:true});});
  await bridge.start(); return bridge;
}

test('authenticated discovery, explicit capture and acknowledgement through real HTTP', async t => {
  const bridge = await server(t); const owner = registration();
  const poll = bridge.poll(session, owner);
  const targets = await discoverTargets(bridge.directory);
  assert.equal(targets.length, 1); assert.equal(targets[0].id, poll.targetId);
  const value = capture(poll.targetId);
  const result = await sendCapture(targets[0], value, {waitMs:0});
  assert.equal(result.state, 'pending');
  assert.deepEqual(bridge.poll('session-B', registration()).request, null);
  const incoming = bridge.poll(session, owner).request;
  assert.deepEqual(incoming.capture, value);
  bridge.ack(session, {clientId:owner.clientId, id:value.id, state:'applied'});
  assert.equal((await request(targets[0].endpoint, `/v1/captures/${value.id}`)).state, 'applied');
  assert.equal(bridge.poll(session, owner).request, null);
  assert.equal(bridge.requests.get(value.id).capture, undefined);
});

test('HTTP rejects browser origins and missing credentials, with no capture side effects', async t => {
  const bridge = await server(t); const url = `http://127.0.0.1:${bridge.port}/v1/targets`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, {headers:{Authorization:`Bearer ${bridge.token}`, Origin:'https://example.com'}})).status, 403);
  assert.equal(bridge.requests.size, 0);
});

test('Android Studio Kotlin snapshot arrives with its source, exact selection and editable attachment intact', async t => {
  const bridge = await server(t), owner = registration();
  const target = bridge.poll(session, owner);
  const value = {...capture(target.targetId), editor:'android-studio', filePath:'F:/项目/app/src/main/java/MainActivity.kt', language:'kotlin',
    selections:[{start:{line:8,column:3},end:{line:9,column:4},text:'val text = "你好😀"\r\nfoo'}]};
  const endpoint = (await discoverTargets(bridge.directory))[0];
  assert.equal((await sendCapture(endpoint, value, {waitMs:0})).state,'pending');
  const received = bridge.poll(session, owner).request.capture;
  assert.deepEqual(received,value);
  const ref = attachmentReference({version:1,capture:received});
  const modelText = serializeAttachment(ref.ref);
  assert.match(modelText,/来源：Android Studio/);
  assert.match(modelText,/```kotlin/);
  assert.match(modelText,/8:3–9:4/);
  assert.match(modelText,/包含未保存修改/);
  assert.match(serializeAttachment(editAttachment(ref.ref,['val fixed = true']).ref),/val fixed = true/);
  bridge.ack(session,{clientId:owner.clientId,id:value.id,state:'applied'});
  assert.equal((await request(endpoint.endpoint,`/v1/captures/${value.id}`)).state,'applied');
});

test('retry is idempotent; same ID with different content cannot replace queued code', () => {
  const bridge = new CodeBridge(); const owner = registration(); const target = bridge.poll(session, owner);
  const value = capture(target.targetId); bridge.accept(value); bridge.accept(value);
  assert.equal(bridge.requests.size, 1);
  assert.throws(() => bridge.accept({...value, dirty:false}), /already used/);
  bridge.ack(session, {clientId:owner.clientId, id:value.id, state:'applied'});
  assert.equal(bridge.accept(value).state, 'applied');
});

test('switching targets rejects waiting captures and never forwards to another chat', () => {
  const bridge = new CodeBridge(); const owner = registration(); const target = bridge.poll(session, owner);
  const value = capture(target.targetId); bridge.accept(value);
  assert.throws(() => bridge.ack('other-session', {clientId:owner.clientId, id:value.id, state:'applied'}), /does not belong/);
  bridge.release(session, {...owner, targetId:target.targetId});
  assert.equal(bridge.status(value.id).state, 'rejected');
  assert.equal(bridge.poll('other-session', owner).request, null);
  assert.throws(() => bridge.accept(capture(target.targetId)), /离线/);
});

test('stale windows disappear and queued code expires instead of reaching a replacement window', () => {
  let now = 0; const bridge = new CodeBridge({now:() => now});
  const owner = registration(); const target = bridge.poll(session, owner); const value = capture(target.targetId); bridge.accept(value);
  now = 13000; assert.deepEqual(bridge.listTargets(), []);
  assert.equal(bridge.poll(session, owner).request, null);
  now = 120001; assert.equal(bridge.status(value.id).state, 'expired');
});

test('discovery ignores stale and malformed instance files; close removes only its discovery', async t => {
  const bridge = await server(t); bridge.poll(session, registration());
  await writeFile(join(bridge.directory, `${randomUUID()}.json`), '{bad json');
  assert.equal((await discoverTargets(bridge.directory)).length, 1);
  await bridge.close(); assert.equal((await readdir(bridge.directory)).length, 1);
});

test('schema preserves UTF-16, partial lines and CRLF, and rejects inconsistent positions', () => {
  const value = capture(); value.selections = [{start:{line:4,column:2}, end:{line:5,column:3}, text:'你好😀\r\nxy'}];
  assert.equal(captureSchema.parse(value).selections[0].text, '你好😀\r\nxy');
  value.selections[0].end.column = 4; assert.equal(captureSchema.safeParse(value).success, false);
  assert.equal(captureSchema.safeParse({...capture(), filePath:'relative.cpp'}).success, false);
  assert.equal(captureSchema.safeParse({...capture(), selections:[]}).success, false);
});

test('format protects code fences and keeps file identity, versions and unsaved state', () => {
  const value = capture(randomUUID(), '```');
  const formatted = formatCapture(value);
  assert.match(formatted, /````cpp\n```\n````/); assert.match(formatted, /包含未保存修改/);
  assert.ok(formatted.includes('玩家.cpp')); assert.match(formatted, /7:3–7:6/);
});

test('code attachment preserves the question and existing reference coordinates, without inserting source text', () => {
  let inserted;
  const insert = (reference, span) => {inserted = {reference, span}; return true;};
  const input = {draft:'请改 @file.cpp', draftRev:8, phase:'plain', occurrences:[{length:9}]};
  const value = capture();
  assert.equal(appendCapture(insert, input, value), true);
  assert.deepEqual(inserted.span, {start:input.draft.length-8, end:input.draft.length-8, draftRev:8});
  assert.equal(inserted.reference.source, SOURCE);
  assert.ok(!inserted.reference.clipboardText.includes(value.selections[0].text));
  assert.deepEqual(readAttachment(inserted.reference.ref).capture, value);
  inserted = null; assert.equal(appendCapture(insert, {...input, phase:'submitting'}, value), false); assert.equal(inserted, null);
});

test('automatic routing follows activation, not polling order or the editor project', () => {
  let now = 100; const bridge = new CodeBridge({now:() => now});
  const a = registration(), b = registration();
  const first = bridge.poll('a', {...a, activatedAt:100});
  now = 200; const second = bridge.poll('b', {...b, activatedAt:200});
  now = 300; bridge.poll('a', {...a, activatedAt:100});
  assert.equal(currentTarget(bridge.listTargets()).id, second.targetId);
  now = 400; bridge.poll('a', {...a, activatedAt:400});
  assert.equal(currentTarget(bridge.listTargets()).id, first.targetId);
  bridge.release('a', {...a, targetId:first.targetId});
  assert.equal(currentTarget(bridge.listTargets()).id, second.targetId);
  assert.throws(() => currentTarget([]), /打开一个对话/);
});

test('editing preserves original coordinates and serializes only the revised snapshot', () => {
  const value = capture(), original = attachmentReference({version:1, capture:value});
  const revised = editAttachment(original.ref, ['different\ncontent']);
  const decoded = readAttachment(revised.ref);
  assert.deepEqual(decoded.capture, value);
  assert.deepEqual(decoded.edits, ['different\ncontent']);
  assert.match(revised.label, /已编辑/);
  const model = serializeAttachment(revised.ref);
  assert.match(model, /different\ncontent/); assert.match(model, /仍指原始选区/);
  assert.match(model, /7:3–7:6/); assert.ok(!model.includes('\nabc\n'));
  assert.equal(readAttachment(editAttachment(revised.ref, ['abc']).ref).edits, undefined);
  assert.throws(() => editAttachment(original.ref, ['x'.repeat(128*1024+1)]));
  assert.throws(() => serializeAttachment('{bad json'));
});

test('occurrence deletion/replacement uses native chip spans after other references', () => {
  const input = {draftRev:9, occurrences:[{occurrenceId:1,offset:2,length:10},{occurrenceId:2,offset:14,length:20}]};
  assert.deepEqual(occurrenceSpan(input, 2), {start:5,end:6,draftRev:9});
  assert.equal(occurrenceSpan(input, 5), undefined);
});

test('receipts survive remount and remain isolated by session and browser', () => {
  const values = new Map(); const storage = {getItem:key => values.get(key), setItem:(key, value) => values.set(key, value)};
  receiptStore(storage, 'a', 'client').add('request');
  assert.ok(receiptStore(storage, 'a', 'client').has('request'));
  assert.equal(receiptStore(storage, 'b', 'client').has('request'), false);
  assert.equal(receiptStore(storage, 'a', 'other-client').has('request'), false);
});

test('VS Code snapshots selected buffer content before discovery, without saving', () => {
  let content = '未保存😀';
  const editor = {document:{uri:{scheme:'file',fsPath:'F:\\项目\\测试.cpp'}, version:5, languageId:'cpp', isDirty:true, getText:() => content}, selections:[{isEmpty:false,start:{line:9,character:2},end:{line:9,character:7}}]};
  const value = captureEditor(editor, 'F:\\项目'); content = 'later edit';
  assert.equal(value.selections[0].text, '未保存😀'); assert.equal(value.dirty, true);
  assert.equal(captureSchema.safeParse({...value, targetId:randomUUID()}).success, true);
  assert.throws(() => captureEditor({...editor, document:{uri:{scheme:'untitled'}}}), /本机文件/);
});

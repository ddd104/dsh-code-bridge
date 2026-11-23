import test from 'node:test';
import assert from 'node:assert/strict';
import React, {useSyncExternalStore} from 'react';
import Renderer, {act} from 'react-test-renderer';
import {randomUUID} from 'node:crypto';
import {CodeAttachments, apply} from '../editors/dsh-code-bridge/src/client.mjs';
import {SOURCE, serializeAttachment} from '../editors/dsh-code-bridge/src/delivery.mjs';
import {CodeBridge} from '../editors/dsh-code-bridge/src/server.mjs';

function composer() {
  let snapshot = {draft:'请优化以下代码', draftRev:1, phase:'plain', occurrences:[]};
  const subscribers = new Set(); let inserts = 0, persists = 0;
  return {
    snapshot:() => snapshot, inserts:() => inserts, persists:() => persists,
    useInput:selector => useSyncExternalStore(callback => {subscribers.add(callback); return () => subscribers.delete(callback);}, () => selector(snapshot)),
    insertReference(reference, span) {
      assert.equal(span.start, snapshot.draft.length); assert.equal(span.end, snapshot.draft.length);
      if (span.draftRev !== snapshot.draftRev) return false;
      snapshot = {...snapshot, draft:snapshot.draft + reference.clipboardText, draftRev:snapshot.draftRev+1,
        occurrences:[...snapshot.occurrences, {...reference, occurrenceId:1, offset:snapshot.draft.length, length:reference.clipboardText.length}]}; inserts++;
      for (const callback of subscribers) callback(); return true;
    },
    inputActions:{insertText:() => assert.fail('Must insert a structured attachment'), persistDraft:() => {persists++;}, submit:() => assert.fail('Auto submission is forbidden'), setDraft:() => assert.fail('Existing draft must be preserved')}
  };
}
const waitPoll = () => new Promise(resolve => setTimeout(resolve, 760));
function payload(targetId) {
  return {id:randomUUID(),targetId,editor:'rider',filePath:'F:/Project/Actor.cpp',projectPath:'F:/Project',language:'cpp',dirty:true,documentVersion:'8',capturedAt:new Date().toISOString(),selections:[{start:{line:5,column:2},end:{line:5,column:5},text:'abc'}]};
}

test('always-on receiver attaches a native reference once, persists, and retries a lost acknowledgement', async () => {
  const bridge = new CodeBridge(); const state = composer(); const sessionId = 'client-integration';
  let acknowledgements = 0;
  const props = {sessionId, ...state, useSessions:selector => selector({byId:{[sessionId]:{title:'代码修改', cwd:'F:/Project'}}}),
    poll:async value => bridge.poll(sessionId, value),
    ack:async value => {acknowledgements++; if (acknowledgements === 1) throw new Error('simulated lost response'); assert.ok(state.persists() > 0); return bridge.ack(sessionId, value);},
    release:async value => bridge.release(sessionId, value)};
  let tree;
  try {
    await act(async () => {tree = Renderer.create(React.createElement(CodeAttachments, props));});
    assert.equal(state.inserts(), 0);
    const target = bridge.listTargets()[0]; assert.equal(target.label, '代码修改');
    const value = payload(target.id); bridge.accept(value);
    await act(waitPoll); await act(waitPoll);
    assert.equal(state.inserts(), 1); assert.equal(bridge.status(value.id).state, 'applied');
    assert.ok(state.snapshot().draft.startsWith('请优化以下代码[代码附件'));
    assert.ok(!state.snapshot().draft.includes('abc'));
    assert.match(serializeAttachment(state.snapshot().occurrences[0].ref), /abc/);
    assert.ok(state.snapshot().draft.includes('Actor.cpp'));
    assert.equal(tree.root.findAllByType('input').length, 0);
    await act(async () => tree.unmount()); tree = null;
    assert.equal(bridge.listTargets().length, 0);
  } finally {if (tree) await act(async () => tree.unmount());}
});

test('an in-flight poll cannot append code after the conversation component is closed', async () => {
  let resolvePoll; const released = []; const state = composer(); let tree;
  const targetId = randomUUID();
  await act(async () => {tree = Renderer.create(React.createElement(CodeAttachments, {sessionId:'closed-client', ...state,
    useSessions:selector => selector({byId:{}}), poll:() => new Promise(resolve => {resolvePoll=resolve;}),
    ack:async () => assert.fail('Must not ack an unapplied capture'), release:async value => {released.push(value);}}));});
  await act(async () => tree.unmount());
  await act(async () => {resolvePoll({targetId, request:{id:randomUUID(),capture:payload(targetId)}});});
  assert.equal(state.inserts(), 0); assert.equal(released[0].targetId, targetId);
});

test('DSH slot scopes all remote calls to the owning conversation', async () => {
  let definition, source; const calls=[];
  const ctx={remote:{$mount:async value=>{assert.equal(value.package,'dsh-code-bridge');}},sessions:{using:async (id,_options,callback)=>{calls.push(id);return callback({binding:{session:{getSnapshot:()=>({openState:'open'})}}});}}, slots:{inject:(_name,fn)=>fn(),register:entry=>{definition=entry;}}};
  ctx.remote.codeBridge = Object.fromEntries(['poll','ack','release'].map(method => [method,async (sessionId, request)=>({ok:true,value:{method,sessionId,request}})]));
  ctx.inject=(_keys,fn)=>fn(ctx);
  ctx.effect=fn=>fn(); ctx.inputTriggers={registerSource:value=>{source=value;return ()=>{};}};
  ctx.sessions.scope=id=>({bail:(event, request)=>{calls.push(id);assert.equal(event,"slash/input-insert-reference");return true;}});
  await apply(ctx); const actions=definition.inject('owning-chat');
  assert.equal((await actions.poll({clientId:'test'})).sessionId,'owning-chat');
  assert.equal(actions.insertReference({},{}),true);
  assert.deepEqual(calls,['owning-chat','owning-chat']);
  assert.equal(definition.name,'conversation.input.overlay');
  assert.equal(source.name,SOURCE);
  assert.equal((await source.candidates()).length,0);
});

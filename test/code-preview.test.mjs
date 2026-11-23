import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import React, {act, useSyncExternalStore} from 'react';
import {CodeAttachments} from '../editors/dsh-code-bridge/src/client.mjs';
import {attachmentReference, readAttachment, serializeAttachment, SOURCE} from '../editors/dsh-code-bridge/src/delivery.mjs';

test('hover preview, attachment edits, cancel and delete preserve the question and other attachments', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'http://localhost'});
  const previous = {window:globalThis.window, document:globalThis.document, IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
  Object.assign(globalThis, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot} = await import('react-dom/client');
  const capture = {id:randomUUID(), targetId:randomUUID(), editor:'vscode', filePath:'F:/项目/Actor.cpp', projectPath:'F:/项目', language:'cpp', dirty:true, documentVersion:'4', capturedAt:new Date().toISOString(),
    selections:[{start:{line:8,column:1},end:{line:9,column:1},text:'Original();\n'}]};
  let reference = attachmentReference({version:1,capture});
  const question = '请优化这里 ', other = '@other.cpp ';
  let present = true, revision = 1, persisted = 0, current;
  const listeners = new Set();
  const publish = () => {
    current = {phase:'plain', draftRev:revision++, attachmentIds:['image-1'], draft:question + other + (present ? reference.clipboardText : ''),
      occurrences:[{source:'reference', ref:'@other.cpp', occurrenceId:1, offset:question.length, length:other.length},
        ...(present ? [{...reference, occurrenceId:2, offset:question.length+other.length, length:reference.clipboardText.length}] : [])]};
    for (const listener of listeners) listener();
  };
  publish();
  const checkSpan = span => assert.deepEqual(span, {start:question.length+1, end:question.length+2, draftRev:current.draftRev});
  const props = {sessionId:'preview-chat', useSessions:selector => selector({byId:{}}),
    useInput:selector => useSyncExternalStore(callback => {listeners.add(callback); return () => listeners.delete(callback);}, () => selector(current)),
    insertReference:(next, span) => {checkSpan(span); reference=next; publish(); return true;},
    inputActions:{insertText:(text, span) => {assert.equal(text,'');checkSpan(span);present=false;publish();return true;}, persistDraft:() => persisted++, submit:() => assert.fail('Must not auto-send'), setDraft:() => assert.fail('Must not overwrite question')},
    poll:async () => ({targetId:capture.targetId,request:null}), ack:async () => {}, release:async () => {}};
  function Fixture() {
    props.useInput(state=>state);
    return React.createElement('div', {'data-composer-card':''},
      React.createElement('div', {'data-composer-overlay':''}, React.createElement(CodeAttachments, props)),
      React.createElement('div', {'data-composer-input':'',contentEditable:true,suppressContentEditableWarning:true}, question, other,
        present && React.createElement('span', {'data-composer-chip':SOURCE,contentEditable:false}, reference.label)));
  }
  const root = createRoot(document.getElementById('root'));
  const button = name => [...document.querySelectorAll('button')].find(element=>element.textContent===name);
  const event = (element, kind, options={}) => act(async () => element.dispatchEvent(new window.MouseEvent(kind, {bubbles:true,...options})));
  const hover = () => event(document.querySelector(`[data-composer-chip="${SOURCE}"]`), 'mouseover');
  const type = async (area, value) => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, value);
    area.dispatchEvent(new window.Event('input', {bubbles:true}));
  });
  try {
    await act(async () => root.render(React.createElement(Fixture)));
    assert.equal(document.querySelector('[role="dialog"]'),null);
    assert.equal(document.querySelector('input[type="checkbox"]'),null);
    assert.ok(!document.querySelector('[data-composer-input]').textContent.includes('Original'));
    await hover();
    assert.match(document.querySelector('pre').textContent,/Original/);
    assert.match(document.querySelector('[role="dialog"]').textContent,/8:1–9:1/);
    await event(button('编辑'),'click');
    let area = document.querySelector('textarea');
    await type(area, 'Revised();\nSecond();');
    await event(button('保存'),'click');
    assert.match(serializeAttachment(reference.ref),/Revised\(\);\nSecond/);
    assert.match(serializeAttachment(reference.ref),/仍指原始选区/);
    assert.equal(readAttachment(reference.ref).capture.selections[0].text,'Original();\n');
    assert.equal(document.querySelector('[role="dialog"]'),null);
    await hover();
    assert.equal(document.querySelector('pre').textContent,'Revised();\nSecond();');
    await event(button('编辑'),'click');
    area=document.querySelector('textarea');
    await type(area, 'discard me');
    await event(button('取消'),'click');
    assert.equal(document.querySelector('pre').textContent,'Revised();\nSecond();');
    await event(button('删除'),'click');
    assert.equal(document.querySelector(`[data-composer-chip="${SOURCE}"]`),null);
    assert.equal(current.draft,question+other);
    assert.deepEqual(current.attachmentIds,['image-1']);
    assert.equal(current.occurrences.length,1);
    assert.equal(persisted,2);
  } finally {
    await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis,previous);
  }
});

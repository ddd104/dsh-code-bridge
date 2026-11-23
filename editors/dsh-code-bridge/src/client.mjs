import React, {useEffect, useRef, useState} from 'react';
import {TYPERT_REMOTE} from './remote.mjs';
import {SOURCE, appendCapture, receiptStore, readAttachment, attachmentLabel, serializeAttachment, occurrenceSpan} from './delivery.mjs';
import {AttachmentPreview, useChipPreview, previewListeners} from './preview.mjs';
const h = React.createElement;
let tabClientId;
function clientIdentity() {
  if (tabClientId) return tabClientId;
  try {tabClientId = sessionStorage.getItem('dsh-code-bridge:client');} catch {}
  if (!tabClientId) {tabClientId = globalThis.crypto.randomUUID(); try {sessionStorage.setItem('dsh-code-bridge:client', tabClientId);} catch {}}
  return tabClientId;
}

/** Always-on receiver; native reference chips are the only persistent composer UI. */
export function CodeAttachments({sessionId, useSessions, useInput, inputActions, insertReference, poll, ack, release}) {
  const title = useSessions(state => state.byId[sessionId]?.title ?? '未命名对话');
  const projectPath = useSessions(state => state.byId[sessionId]?.cwd ?? '');
  const input = useInput(state => state);
  const live = useRef(); live.current = {title, projectPath, input, inputActions, insertReference};
  const anchor = useRef(null), activation = useRef(Date.now());
  const [preview, setPreview] = useState(null);
  const previewEvents = useChipPreview(anchor, live, sessionId, preview, setPreview);
  const selected = preview && input.occurrences?.find(item => item.source === SOURCE && item.occurrenceId === preview.occurrenceId);

  useEffect(() => {
    activation.current = Date.now(); setPreview(null);
    const focus = () => {activation.current = Date.now();};
    globalThis.window?.addEventListener('focus', focus);
    let active = true, timer, targetId;
    const clientId = clientIdentity();
    let storage; try {storage = sessionStorage;} catch {}
    const receipts = receiptStore(storage, sessionId, clientId);
    const run = async () => {
      try {
        const current = live.current;
        const result = await poll({clientId, label:String(current.title).slice(0, 300) || '未命名对话', projectPath:String(current.projectPath).slice(0, 4096), activatedAt:activation.current});
        targetId = result.targetId;
        if (!active) {await release({clientId, targetId}); return;}
        const request = result.request;
        if (request) {
          const alreadyAttached = live.current.input.occurrences?.some(item => item.source === SOURCE && readAttachment(item.ref).capture.id === request.id);
          if (receipts.has(request.id) || alreadyAttached) {
            live.current.inputActions.persistDraft(); receipts.add(request.id);
            await ack({clientId, id:request.id, state:'applied'});
          } else if (appendCapture(live.current.insertReference, live.current.input, request.capture)) {
            live.current.inputActions.persistDraft(); receipts.add(request.id);
            await ack({clientId, id:request.id, state:'applied'});
          }
        }
      } catch (error) {
        // The editor reports delivery failures; no permanent status strip in the composer.
        console.warn('[Ask for DSH]', error.message ?? String(error));
      } finally {if (active) timer = setTimeout(run, 700);}
    };
    void run();
    return () => {
      active = false; clearTimeout(timer);
      globalThis.window?.removeEventListener('focus', focus);
      if (targetId) void release({clientId, targetId}).catch(() => {});
    };
  }, [sessionId, poll, ack, release]);

  const change = reference => {
    const current = live.current;
    const span = occurrenceSpan(current.input, selected.occurrenceId);
    if (!span || current.input.phase !== 'plain') return false;
    const applied = reference ? current.insertReference(reference, span) : current.inputActions.insertText('', span);
    if (applied) {current.inputActions.persistDraft(); setPreview(null);}
    return applied;
  };
  return h('span', {ref:anchor, 'data-dsh-code-attachments':''}, selected && h('div', {
    ...previewEvents,
    style:{...preview.style, zIndex:100, overflow:'auto', border:'1px solid var(--dsw-alias-border-l2, #7775)', borderRadius:12,
      background:'var(--dsw-specific-input-major, #292929)', color:'var(--dsw-alias-label-primary, inherit)', boxShadow:'0 12px 40px #0003', fontSize:13, lineHeight:1.5, pointerEvents:'auto'}
  }, h(AttachmentPreview, {key:selected.ref, reference:selected.ref, busy:input.phase !== 'plain', onSave:change, onDelete:() => change(null), onClose:() => setPreview(null), onPin:() => setPreview(value => ({...value, pinned:true}))})));
}

export const inject = ['slots', 'sessions', 'remote', 'inputTriggers'];
export async function apply(ctx) {
  ctx.effect(() => ctx.inputTriggers.registerSource({name:SOURCE, trigger:'@', candidates:async () => [], onPick:() => undefined,
    codec:{clipboardText:ref => `[代码附件 ${attachmentLabel(readAttachment(ref))}]`, serialize:async ref => serializeAttachment(ref)},
    openReference:({sessionId}, {ref}) => {for (const listener of previewListeners) listener(sessionId, ref); return true;}
  }));
  await ctx.remote.$mount(TYPERT_REMOTE);
  ctx.inject(['remote.codeBridge'], child => {
    const using = (sessionId, method, request) => child.sessions.using(sessionId, {source:'codeBridge'}, async reference => {
      const snapshot = reference.binding.session.getSnapshot();
      if (snapshot.openState !== 'open') throw snapshot.openError ?? new Error('请先打开 DSH 对话');
      const result = await child.remote.codeBridge[method](sessionId, request);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    });
    child.slots.inject('conversation.input.overlay', () => child.slots.register({name:'conversation.input.overlay', id:'code-bridge', order:19,
      inject:sessionId => ({...Object.fromEntries(['poll','ack','release'].map(method => [method, request => using(sessionId, method, request)])),
        insertReference:(reference, span) => child.sessions.scope(sessionId)?.bail('slash/input-insert-reference', {reference, span}) === true
      })}, CodeAttachments));
  });
}

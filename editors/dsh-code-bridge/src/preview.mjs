import React, {useEffect, useRef, useState} from 'react';
import {SOURCE, readAttachment, attachmentTexts, attachmentLabel, editAttachment} from './delivery.mjs';
const h = React.createElement;
export const previewListeners = new Set();
const buttonStyle = {border:'1px solid var(--dsw-alias-border-l2, #7775)', borderRadius:6, padding:'3px 8px', background:'transparent', color:'inherit', cursor:'pointer', fontSize:12};

export function AttachmentPreview({reference, busy, onSave, onDelete, onClose, onPin}) {
  const [editing, setEditing] = useState(false);
  const [texts, setTexts] = useState(() => attachmentTexts(readAttachment(reference)));
  const [error, setError] = useState('');
  const attachment = readAttachment(reference), capture = attachment.capture;
  const save = () => {
    try {
      if (!onSave(editAttachment(reference, texts))) throw new Error('草稿已变化，请稍后重试。');
      setEditing(false); setError('');
    } catch (failure) {setError(failure.message.includes('草稿') ? failure.message : '代码附件最多支持 128 Ki 字符，请缩小内容。');}
  };
  return h('div', {role:'dialog', 'aria-label':'代码附件预览', style:{padding:14}, onKeyDown:event => {
    // Enter while editing a snippet must never send the conversation draft.
    event.stopPropagation();
    if (event.key === 'Escape') {event.preventDefault(); onClose();}
  }},
  h('div', {style:{display:'flex', alignItems:'center', gap:8, marginBottom:8}},
    h('strong', {style:{flex:1, fontSize:13}}, attachmentLabel(attachment)),
    !editing && h('button', {type:'button', style:buttonStyle, disabled:busy, onClick:() => {onPin(); setEditing(true);}}, '编辑'),
    h('button', {type:'button', style:buttonStyle, disabled:busy, onClick:onDelete}, '删除'),
    h('button', {type:'button', style:buttonStyle, 'aria-label':'关闭代码预览', onClick:onClose}, '×')),
  h('div', {style:{fontSize:11, opacity:.65, overflowWrap:'anywhere', marginBottom:10}}, capture.filePath,
    capture.dirty ? ' · 未保存的代码' : '', attachment.edits ? ' · 附件已编辑' : ''),
  capture.selections.map((selection, i) => h('div', {key:i, style:{marginBottom:8}},
    h('div', {style:{fontSize:11, opacity:.65, marginBottom:4}}, `原选区 ${selection.start.line}:${selection.start.column}–${selection.end.line}:${selection.end.column}`),
    editing ? h('textarea', {'aria-label':`编辑代码片段 ${i + 1}`, autoFocus:i === 0, value:texts[i], spellCheck:false, disabled:busy,
      onChange:event => setTexts(previous => previous.map((text, index) => index === i ? event.target.value : text)),
      style:{boxSizing:'border-box', width:'100%', minHeight:130, resize:'vertical', padding:8, fontFamily:'Consolas, monospace', fontSize:12, lineHeight:1.6, color:'inherit', background:'var(--dsw-alias-interactive-bg-hover, #8881)', border:'1px solid var(--dsw-alias-border-l2, #7775)', borderRadius:6}})
      : h('pre', {style:{margin:0, padding:10, maxHeight:240, overflow:'auto', whiteSpace:'pre', borderRadius:6, background:'var(--dsw-alias-interactive-bg-hover, #8881)', fontFamily:'Consolas, monospace', fontSize:12, lineHeight:1.6}}, texts[i]))),
  editing && h('div', {style:{display:'flex', gap:8, alignItems:'center'}},
    h('span', {style:{flex:1, fontSize:11, opacity:.65}}, '仅修改本次附件，不修改源文件'),
    h('button', {type:'button', style:buttonStyle, onClick:() => {setTexts(attachmentTexts(attachment)); setEditing(false); setError('');}}, '取消'),
    h('button', {type:'button', style:buttonStyle, disabled:busy, onClick:save}, '保存')),
  error && h('div', {role:'alert', style:{fontSize:12, color:'var(--dsw-alias-status-error, #d55)', marginTop:8}}, error));
}

/** Bind only this composer's native chip anchors. Draft mutations never touch DOM/Lexical internals. */
export function useChipPreview(anchor, live, sessionId, preview, setPreview) {
  const previewLive = useRef(), timer = useRef(); previewLive.current = preview;
  const keep = () => clearTimeout(timer.current);
  const closeLater = () => {keep(); timer.current = setTimeout(() => {if (!previewLive.current?.pinned) setPreview(null);}, 220);};
  useEffect(() => {
    const card = anchor.current?.closest('[data-composer-card]');
    if (!card) return;
    const chips = () => [...card.querySelectorAll(`[data-composer-chip="${SOURCE}"]`)];
    const show = (element, pinned = false) => {
      if (previewLive.current?.pinned && !pinned) return;
      const item = live.current.input.occurrences.filter(item => item.source === SOURCE)[chips().indexOf(element)];
      if (!item) return;
      keep();
      const rect = element.getBoundingClientRect(), width = Math.min(560, window.innerWidth - 24), above = rect.top > 220;
      setPreview({occurrenceId:item.occurrenceId, pinned, style:{position:'fixed', width, maxHeight:Math.max(160, Math.min(480, (above ? rect.top : window.innerHeight - rect.bottom) - 24)),
        left:Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), ...(above ? {bottom:window.innerHeight - rect.top + 8} : {top:rect.bottom + 8})}});
    };
    const over = event => {const chip = event.target.closest?.(`[data-composer-chip="${SOURCE}"]`); if (chip && card.contains(chip)) show(chip);};
    const key = event => {
      if (event.key === 'Escape') setPreview(null);
      if (event.key === 'Enter' || event.key === ' ') {
        const chip = event.target.closest?.(`[data-composer-chip="${SOURCE}"]`);
        if (chip) {event.preventDefault(); event.stopPropagation(); show(chip, true);}
      }
    };
    const open = (id, ref) => {
      if (id !== sessionId) return;
      const index = live.current.input.occurrences.filter(item => item.source === SOURCE).findIndex(item => item.ref === ref);
      const chip = chips()[index]; if (chip) show(chip, true);
    };
    previewListeners.add(open);
    card.addEventListener('mouseover', over); card.addEventListener('mouseout', closeLater);
    card.addEventListener('focusin', over); card.addEventListener('focusout', closeLater); card.addEventListener('keydown', key, true);
    return () => {
      keep(); previewListeners.delete(open);
      card.removeEventListener('mouseover', over); card.removeEventListener('mouseout', closeLater);
      card.removeEventListener('focusin', over); card.removeEventListener('focusout', closeLater); card.removeEventListener('keydown', key, true);
    };
  }, [sessionId]);
  useEffect(() => {
    const chips = anchor.current?.closest('[data-composer-card]')?.querySelectorAll(`[data-composer-chip="${SOURCE}"]`) ?? [];
    chips.forEach(chip => {chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.setAttribute('aria-label', `预览代码附件 ${chip.textContent}`); chip.style.cursor = 'pointer';});
  }, [live.current.input.draftRev]);
  return {onMouseEnter:keep, onMouseLeave:closeLater, onFocus:keep, onMouseDown:event => event.stopPropagation(),
    onMouseOver:event => {keep(); event.stopPropagation();}, onMouseOut:event => event.stopPropagation()};
}

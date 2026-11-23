import {z} from 'zod';
import {captureSchema, formatCapture, MAX_TEXT} from '../../shared/protocol.mjs';

export const SOURCE = 'dsh-code-attachment';
// Keep snapshots inside the native reference, so undo, draft restore, failed sends,
// and session switching all use DSH's own document lifecycle. No sidecar text store.
const attachmentSchema = z.object({version:z.literal(1), capture:captureSchema,
  edits:z.array(z.string().max(MAX_TEXT)).max(32).optional()
}).strict().refine(value => !value.edits || (value.edits.length === value.capture.selections.length && value.edits.reduce((n, text) => n + text.length, 0) <= MAX_TEXT));
export const readAttachment = ref => attachmentSchema.parse(JSON.parse(ref));
export const attachmentTexts = attachment => attachment.edits ?? attachment.capture.selections.map(item => item.text);
export function attachmentLabel({capture, edits}) {
  const name = capture.filePath.split(/[\\/]/).at(-1);
  const {start, end} = capture.selections[0];
  const last = end.column === 1 && end.line > start.line ? end.line - 1 : end.line;
  return `${name}:${start.line}${last !== start.line ? `–${last}` : ''}${capture.selections.length > 1 ? ` · ${capture.selections.length} 处` : ''}${edits ? ' · 已编辑' : ''}`;
}
export function attachmentReference(value) {
  const attachment = attachmentSchema.parse(value);
  const label = attachmentLabel(attachment);
  return {source:SOURCE, ref:JSON.stringify(attachment), label, appearance:'file', clipboardText:`[代码附件 ${label}]`};
}
export function serializeAttachment(ref) {
  const attachment = readAttachment(ref);
  const capture = attachment.edits ? {...attachment.capture, selections:attachment.capture.selections.map((item, i) => ({...item, text:attachment.edits[i]}))} : attachment.capture;
  return '\n\n' + formatCapture(capture, {edited:!!attachment.edits}) + '\n';
}
export function editAttachment(ref, texts) {
  const {capture} = readAttachment(ref);
  const unchanged = texts.every((text, i) => text === capture.selections[i]?.text);
  return attachmentReference({version:1, capture, ...(unchanged ? {} : {edits:texts})});
}
/** Each reference occupies one detect coordinate, even when its label is long. */
export function occurrenceSpan(input, occurrenceId) {
  let removed = 0;
  for (const occurrence of input.occurrences ?? []) {
    if (occurrence.occurrenceId === occurrenceId) return {start:occurrence.offset - removed, end:occurrence.offset - removed + 1, draftRev:input.draftRev};
    removed += occurrence.length - 1;
  }
}
export function appendCapture(insertReference, input, capture) {
  if (input.phase !== 'plain') return false;
  const end = input.draft.length - (input.occurrences ?? []).reduce((n, occurrence) => n + occurrence.length - 1, 0);
  return insertReference(attachmentReference({version:1, capture}), {start:end, end, draftRev:input.draftRev});
}

/** Receipts survive remounts in one browser tab and hold no source text. */
export function receiptStore(storage, sessionId, clientId) {
  const key = `dsh-code-bridge:receipts:${sessionId}:${clientId}`;
  let ids; try {ids = JSON.parse(storage?.getItem(key) ?? '[]');} catch {ids = [];}
  const seen = new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []);
  return {has:id => seen.has(id), add(id) {
    seen.add(id); while (seen.size > 256) seen.delete(seen.values().next().value);
    try {storage?.setItem(key, JSON.stringify([...seen]));} catch { /* Memory receipt still prevents live replay. */ }
  }};
}

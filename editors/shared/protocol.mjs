import {z} from 'zod';

export const VERSION = 1;
export const MAX_TEXT = 128 * 1024;
export const MAX_BODY = 512 * 1024;
export const uuid = z.string().uuid();
const path = z.string().min(1).max(4096).refine(value => /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(value) && !/[\r\n\0]/.test(value), 'An absolute local path is required');
const position = z.object({line:z.number().int().min(1).max(10000000), column:z.number().int().min(1).max(10000000)}).strict();
const range = z.object({start:position, end:position, text:z.string().min(1).max(MAX_TEXT)}).strict().superRefine((value, ctx) => {
  const {start, end, text} = value;
  const lines = text.split(/\r\n|\r|\n/);
  if (end.line !== start.line + lines.length - 1 || end.column !== (lines.length === 1 ? start.column : 1) + lines.at(-1).length)
    ctx.addIssue({code:'custom', message:'Range must describe the selected text using 1-based UTF-16 columns and an exclusive end'});
});
export const captureSchema = z.object({
  id:uuid, targetId:uuid, editor:z.enum(['vscode','rider','android-studio']), filePath:path,
  projectPath:path.nullable(), language:z.string().max(80), dirty:z.boolean(),
  documentVersion:z.string().max(80), capturedAt:z.string().datetime(),
  selections:z.array(range).min(1).max(32)
}).strict().refine(value => value.selections.reduce((n, selection) => n + selection.text.length, 0) <= MAX_TEXT, 'Selection exceeds 128 Ki UTF-16 units');

/** Use a fence longer than any source fence; metadata is encoded on single lines. */
export function formatCapture(capture, {edited = false} = {}) {
  const header = [
    '[ask for dsh — 编辑器代码选区]',
    `文件：${JSON.stringify(capture.filePath)}`,
    `工程：${JSON.stringify(capture.projectPath)}`,
    `来源：${{'rider':'Rider','vscode':'VS Code','android-studio':'Android Studio'}[capture.editor]}；${capture.dirty ? '包含未保存修改' : '已保存'}；文档版本：${JSON.stringify(capture.documentVersion)}`,
    `采集时间：${capture.capturedAt}`,
    '位置使用 1 起始行列；终点不包含在选区内。修改前请核对当前文件版本。',
    edited ? '用户已在 DSH 中编辑此代码附件，未修改源文件。下列行列仍指原始选区，代码内容为编辑后的附件，不保证与原选区长度一致。' : '以下为点击菜单时的代码快照。'
  ];
  for (const [index, selection] of capture.selections.entries()) {
    const {start, end, text} = selection;
    const runs = text.match(/`+/g) ?? [];
    const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
    const language = /^[a-z0-9_+-]+$/i.test(capture.language) ? capture.language : '';
    header.push(`片段 ${index + 1}：${start.line}:${start.column}–${end.line}:${end.column}`, `${fence}${language}\n${text}\n${fence}`);
  }
  return header.join('\n') + '\n';
}

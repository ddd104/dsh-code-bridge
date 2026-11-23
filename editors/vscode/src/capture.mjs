import {randomUUID} from 'node:crypto';
export function captureEditor(editor, projectPath) {
  if (!editor || editor.document.uri.scheme !== 'file') throw new Error('请在本机文件中选中代码后使用 ask for dsh。');
  const document = editor.document;
  const selections = editor.selections.filter(selection => !selection.isEmpty).map(selection => ({
    start:{line:selection.start.line + 1, column:selection.start.character + 1},
    end:{line:selection.end.line + 1, column:selection.end.character + 1}, text:document.getText(selection)
  }));
  if (!selections.length) throw new Error('请先选中要发送的代码。');
  if (selections.length > 32 || selections.reduce((sum, item) => sum + item.text.length, 0) > 128 * 1024) throw new Error('选中代码过大：最多 32 个选区、128 Ki 字符，请缩小范围。');
  return {id:randomUUID(), editor:'vscode', filePath:document.uri.fsPath, projectPath:projectPath ?? null,
    language:document.languageId, dirty:document.isDirty, documentVersion:String(document.version), capturedAt:new Date().toISOString(), selections};
}

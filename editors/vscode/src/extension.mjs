import * as vscode from 'vscode';
import {discoverTargets, currentTarget, sendCapture} from '../../shared/transport.mjs';
import {captureEditor} from './capture.mjs';

export function activate(context) {
  const output = vscode.window.createOutputChannel('Ask for DSH', {log:true});
  context.subscriptions.push(output);
  output.info('Ask for DSH activated');
  context.subscriptions.push(vscode.commands.registerCommand('askForDsh.send', async () => {
    output.info('ask for dsh invoked');
    try {
      const editor = vscode.window.activeTextEditor;
      const project = editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
      // Capture synchronously before awaiting discovery.
      const capture = captureEditor(editor, project);
      output.info(`Captured ${capture.selections.length} selection(s); unsaved=${capture.dirty}`);
      const target = currentTarget(await discoverTargets());
      const result = await vscode.window.withProgress({location:vscode.ProgressLocation.Notification, title:`添加代码到 DSH：${target.label}`, cancellable:false}, () => sendCapture(target, capture));
      output.info(`Delivery status: ${result.state}`);
      if (result.state === 'applied') vscode.window.showInformationMessage(`代码已加入 DSH「${target.label}」代码附件。可悬停预览、编辑后发送。`);
      else if (result.state === 'pending') vscode.window.showWarningMessage(result.reason ?? '代码已排队，尚未确认加入草稿。请保持目标 DSH 对话打开，避免重复添加。');
      else vscode.window.showErrorMessage(result.reason ?? '代码没有加入 DSH 草稿，请打开当前对话后重试。');
    } catch (error) {output.error(error.message ?? String(error)); vscode.window.showErrorMessage(error.message ?? String(error));}
  }));
}
export function deactivate() {}

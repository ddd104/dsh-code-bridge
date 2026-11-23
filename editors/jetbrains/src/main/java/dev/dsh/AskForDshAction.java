package dev.dsh;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.application.ApplicationInfo;
import com.intellij.openapi.editor.Caret;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.project.DumbAwareAction;
import com.intellij.openapi.util.TextRange;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;
import java.time.Instant;
import java.util.UUID;

public final class AskForDshAction extends DumbAwareAction {
  @Override public @NotNull ActionUpdateThread getActionUpdateThread() { return ActionUpdateThread.BGT; }
  @Override public void update(@NotNull AnActionEvent event) {
    Editor editor = event.getData(CommonDataKeys.EDITOR);
    VirtualFile file = event.getData(CommonDataKeys.VIRTUAL_FILE);
    event.getPresentation().setEnabledAndVisible(event.getProject() != null && editor != null && file != null
      && file.isInLocalFileSystem() && editor.getCaretModel().getAllCarets().stream().anyMatch(Caret::hasSelection));
  }
  @Override public void actionPerformed(@NotNull AnActionEvent event) {
    Editor editor = event.getData(CommonDataKeys.EDITOR);
    VirtualFile file = event.getData(CommonDataKeys.VIRTUAL_FILE);
    var project = event.getProject();
    if (project == null || editor == null || file == null || !file.isInLocalFileSystem()) return;
    // Snapshot on the UI thread before the background connection.
    Document document = editor.getDocument();
    JsonArray selections = new JsonArray();
    int size = 0;
    for (Caret caret : editor.getCaretModel().getAllCarets()) {
      if (!caret.hasSelection()) continue;
      int start = caret.getSelectionStart(), end = caret.getSelectionEnd();
      String text = document.getText(new TextRange(start, end)); size += text.length();
      JsonObject selection = new JsonObject();
      selection.add("start", position(document, start)); selection.add("end", position(document, end));
      selection.addProperty("text", text); selections.add(selection);
    }
    if (selections.isEmpty()) return;
    if (selections.size() > 32 || size > 128 * 1024) {BridgeClient.notice(project, "选中代码过大：最多 32 个选区、128 Ki 字符，请缩小范围。", true); return;}
    JsonObject capture = new JsonObject();
    capture.addProperty("id", UUID.randomUUID().toString());
    capture.addProperty("editor", "AI".equals(ApplicationInfo.getInstance().getBuild().getProductCode()) ? "android-studio" : "rider");
    capture.addProperty("filePath", file.getPath()); capture.addProperty("projectPath", project.getBasePath());
    String extension = file.getExtension();
    capture.addProperty("language", extension == null ? "" : switch (extension.toLowerCase(java.util.Locale.ROOT)) {
      case "kt", "kts" -> "kotlin";
      case "gradle" -> "groovy";
      default -> extension;
    });
    capture.addProperty("dirty", FileDocumentManager.getInstance().isDocumentUnsaved(document));
    capture.addProperty("documentVersion", Long.toString(document.getModificationStamp()));
    capture.addProperty("capturedAt", Instant.now().toString()); capture.add("selections", selections);
    BridgeClient.sendCurrent(project, capture);
  }
  private static JsonObject position(Document document, int offset) {
    int line = document.getLineNumber(offset);
    JsonObject result = new JsonObject(); result.addProperty("line", line + 1);
    result.addProperty("column", offset - document.getLineStartOffset(line) + 1); return result;
  }
}

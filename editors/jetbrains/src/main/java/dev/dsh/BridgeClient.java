package dev.dsh;

import com.google.gson.*;
import com.intellij.notification.*;
import com.intellij.openapi.progress.*;
import com.intellij.openapi.project.Project;
import org.jetbrains.annotations.NotNull;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CompletableFuture;

/** Shared local transport for Rider and Android Studio. */
public final class BridgeClient {
  private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
    .followRedirects(HttpClient.Redirect.NEVER).proxy(new ProxySelector() {
      @Override public List<Proxy> select(URI uri) {return List.of(Proxy.NO_PROXY);}
      @Override public void connectFailed(URI uri, SocketAddress address, java.io.IOException failure) {}
    }).build();
  private record Target(JsonObject endpoint, JsonObject info) {
    String id() {return info.get("id").getAsString();}
    double activatedAt() {return info.has("activatedAt") ? info.get("activatedAt").getAsDouble() : 0;}
    String label() {return info.get("label").getAsString();}
    @Override public String toString() {return label() + " — " + info.get("projectPath").getAsString() + " [" + id().substring(0, 8) + "]";}
  }
  public static void notice(Project project, String text, boolean error) {
    if (project.isDisposed()) return;
    NotificationGroupManager.getInstance().getNotificationGroup("Ask for DSH")
      .createNotification("Ask for DSH", text, error ? NotificationType.WARNING : NotificationType.INFORMATION).notify(project);
  }
  private static JsonObject request(JsonObject endpoint, String path, JsonObject body) throws Exception {
    int port = endpoint.get("port").getAsInt(); String token = endpoint.get("token").getAsString();
    if (port < 1 || port > 65535 || !token.matches("[a-f0-9]{64}")) throw new Exception("Invalid local DSH endpoint");
    var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofMillis(3500))
      .header("Authorization", "Bearer " + token).header("Content-Type", "application/json");
    if (body == null) builder.GET(); else builder.POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8));
    var response = HTTP.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    JsonObject result = JsonParser.parseString(response.body()).getAsJsonObject();
    if (response.statusCode() >= 300) throw new Exception(result.has("error") ? result.get("error").getAsString() : "DSH HTTP " + response.statusCode());
    return result;
  }
  private static List<Target> discover() throws Exception {
    String local = System.getenv("LOCALAPPDATA");
    Path directory = System.getProperty("os.name").startsWith("Windows") && local != null
      ? Path.of(local, "DSHCodeBridge", "instances") : Path.of(System.getProperty("user.home"), ".dsh-code-bridge", "instances");
    if (!Files.isDirectory(directory)) return List.of();
    List<Path> files;
    try (var stream = Files.list(directory)) {files = stream.filter(p -> p.getFileName().toString().matches("[a-f0-9-]{36}\\.json")).limit(64).toList();}
    List<CompletableFuture<List<Target>>> futures = files.stream().map(file -> CompletableFuture.supplyAsync(() -> {
      try {
        if (Files.size(file) > 4096) return List.<Target>of();
        JsonObject endpoint = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
        if (endpoint.get("version").getAsInt() != 1 || !(endpoint.get("instanceId").getAsString() + ".json").equals(file.getFileName().toString())) return List.<Target>of();
        JsonObject result = request(endpoint, "/v1/targets", null);
        if (result.get("version").getAsInt() != 1 || !result.get("instanceId").equals(endpoint.get("instanceId"))) return List.<Target>of();
        List<Target> found = new ArrayList<>();
        for (JsonElement value : result.getAsJsonArray("targets")) found.add(new Target(endpoint, value.getAsJsonObject()));
        return found;
      } catch (Exception ignored) {return List.<Target>of();}
    })).toList();
    List<Target> targets = new ArrayList<>(); for (var future : futures) targets.addAll(future.get()); return targets;
  }
  public static void sendCurrent(Project project, JsonObject capture) {
    new Task.Backgroundable(project, "连接当前 DSH 对话", false) {
      @Override public void run(@NotNull ProgressIndicator indicator) {
        try {
          List<Target> targets = discover();
          if (project.isDisposed()) return;
          if (targets.isEmpty()) throw new Exception("请先在 DSH 中打开一个对话，并确认 dsh-code-bridge 插件已启用。");
          targets.sort(Comparator.comparingDouble(Target::activatedAt).reversed().thenComparing(Target::id));
          send(project, targets.getFirst(), capture);
        } catch (Exception error) {notice(project, error.getMessage(), true);}
      }
    }.queue();
  }
  private static void send(Project project, Target target, JsonObject capture) {
    if (capture == null || project.isDisposed()) return;
    new Task.Backgroundable(project, "添加代码到 DSH：" + target.label(), false) {
      @Override public void run(@NotNull ProgressIndicator indicator) {
        try {
          capture.addProperty("targetId", target.id()); JsonObject status;
          String statusPath = "/v1/captures/" + capture.get("id").getAsString();
          try {status = request(target.endpoint(), "/v1/captures", capture);}
          catch (Exception first) {try {status = request(target.endpoint(), statusPath, null);} catch (Exception ignored) {throw first;}}
          long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
          while (status.get("state").getAsString().equals("pending") && System.nanoTime() < deadline) {
            Thread.sleep(500);
            try {status = request(target.endpoint(), statusPath, null);}
            catch (Exception error) {notice(project, "已提交，暂时无法确认是否加入草稿；请检查目标 DSH 对话，避免重复添加。", true); return;}
          }
          String state = status.get("state").getAsString();
          if (state.equals("applied")) notice(project, "代码已加入 DSH「" + target.label() + "」代码附件。可悬停预览、编辑后发送。", false);
          else notice(project, status.has("reason") ? status.get("reason").getAsString() : "代码已排队，尚未确认加入草稿。请保持目标 DSH 对话打开，避免重复添加。", true);
        } catch (Exception error) {notice(project, error.getMessage(), true);}
      }
    }.queue();
  }
}

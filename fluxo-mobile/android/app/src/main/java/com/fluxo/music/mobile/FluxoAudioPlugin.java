package com.fluxo.music.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FluxoAudio", permissions = {
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
@androidx.media3.common.util.UnstableApi
public class FluxoAudioPlugin extends Plugin {
    static volatile boolean visible = true;
    static final ExecutorService IO = Executors.newFixedThreadPool(3);
    private static WeakReference<FluxoAudioPlugin> current = new WeakReference<>(null);
    private final Handler main = new Handler(Looper.getMainLooper());
    private LibraryStore library;
    @Override public void load() {
        current = new WeakReference<>(this);
        library = LibraryStore.get(getContext());
        getContext().startService(new Intent(getContext(), PlaybackService.class));
    }
    static void emit(String event, JSONObject value) {
        FluxoAudioPlugin plugin = current.get();
        if (plugin != null) plugin.main.post(() -> {
            try { plugin.notifyListeners(event, JSObject.fromJSONObject(value)); }
            catch (Exception e) { android.util.Log.w("FluxoAudio", "State event failed", e); }
        });
    }
    private interface Task { void run() throws Exception; }
    private void async(PluginCall call, Task task) {
        IO.execute(() -> { try { task.run(); } catch (Exception e) { call.reject(StreamResolver.readable(e), e); } });
    }
    private void player(PluginCall call, Task task) {
        main.post(() -> {
            if (PlaybackService.instance == null) { call.reject("O player ainda esta iniciando. Tente novamente."); return; }
            try { task.run(); call.resolve(JSObject.fromJSONObject(PlaybackService.instance.state())); }
            catch (Exception e) { call.reject(StreamResolver.readable(e), e); }
        });
    }
    @PluginMethod public void getState(PluginCall call) { player(call, () -> {}); }
    @PluginMethod public void radio(PluginCall call) {
        player(call, () -> PlaybackService.instance.startRadio(call.getObject("track"), call.getBoolean("offline", false)));
    }
    @PluginMethod public void setQueue(PluginCall call) {
        player(call, () -> PlaybackService.instance.setQueue(call.getArray("tracks", new JSArray()), call.getInt("index", 0), true));
    }
    @PluginMethod public void append(PluginCall call) {
        player(call, () -> {
            PlaybackService service = PlaybackService.instance;
            int index = call.getBoolean("next", false) ? service.player.getCurrentMediaItemIndex() + 1 : service.player.getMediaItemCount();
            service.player.addMediaItem(index, PlaybackService.item(call.getObject("track")));
            service.persist();
        });
    }
    @PluginMethod public void command(PluginCall call) {
        player(call, () -> PlaybackService.instance.command(call.getString("action", ""), call.getDouble("value", 0.0), call.getInt("index", 0)));
    }
    @PluginMethod public void search(PluginCall call) {
        async(call, () -> call.resolve(new JSObject().put("tracks", StreamResolver.search(call.getString("query", ""), call.getString("provider", "youtube")))));
    }
    @PluginMethod public void downloads(PluginCall call) {
        async(call, () -> {
            JSONArray tracks = library.list(); JSONArray pending = LibrarySync.pending(getContext());
            for (int i = 0; i < pending.length(); i++) {
                JSONObject candidate = pending.getJSONObject(i); boolean found = false;
                for (int j = 0; j < tracks.length(); j++) if (tracks.getJSONObject(j).optString("id").equals(candidate.optString("id"))) { found = true; break; }
                if (!found) tracks.put(candidate);
            }
            call.resolve(new JSObject().put("tracks", tracks));
        });
    }
    @PluginMethod public void syncLibrary(PluginCall call) {
        async(call, () -> {
            LibrarySync.sync(getContext(), call.getArray("tracks", new JSArray()), call.getBoolean("enabled", true), call.getBoolean("wifiOnly", false), call.getBoolean("retry", false));
            call.resolve();
        });
    }
    @PluginMethod public void download(PluginCall call) {
        async(call, () -> {
            JSONObject track = call.getObject("track");
            JSONArray records = library.list();
            for (int i = 0; i < records.length(); i++) {
                JSONObject existing = records.getJSONObject(i);
                if (existing.optString("id").equals(track.optString("id")) && !existing.optString("status").equals("failed")) {
                    call.resolve(JSObject.fromJSONObject(existing)); return;
                }
            }
            LibrarySync.unblock(getContext(), track.optString("id"));
            String url = StreamResolver.resolve(track.optString("url"));
            call.resolve(JSObject.fromJSONObject(library.download(track, url, call.getBoolean("wifiOnly", false))));
        });
    }
    @PluginMethod public void removeDownload(PluginCall call) {
        async(call, () -> { String id = call.getString("id", ""); LibrarySync.block(getContext(), id); library.remove(id); call.resolve(); });
    }
    @PluginMethod public void migrateAudio(PluginCall call) {
        async(call, () -> {
            library.migrate(call.getObject("track"), call.getLong("offset", 0L),
                android.util.Base64.decode(call.getString("data", ""), android.util.Base64.DEFAULT), call.getBoolean("complete", false));
            call.resolve();
        });
    }
    @PluginMethod public void notifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) requestPermissionForAlias("notifications", call, "notificationResult");
        else call.resolve(new JSObject().put("granted", true));
    }
    @PermissionCallback private void notificationResult(PluginCall call) {
        call.resolve(new JSObject().put("granted", getPermissionState("notifications").toString().equals("granted")));
    }
    @PluginMethod public void importAudio(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*")
            .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "audioPicked");
    }
    @PluginMethod public void diagnostics(PluginCall call) {
        var power = (android.os.PowerManager)getContext().getSystemService(android.content.Context.POWER_SERVICE);
        call.resolve(new JSObject().put("notifications", androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled())
            .put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(getContext().getPackageName()))
            .put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("android", Build.VERSION.RELEASE)
            .put("foreground", PlaybackService.instance != null && PlaybackService.instance.isPlaybackOngoing()));
    }
    @PluginMethod public void openSettings(PluginCall call) {
        String page = call.getString("page", "app");
        Intent intent = page.equals("notifications") ? new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            : page.equals("battery") ? new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            : new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        try { getActivity().startActivity(intent); call.resolve(); }
        catch (Exception failure) { call.reject("Nao foi possivel abrir os ajustes do dispositivo."); }
    }
    @ActivityCallback private void audioPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("tracks", new JSArray())); return; }
        Intent data = result.getData();
        async(call, () -> {
            JSONArray imported = new JSONArray();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) imported.put(library.importAudio(data.getClipData().getItemAt(i).getUri()));
            } else if (data.getData() != null) imported.put(library.importAudio(data.getData()));
            call.resolve(new JSObject().put("tracks", imported));
        });
    }
    @PluginMethod public void exportBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json")
            .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, "fluxo-backup.json");
        startActivityForResult(call, intent, "backupDestination");
    }
    @ActivityCallback private void backupDestination(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        async(call, () -> {
            try (var output = getContext().getContentResolver().openOutputStream(result.getData().getData())) {
                if (output == null) throw new java.io.IOException("Destino indisponivel.");
                output.write(call.getString("data", "{}").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            call.resolve();
        });
    }
    @PluginMethod public void importBackup(PluginCall call) {
        startActivityForResult(call, new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE), "backupPicked");
    }
    @ActivityCallback private void backupPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        async(call, () -> {
            try (var input = getContext().getContentResolver().openInputStream(result.getData().getData())) {
                if (input == null) throw new java.io.IOException("Arquivo indisponivel.");
                byte[] bytes = input.readNBytes(5 * 1024 * 1024 + 1);
                if (bytes.length > 5 * 1024 * 1024) throw new java.io.IOException("Backup maior que 5 MB.");
                call.resolve(new JSObject().put("data", new String(bytes, java.nio.charset.StandardCharsets.UTF_8)));
            }
        });
    }
    @Override protected void handleOnDestroy() {
        if (current.get() == this) current.clear();
        super.handleOnDestroy();
    }
    @Override protected void handleOnPause() { visible = false; super.handleOnPause(); }
    @Override protected void handleOnResume() { visible = true; super.handleOnResume(); }
}

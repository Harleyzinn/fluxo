package com.fluxo.music.mobile;

import android.content.Context;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

public final class LibrarySync {
    private static final String TAG = "fluxo_library_downloads";
    private static String name(String id) { return TAG + UUID.nameUUIDFromBytes(id.getBytes(StandardCharsets.UTF_8)); }
    private static android.content.SharedPreferences prefs(Context context) { return context.getSharedPreferences("library_sync", 0); }

    static synchronized JSONObject target(Context context, String id) throws Exception {
        if (id == null || prefs(context).getBoolean("blocked_" + id, false)) return null;
        JSONArray manual = new JSONArray(prefs(context).getString("manual", "[]"));
        for (int i = 0; i < manual.length(); i++) if (manual.getJSONObject(i).optString("id").equals(id)) return manual.getJSONObject(i);
        JSONArray tracks = new JSONArray(prefs(context).getString("targets", "[]"));
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.getJSONObject(i);
            if (track.optString("id").equals(id) && (prefs(context).getBoolean("enabled", true) || track.optBoolean("_autoDownload", false))) return track;
        }
        return null;
    }

    static synchronized void queueManual(Context context, JSONArray tracks, boolean wifiOnly) throws Exception {
        if (tracks.length() > 5000) throw new IllegalArgumentException("Selecione ate 5000 musicas por vez.");
        var preferences = prefs(context);
        JSONArray records = LibraryStore.get(context).list();
        java.util.Set<String> ready = new java.util.HashSet<>();
        java.util.Set<String> readyUrls = new java.util.HashSet<>();
        for (int i = 0; i < records.length(); i++) if (records.getJSONObject(i).optString("status").equals("ready")) { ready.add(records.getJSONObject(i).optString("id")); if (!records.getJSONObject(i).optString("url").isEmpty()) readyUrls.add(records.getJSONObject(i).optString("url")); }
        JSONArray manual = new JSONArray(preferences.getString("manual", "[]"));
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.getJSONObject(i);
            String id = track.optString("id");
            if (id.isEmpty() || id.length() > 500 || !track.optString("url").startsWith("https://")) continue;
            if (ready.contains(id) || readyUrls.contains(track.optString("url"))) continue;
            JSONArray kept = new JSONArray();
            for (int j = 0; j < manual.length(); j++) if (!manual.getJSONObject(j).optString("id").equals(id)) kept.put(manual.getJSONObject(j));
            manual = kept.put(new JSONObject(track.toString()).put("_wifiOnly", wifiOnly));
            preferences.edit().remove("blocked_" + id).remove("retries_" + id).commit();
        }
        preferences.edit().putString("manual", manual.toString()).commit();
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = target(context, tracks.getJSONObject(i).optString("id"));
            if (track != null) schedule(context, track, true, false, records);
        }
    }

    private static void schedule(Context context, JSONObject track, boolean retry, boolean changedNetwork, JSONArray records) throws Exception {
        String id = track.optString("id");
        if (!track.optString("url").startsWith("https://")) return;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (!sameTrack(record, track)) continue;
            if (!record.optString("status").equals("failed")) {
                status(context, id, "done", "");
                if (record.optString("status").equals("ready")) forgetManual(context, id);
                return;
            }
            if (prefs(context).getInt("retries_" + id, 0) >= 2 && !retry) return;
        }
        String pendingState = "";
        JSONArray pending = pending(context);
        for (int i = 0; i < pending.length(); i++) if (pending.getJSONObject(i).optString("id").equals(id)) pendingState = pending.getJSONObject(i).optString("status");
        if (pendingState.equals("failed") && !retry) return;
        boolean wifiOnly = track.optBoolean("_wifiOnly", wifiOnly(context));
        if (pendingState.isEmpty() || retry || changedNetwork) status(context, id, "queued", wifiOnly ? "Aguardando Wi-Fi" : "Download agendado");
        var request = new OneTimeWorkRequest.Builder(LibraryDownloadWorker.class).addTag(TAG)
            .setInputData(new Data.Builder().putString("id", id).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(wifiOnly ? NetworkType.UNMETERED : NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).build();
        WorkManager.getInstance(context).enqueueUniqueWork(name(id), changedNetwork || retry ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP, request);
    }

    static synchronized void status(Context context, String id, String status, String message) throws Exception {
        JSONArray rows = new JSONArray(prefs(context).getString("pending", "[]"));
        JSONArray updated = new JSONArray();
        for (int i = 0; i < rows.length(); i++) if (!rows.getJSONObject(i).optString("id").equals(id)) updated.put(rows.getJSONObject(i));
        JSONObject track = target(context, id);
        if (track != null && !status.equals("done")) updated.put(new JSONObject(track.toString()).put("status", status).put("statusDetail", message));
        prefs(context).edit().putString("pending", updated.toString()).commit();
    }

    static synchronized void sync(Context context, JSONArray tracks, boolean enabled, boolean wifiOnly, boolean retry) throws Exception {
        var preferences = prefs(context);
        JSONArray old = new JSONArray(preferences.getString("targets", "[]"));
        boolean changedNetwork = preferences.getBoolean("wifiOnly", false) != wifiOnly;
        preferences.edit().putString("targets", tracks.toString()).putBoolean("enabled", enabled).putBoolean("wifiOnly", wifiOnly).commit();
        var work = WorkManager.getInstance(context);
        JSONArray records = LibraryStore.get(context).list();
        for (int i = 0; i < old.length(); i++) {
            String id = old.getJSONObject(i).optString("id");
            if (target(context, id) == null) { work.cancelUniqueWork(name(id)); status(context, id, "done", ""); }
        }
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.getJSONObject(i); String id = track.optString("id");
            boolean automatic = enabled || track.optBoolean("_autoDownload", false);
            if (retry && automatic) preferences.edit().remove("blocked_" + id).remove("retries_" + id).commit();
            JSONObject desired = target(context, id);
            if (desired != null) schedule(context, desired, retry && automatic, changedNetwork, records);
        }
        JSONArray manual = new JSONArray(preferences.getString("manual", "[]"));
        if (changedNetwork) {
            for (int i = 0; i < manual.length(); i++) manual.getJSONObject(i).put("_wifiOnly", wifiOnly);
            preferences.edit().putString("manual", manual.toString()).commit();
        }
        for (int i = 0; i < manual.length(); i++) {
            JSONObject desired = target(context, manual.getJSONObject(i).optString("id"));
            if (desired != null) schedule(context, desired, false, changedNetwork, records);
        }
    }

    static synchronized void block(Context context, String id) throws Exception {
        prefs(context).edit().putBoolean("blocked_" + id, true).commit();
        WorkManager.getInstance(context).cancelUniqueWork(name(id)); status(context, id, "done", "");
        forgetManual(context, id);
    }
    static boolean sameTrack(JSONObject a, JSONObject b) {
        return !a.optString("id").isEmpty() && a.optString("id").equals(b.optString("id")) || !a.optString("url").isEmpty() && a.optString("url").equals(b.optString("url"));
    }
    static synchronized void blockEquivalent(Context context, String id, String url) throws Exception {
        java.util.Set<String> ids = new java.util.HashSet<>(); ids.add(id);
        JSONObject track = new JSONObject().put("id", id).put("url", url);
        for (String key : new String[]{"targets", "manual", "pending"}) {
            JSONArray rows = new JSONArray(prefs(context).getString(key, "[]"));
            for (int i = 0; i < rows.length(); i++) if (sameTrack(rows.getJSONObject(i), track)) ids.add(rows.getJSONObject(i).optString("id"));
        }
        for (String alias : ids) block(context, alias);
    }
    static synchronized void updateMetadata(Context context, JSONObject track, String title, String artist) throws Exception {
        for (String key : new String[]{"targets", "manual", "pending"}) {
            JSONArray rows = new JSONArray(prefs(context).getString(key, "[]"));
            for (int i = 0; i < rows.length(); i++) if (sameTrack(rows.getJSONObject(i), track)) rows.getJSONObject(i).put("title", title).put("artist", artist);
            prefs(context).edit().putString(key, rows.toString()).commit();
        }
    }
    private static void forgetManual(Context context, String id) throws Exception {
        JSONArray manual = new JSONArray(prefs(context).getString("manual", "[]"));
        JSONArray kept = new JSONArray();
        for (int i = 0; i < manual.length(); i++) if (!manual.getJSONObject(i).optString("id").equals(id)) kept.put(manual.getJSONObject(i));
        if (manual.length() != kept.length()) prefs(context).edit().putString("manual", kept.toString()).commit();
    }
    static synchronized void unblock(Context context, String id) { prefs(context).edit().remove("blocked_" + id).commit(); }
    static synchronized void completed(Context context, long downloadId) throws Exception {
        JSONArray records = LibraryStore.get(context).list();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            String id = record.optString("id");
            if (record.optLong("downloadId", -1) != downloadId || target(context, id) == null) continue;
            if (record.optString("status").equals("ready")) { prefs(context).edit().remove("retries_" + id).commit(); status(context, id, "done", ""); forgetManual(context, id); return; }
            if (!record.optString("status").equals("failed")) return;
            int retries = prefs(context).getInt("retries_" + id, 0);
            if (retries >= 2) { status(context, id, "failed", "Falha no download. Tente novamente."); return; }
            prefs(context).edit().putInt("retries_" + id, retries + 1).commit();
            StreamResolver.invalidate(record.optString("url"));
            var request = new OneTimeWorkRequest.Builder(LibraryDownloadWorker.class).addTag(TAG)
                .setInputData(new Data.Builder().putString("id", id).build()).setInitialDelay(15, TimeUnit.SECONDS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(target(context, id).optBoolean("_wifiOnly", wifiOnly(context)) ? NetworkType.UNMETERED : NetworkType.CONNECTED).build()).build();
            WorkManager.getInstance(context).enqueueUniqueWork(name(id), ExistingWorkPolicy.APPEND_OR_REPLACE, request);
            return;
        }
    }
    static synchronized JSONArray pending(Context context) throws Exception { return new JSONArray(prefs(context).getString("pending", "[]")); }
    static boolean wifiOnly(Context context) { return prefs(context).getBoolean("wifiOnly", false); }
}

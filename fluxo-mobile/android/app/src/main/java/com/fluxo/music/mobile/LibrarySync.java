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
        if (!prefs(context).getBoolean("enabled", true) || prefs(context).getBoolean("blocked_" + id, false)) return null;
        JSONArray tracks = new JSONArray(prefs(context).getString("targets", "[]"));
        for (int i = 0; i < tracks.length(); i++) if (tracks.getJSONObject(i).optString("id").equals(id)) return tracks.getJSONObject(i);
        return null;
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
        for (int i = 0; i < old.length(); i++) {
            String id = old.getJSONObject(i).optString("id");
            if (target(context, id) == null) { work.cancelUniqueWork(name(id)); status(context, id, "done", ""); }
        }
        if (!enabled) { work.cancelAllWorkByTag(TAG); preferences.edit().putString("pending", "[]").commit(); return; }
        JSONArray records = LibraryStore.get(context).list();
        for (int i = 0; i < tracks.length(); i++) {
            JSONObject track = tracks.getJSONObject(i); String id = track.optString("id");
            if (retry) preferences.edit().remove("blocked_" + id).remove("retries_" + id).commit();
            if (target(context, id) == null || !track.optString("url").startsWith("https://")) continue;
            JSONObject existing = null;
            for (int j = 0; j < records.length(); j++) if (records.getJSONObject(j).optString("id").equals(id)) { existing = records.getJSONObject(j); break; }
            if (existing != null && !existing.optString("status").equals("failed")) { status(context, id, "done", ""); continue; }
            String pendingState = "";
            JSONArray pending = new JSONArray(preferences.getString("pending", "[]"));
            for (int j = 0; j < pending.length(); j++) if (pending.getJSONObject(j).optString("id").equals(id)) pendingState = pending.getJSONObject(j).optString("status");
            if (pendingState.equals("failed") && !retry) continue;
            if (pendingState.isEmpty() || retry || changedNetwork) status(context, id, "queued", wifiOnly ? "Aguardando Wi-Fi" : "Download agendado");
            var request = new OneTimeWorkRequest.Builder(LibraryDownloadWorker.class).addTag(TAG)
                .setInputData(new Data.Builder().putString("id", id).build())
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(wifiOnly ? NetworkType.UNMETERED : NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).build();
            work.enqueueUniqueWork(name(id), changedNetwork || retry ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP, request);
        }
    }

    static synchronized void block(Context context, String id) throws Exception {
        prefs(context).edit().putBoolean("blocked_" + id, true).commit();
        WorkManager.getInstance(context).cancelUniqueWork(name(id)); status(context, id, "done", "");
    }
    static synchronized void unblock(Context context, String id) { prefs(context).edit().remove("blocked_" + id).commit(); }
    static synchronized void completed(Context context, long downloadId) throws Exception {
        JSONArray records = LibraryStore.get(context).list();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            String id = record.optString("id");
            if (record.optLong("downloadId", -1) != downloadId || target(context, id) == null) continue;
            if (record.optString("status").equals("ready")) { prefs(context).edit().remove("retries_" + id).commit(); return; }
            if (!record.optString("status").equals("failed")) return;
            int retries = prefs(context).getInt("retries_" + id, 0);
            if (retries >= 2) return;
            prefs(context).edit().putInt("retries_" + id, retries + 1).commit();
            StreamResolver.invalidate(record.optString("url"));
            var request = new OneTimeWorkRequest.Builder(LibraryDownloadWorker.class).addTag(TAG)
                .setInputData(new Data.Builder().putString("id", id).build()).setInitialDelay(15, TimeUnit.SECONDS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(wifiOnly(context) ? NetworkType.UNMETERED : NetworkType.CONNECTED).build()).build();
            WorkManager.getInstance(context).enqueueUniqueWork(name(id), ExistingWorkPolicy.APPEND_OR_REPLACE, request);
            return;
        }
    }
    static synchronized JSONArray pending(Context context) throws Exception { return new JSONArray(prefs(context).getString("pending", "[]")); }
    static boolean wifiOnly(Context context) { return prefs(context).getBoolean("wifiOnly", false); }
}

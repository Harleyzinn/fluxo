package com.fluxo.music.mobile;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.util.Set;

final class AudioDiagnostics {
    private static final ArrayDeque<JSONObject> events = new ArrayDeque<>();
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static final Set<String> fields = Set.of("reason", "result", "token", "state", "playing", "playWhenReady", "count", "milliseconds", "change", "requests", "releases");
    private static Context context;
    private static boolean enabled, scheduled;
    static synchronized void init(Context value) {
        if (context != null) return;
        context = value.getApplicationContext(); enabled = context.getSharedPreferences("audio_diagnostics", 0).getBoolean("enabled", false);
        try { JSONArray saved = new JSONArray(context.getSharedPreferences("audio_diagnostics", 0).getString("events", "[]"));
            for (int i = Math.max(0, saved.length() - 250); i < saved.length(); i++) events.add(saved.getJSONObject(i));
        } catch (Exception ignored) {}
    }
    static synchronized void enable(Context value, boolean active) {
        init(value); enabled = active; context.getSharedPreferences("audio_diagnostics", 0).edit().putBoolean("enabled", active).apply();
        if (active) record("diagnostics", "enabled"); else flush();
    }
    static synchronized boolean enabled() { return enabled; }
    static synchronized void record(String component, String event, Object... values) {
        if (!enabled || context == null) return;
        try { JSONObject row = new JSONObject().put("time", System.currentTimeMillis()).put("elapsed", android.os.SystemClock.elapsedRealtime()).put("component", component).put("event", event);
            for (int i = 0; i + 1 < values.length; i += 2) if (fields.contains(String.valueOf(values[i])) && (values[i + 1] instanceof Number || values[i + 1] instanceof Boolean)) row.put(String.valueOf(values[i]), values[i + 1]);
            events.add(row); while (events.size() > 250) events.removeFirst();
            if (!scheduled) { scheduled = true; handler.postDelayed(AudioDiagnostics::flush, 2000); }
        } catch (Exception ignored) {}
    }
    private static synchronized void flush() {
        scheduled = false; if (context == null) return;
        context.getSharedPreferences("audio_diagnostics", 0).edit().putString("events", new JSONArray(events).toString()).apply();
    }
    static synchronized JSONObject export() throws Exception {
        return new JSONObject().put("format", "fluxo-audio-diagnostics").put("version", 1).put("appVersion", context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName)
            .put("androidApi", android.os.Build.VERSION.SDK_INT).put("enabled", enabled).put("events", new JSONArray(events));
    }
    static synchronized void clear() { events.clear(); flush(); }
}

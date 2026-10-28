package com.fluxo.music.mobile;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

final class PlaybackSnapshot {
    static JSONObject read(Context context) throws Exception {
        var prefs = context.getSharedPreferences("player", 0); JSONArray queue;
        try { queue = new JSONArray(prefs.getString("queue", "[]")); } catch (Exception ignored) { queue = new JSONArray(); }
        int index = Math.max(0, Math.min(prefs.getInt("index", 0), Math.max(0, queue.length() - 1)));
        JSONObject track = queue.optJSONObject(index);
        return new JSONObject().put("queue", queue).put("index", index).put("position", Math.max(0, prefs.getLong("position", 0)) / 1000.0)
            .put("duration", track == null ? 0 : track.optDouble("duration", 0)).put("buffered", 0).put("playing", false).put("playWhenReady", false).put("buffering", false)
            .put("repeat", prefs.getInt("repeat", 0)).put("shuffle", prefs.getBoolean("shuffle", false)).put("speed", prefs.getFloat("speed", 1)).put("volume", prefs.getFloat("volume", 1))
            .put("error", "").put("sleepAt", 0).put("sleepEnd", false).put("radio", false).put("radioLoading", false).put("radioError", "").put("radioOffline", false)
            .put("recovering", false).put("retries", 0).put("eqPreset", prefs.getInt("equalizer", 0)).put("eqAvailable", false).put("levels", new JSONArray())
            .put("canNext", index + 1 < queue.length()).put("focusState", "none");
    }
    static boolean command(Context context, String action, double value) {
        var prefs = context.getSharedPreferences("player", 0).edit();
        if (!Double.isFinite(value)) return false;
        switch (action) {
            case "volume": prefs.putFloat("volume", (float)Math.max(0, Math.min(1, value))); break;
            case "speed": prefs.putFloat("speed", (float)Math.max(.5, Math.min(2, value))); break;
            case "repeat": prefs.putInt("repeat", Math.max(0, Math.min(2, (int)value))); break;
            case "shuffle": prefs.putBoolean("shuffle", value == 1); break;
            case "equalizer": prefs.putInt("equalizer", Math.max(0, Math.min(3, (int)value))); break;
            case "clear": prefs.putString("queue", "[]").putInt("index", 0).putLong("position", 0); break;
            case "pause": case "refresh": return true;
            case "sleep": return value == 0;
            default: return false;
        }
        prefs.apply(); return true;
    }
    static boolean matches(JSONObject track, int index, JSONObject expected) {
        return track != null && expected != null && expected.optInt("index", -1) == index
            && expected.optString("id").equals(track.optString("id")) && expected.optString("url").equals(track.optString("url"));
    }
    static boolean seek(Context context, JSONObject expected, double value) throws Exception {
        JSONObject state = read(context); int index = state.getInt("index");
        if (!matches(state.getJSONArray("queue").optJSONObject(index), index, expected)) return false;
        double duration = state.optDouble("duration");
        if (!Double.isFinite(value) || !Double.isFinite(duration) || duration <= 0) throw new IllegalArgumentException("Inicie a musica para ajustar a posicao.");
        long position = Math.round(Math.max(0, Math.min(duration, value)) * 1000);
        context.getSharedPreferences("player", 0).edit().putLong("position", position).apply(); return true;
    }
    static void updateMetadata(Context context, JSONObject track, String title, String artist) throws Exception {
        var prefs = context.getSharedPreferences("player", 0); JSONArray queue = new JSONArray(prefs.getString("queue", "[]"));
        for (int i = 0; i < queue.length(); i++) if (LibrarySync.sameTrack(queue.getJSONObject(i), track)) queue.getJSONObject(i).put("title", title).put("artist", artist);
        prefs.edit().putString("queue", queue.toString()).apply();
    }
    static void append(Context context, JSONObject track, boolean next) throws Exception {
        var prefs = context.getSharedPreferences("player", 0); JSONArray queue = new JSONArray(prefs.getString("queue", "[]")), updated = new JSONArray();
        int index = next ? Math.min(queue.length(), Math.max(0, prefs.getInt("index", 0)) + 1) : queue.length();
        for (int i = 0; i <= queue.length(); i++) { if (i == index) updated.put(track); if (i < queue.length()) updated.put(queue.getJSONObject(i)); }
        prefs.edit().putString("queue", updated.toString()).apply();
    }
}

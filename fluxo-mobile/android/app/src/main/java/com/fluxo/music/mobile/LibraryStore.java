package com.fluxo.music.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.os.Environment;
import android.provider.OpenableColumns;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.UUID;

public class LibraryStore {
    private final Context context;
    private final DownloadManager manager;
    public LibraryStore(Context context) {
        this.context = context.getApplicationContext();
        manager = (DownloadManager)context.getSystemService(Context.DOWNLOAD_SERVICE);
    }
    private JSONArray records() throws Exception {
        return new JSONArray(context.getSharedPreferences("library", 0).getString("tracks", "[]"));
    }
    private void save(JSONArray records) {
        context.getSharedPreferences("library", 0).edit().putString("tracks", records.toString()).commit();
    }
    public synchronized JSONArray list() throws Exception {
        JSONArray records = records();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            long downloadId = record.optLong("downloadId", -1);
            if (downloadId < 0) continue;
            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
                if (cursor == null || !cursor.moveToFirst()) { record.put("status", "failed"); continue; }
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                long done = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                record.put("bytes", done).put("total", total).put("progress", total > 0 ? Math.min(100, done * 100 / total) : 0);
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    String local = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                    record.put("localUri", local).put("status", "ready").put("progress", 100);
                    record.remove("statusDetail");
                } else if (status == DownloadManager.STATUS_FAILED) {
                    record.put("status", "failed").put("statusDetail", reason == DownloadManager.ERROR_INSUFFICIENT_SPACE ? "Sem espaco no dispositivo" : "Falha no download. Tente novamente.");
                } else {
                    record.put("status", "downloading").put("statusDetail", status == DownloadManager.STATUS_PAUSED
                        ? (reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI ? "Aguardando Wi-Fi" : "Aguardando conexao") : "Baixando " + record.optInt("progress") + "%");
                }
            }
        }
        if (!records.toString().equals(context.getSharedPreferences("library", 0).getString("tracks", "[]"))) save(records);
        return records;
    }
    public synchronized JSONObject download(JSONObject track, String url, boolean wifiOnly) throws Exception {
        JSONArray records = list();
        for (int i = 0; i < records.length(); i++) {
            JSONObject existing = records.getJSONObject(i);
            if (existing.optString("id").equals(track.optString("id")) && !existing.optString("status").equals("failed")) return existing;
        }
        remove(track.optString("id"));
        records = records();
        String fileName = UUID.randomUUID() + ".audio";
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
            .setTitle(track.optString("title", "Fluxo Music"))
            .setDescription(track.optString("artist", ""))
            .addRequestHeader("User-Agent", StreamResolver.AGENT)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MUSIC, fileName)
            .setAllowedOverMetered(!wifiOnly).setAllowedOverRoaming(false);
        if (wifiOnly) request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI);
        long id = manager.enqueue(request);
        JSONObject record = new JSONObject(track.toString());
        record.remove("localUri");
        record.put("downloadId", id).put("status", "downloading").put("savedAt", System.currentTimeMillis());
        records.put(record);
        save(records);
        final String artworkId = record.optString("id");
        final String artworkUrl = record.optString("thumbnail");
        FluxoAudioPlugin.IO.execute(() -> cacheArtwork(artworkId, artworkUrl));
        return record;
    }
    private void cacheArtwork(String id, String url) {
        if (!url.startsWith("https://")) return;
        try (okhttp3.Response response = StreamResolver.HTTP.newCall(new okhttp3.Request.Builder().url(url).build()).execute()) {
            if (!response.isSuccessful() || response.body() == null) return;
            byte[] bytes = response.body().byteStream().readNBytes(2000001);
            if (bytes.length > 2000000) return;
            File dir = new File(context.getFilesDir(), "music"); dir.mkdirs();
            File file = new File(dir, UUID.nameUUIDFromBytes(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".jpg");
            synchronized (this) {
                JSONArray records = records();
                for (int i = 0; i < records.length(); i++) {
                    JSONObject track = records.getJSONObject(i);
                    if (!track.optString("id").equals(id)) continue;
                    try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
                    track.put("thumbnail", Uri.fromFile(file).toString()); save(records); break;
                }
            }
        } catch (Exception ignored) {}
    }
    public synchronized JSONObject importAudio(Uri uri) throws Exception {
        String name = "Audio local";
        try (Cursor c = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        }
        File directory = new File(context.getFilesDir(), "music");
        directory.mkdirs();
        String id = UUID.randomUUID().toString();
        File target = new File(directory, id + ".audio");
        try (InputStream input = context.getContentResolver().openInputStream(uri); FileOutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new java.io.IOException("Arquivo indisponivel.");
            byte[] buffer = new byte[65536];
            int n;
            while ((n = input.read(buffer)) != -1) output.write(buffer, 0, n);
        } catch (Exception e) { target.delete(); throw e; }
        JSONObject track = new JSONObject().put("id", id).put("title", name.replaceFirst("\\.[^.]+$", ""))
            .put("artist", "Arquivo local").put("source", "local").put("status", "ready")
            .put("url", "").put("localUri", Uri.fromFile(target).toString())
            .put("bytes", target.length()).put("savedAt", System.currentTimeMillis());
        try (MediaMetadataRetriever metadata = new MediaMetadataRetriever()) {
            metadata.setDataSource(target.getPath());
            String title = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (title != null) track.put("title", title);
            if (artist != null) track.put("artist", artist);
            if (duration != null) track.put("duration", Long.parseLong(duration) / 1000);
            byte[] picture = metadata.getEmbeddedPicture();
            if (picture != null && picture.length < 5000000) {
                File art = new File(directory, id + ".jpg");
                try (FileOutputStream out = new FileOutputStream(art)) { out.write(picture); }
                track.put("thumbnail", Uri.fromFile(art).toString());
            }
        } catch (Exception ignored) {}
        JSONArray records = records(); records.put(track); save(records);
        return track;
    }
    public synchronized void migrate(JSONObject track, long offset, byte[] bytes, boolean complete) throws Exception {
        String id = track.getString("id");
        JSONArray saved = records();
        for (int i = 0; i < saved.length(); i++) {
            if (saved.getJSONObject(i).optString("id").equals(id)) return;
        }
        File directory = new File(context.getFilesDir(), "music");
        directory.mkdirs();
        String key = UUID.nameUUIDFromBytes(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        File partial = new File(directory, key + ".part");
        try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(partial, "rw")) {
            if (offset == 0) file.setLength(0);
            if (offset != file.length() || bytes.length > 524288) throw new java.io.IOException("Bloco de migracao invalido.");
            file.seek(offset); file.write(bytes);
        }
        if (complete) {
            File target = new File(directory, key + ".audio");
            if (!partial.renameTo(target)) throw new java.io.IOException("Nao foi possivel salvar o audio antigo.");
            JSONObject record = new JSONObject(track.toString()).put("localUri", Uri.fromFile(target).toString())
                .put("status", "ready").put("bytes", target.length()).put("savedAt", System.currentTimeMillis());
            JSONArray records = records(); records.put(record); save(records);
        }
    }
    public synchronized void remove(String id) throws Exception {
        JSONArray records = records();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (!record.optString("id").equals(id)) { kept.put(record); continue; }
            if (record.optLong("downloadId", -1) >= 0) manager.remove(record.optLong("downloadId"));
            for (String key : new String[]{"localUri", "thumbnail"}) {
                String uri = record.optString(key);
                if (uri.startsWith("file://")) {
                    File file = new File(Uri.parse(uri).getPath());
                    String canonical = file.getCanonicalPath();
                    if (canonical.startsWith(context.getFilesDir().getCanonicalPath() + File.separator)) file.delete();
                }
            }
        }
        save(kept);
    }
}

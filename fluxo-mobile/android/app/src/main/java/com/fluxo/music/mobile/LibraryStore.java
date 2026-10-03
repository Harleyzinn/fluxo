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
    private static LibraryStore instance;
    public static synchronized LibraryStore get(Context context) {
        if (instance == null) instance = new LibraryStore(context);
        return instance;
    }
    private final Context context;
    private final DownloadManager manager;
    private LibraryStore(Context context) {
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
        java.util.ArrayList<Long> downloadIds = new java.util.ArrayList<>();
        for (int i = 0; i < records.length(); i++) {
            long id = records.getJSONObject(i).optLong("downloadId", -1);
            if (id >= 0) downloadIds.add(id);
        }
        java.util.Map<Long, JSONObject> states = new java.util.HashMap<>();
        if (!downloadIds.isEmpty()) {
            long[] ids = new long[downloadIds.size()];
            for (int i = 0; i < ids.length; i++) ids[i] = downloadIds.get(i);
            try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(ids))) {
                if (cursor != null) while (cursor.moveToNext()) {
                    states.put(cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)), new JSONObject()
                        .put("status", cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)))
                        .put("reason", cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)))
                        .put("total", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                        .put("bytes", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)))
                        .put("local", cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))));
                }
            }
        }
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            long downloadId = record.optLong("downloadId", -1);
            if (downloadId < 0) { verifyFile(record); continue; }
            JSONObject snapshot = states.get(downloadId);
            if (snapshot == null) { record.put("status", "failed").put("statusDetail", "Download nao encontrado. Tente novamente."); continue; }
            {
                int status = snapshot.getInt("status");
                int reason = snapshot.getInt("reason");
                long total = snapshot.getLong("total");
                long done = snapshot.getLong("bytes");
                record.put("bytes", done).put("total", total).put("progress", total > 0 ? Math.min(100, done * 100 / total) : 0);
                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    String local = snapshot.optString("local");
                    record.put("localUri", local).put("status", "ready").put("progress", 100);
                    record.remove("statusDetail");
                    verifyFile(record);
                } else if (status == DownloadManager.STATUS_FAILED) {
                    String detail = switch (reason) {
                        case DownloadManager.ERROR_INSUFFICIENT_SPACE -> "Sem espaco no dispositivo";
                        case DownloadManager.ERROR_CANNOT_RESUME -> "Nao foi possivel retomar. Tente baixar novamente.";
                        case 401, 403 -> "A fonte recusou o download. Confira o link.";
                        case 404, 410 -> "Audio indisponivel nesta fonte.";
                        default -> "Falha no download. Tente novamente.";
                    };
                    record.put("status", "failed").put("statusDetail", detail);
                } else {
                    String detail = status == DownloadManager.STATUS_PENDING ? "Download agendado" : status == DownloadManager.STATUS_PAUSED
                        ? switch (reason) {
                            case DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "Aguardando Wi-Fi";
                            case DownloadManager.PAUSED_WAITING_TO_RETRY -> "Aguardando nova tentativa do Android";
                            default -> "Aguardando conexao";
                        } : "Baixando " + record.optInt("progress") + "%";
                    record.put("status", "downloading").put("statusDetail", detail);
                }
            }
        }
        if (!records.toString().equals(context.getSharedPreferences("library", 0).getString("tracks", "[]"))) save(records);
        return records;
    }
    private void verifyFile(JSONObject record) throws Exception {
        if (!record.optString("status").equals("ready")) return;
        String uri = record.optString("localUri");
        File file = uri.startsWith("file://") ? new File(Uri.parse(uri).getPath()) : null;
        if (file == null || !file.isFile() || file.length() == 0) {
            record.put("status", "failed").put("statusDetail", "Arquivo ausente. Baixe ou importe novamente.");
            record.remove("localUri");
        }
    }
    public synchronized String playbackUri(String id, String url) throws Exception {
        JSONArray records = records();
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.getJSONObject(i);
            if (!record.optString("id").equals(id) && (url == null || url.isEmpty() || !url.equals(record.optString("url")))) continue;
            if (!record.optString("status").equals("ready")) continue;
            String uri = record.optString("localUri");
            if (uri.startsWith("file://")) {
                File file = new File(Uri.parse(uri).getPath());
                if (file.isFile() && file.length() > 0) return uri;
            }
        }
        return null;
    }
    public synchronized JSONObject download(JSONObject track, String url, boolean wifiOnly) throws Exception {
        JSONArray records = list();
        for (int i = 0; i < records.length(); i++) {
            JSONObject existing = records.getJSONObject(i);
            if (LibrarySync.sameTrack(existing, track) && !existing.optString("status").equals("failed")) return existing;
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
    public synchronized void updateMetadata(JSONObject track, String title, String artist) throws Exception {
        JSONArray rows = records();
        for (int i = 0; i < rows.length(); i++) if (LibrarySync.sameTrack(rows.getJSONObject(i), track)) rows.getJSONObject(i).put("title", title).put("artist", artist);
        save(rows);
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
    public synchronized void migrate(JSONObject track, long offset, byte[] bytes, boolean complete, boolean repair) throws Exception {
        String id = track.getString("id");
        JSONArray saved = records();
        for (int i = 0; i < saved.length(); i++) {
            JSONObject existing = saved.getJSONObject(i);
            if (existing.optString("id").equals(id)) {
                if (!repair) return;
                if (existing.optLong("downloadId", -1) >= 0) throw new java.io.IOException("Este download nao pode ser substituido pela migracao.");
            }
        }
        File directory = new File(context.getFilesDir(), "music");
        directory.mkdirs();
        String key = UUID.nameUUIDFromBytes(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        File partial = new File(directory, key + (repair ? ".repair.part" : ".part"));
        try (java.io.RandomAccessFile file = new java.io.RandomAccessFile(partial, "rw")) {
            if (offset < 0) throw new java.io.IOException("Posicao de migracao invalida.");
            if (offset == 0) file.setLength(0);
            if (offset != file.length() || bytes.length > 524288) throw new java.io.IOException("Bloco de migracao invalido.");
            file.seek(offset); file.write(bytes);
        }
        if (complete) {
            File target = new File(directory, (repair ? UUID.randomUUID().toString() : key) + ".audio");
            if (!partial.renameTo(target)) throw new java.io.IOException("Nao foi possivel salvar o audio antigo.");
            JSONObject record = new JSONObject(track.toString()).put("localUri", Uri.fromFile(target).toString())
                .put("status", "ready").put("bytes", target.length()).put("savedAt", System.currentTimeMillis());
            JSONArray records = records(); boolean replaced = false;
            for (int i = 0; i < records.length(); i++) if (records.getJSONObject(i).optString("id").equals(id)) {
                if (!repair || records.getJSONObject(i).optLong("downloadId", -1) >= 0) { target.delete(); throw new java.io.IOException("A biblioteca mudou durante a migracao."); }
                String artwork = records.getJSONObject(i).optString("thumbnail");
                if (!artwork.isEmpty()) record.put("thumbnail", artwork);
                records.put(i, record); replaced = true; break;
            }
            if (!replaced) records.put(record);
            // A repair uses a new file so the previous copy remains recoverable.
            save(records);
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

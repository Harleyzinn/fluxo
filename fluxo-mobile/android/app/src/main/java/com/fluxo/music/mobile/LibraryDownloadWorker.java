package com.fluxo.music.mobile;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

public class LibraryDownloadWorker extends Worker {
    public LibraryDownloadWorker(@NonNull Context context, @NonNull WorkerParameters parameters) { super(context, parameters); }
    @NonNull @Override public Result doWork() {
        String id = getInputData().getString("id");
        Context context = getApplicationContext();
        try {
            var track = LibrarySync.target(context, id);
            if (track == null || isStopped()) return Result.success();
            var records = LibraryStore.get(context).list();
            for (int i = 0; i < records.length(); i++) {
                var record = records.getJSONObject(i);
                if (record.optString("id").equals(id) && !record.optString("status").equals("failed")) {
                    LibrarySync.status(context, id, "done", ""); return Result.success();
                }
            }
            LibrarySync.status(context, id, "queued", "Preparando audio para download");
            String url = StreamResolver.resolve(track.optString("url"));
            synchronized (LibrarySync.class) {
                if (isStopped() || LibrarySync.target(context, id) == null) return Result.success();
                LibraryStore.get(context).download(track, url, LibrarySync.wifiOnly(context));
                LibrarySync.status(context, id, "done", "");
            }
            return Result.success();
        } catch (Exception failure) {
            try { LibrarySync.status(context, id, getRunAttemptCount() >= 2 ? "failed" : "queued",
                getRunAttemptCount() >= 2 ? StreamResolver.readable(failure) : "Aguardando nova tentativa"); } catch (Exception ignored) {}
            return getRunAttemptCount() >= 2 ? Result.failure() : Result.retry();
        }
    }
}

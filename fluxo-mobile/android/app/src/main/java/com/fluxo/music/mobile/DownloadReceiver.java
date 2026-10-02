package com.fluxo.music.mobile;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class DownloadReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
        PendingResult pending = goAsync();
        FluxoAudioPlugin.IO.execute(() -> {
            try { LibrarySync.completed(context.getApplicationContext(), id); }
            catch (Exception failure) { android.util.Log.w("FluxoDownloads", "Download completion failed", failure); }
            finally { pending.finish(); }
        });
    }
}

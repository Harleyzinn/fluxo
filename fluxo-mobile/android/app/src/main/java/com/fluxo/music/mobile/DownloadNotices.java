package com.fluxo.music.mobile;

import android.app.*;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

final class DownloadNotices {
    static void completed(Context context, long id) throws Exception {
        if (!context.getSharedPreferences("runtime", 0).getBoolean("downloadNotifications", true) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        var manager = (NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("fluxo_downloads", "Downloads", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null); channel.enableVibration(false); manager.createNotificationChannel(channel);
        }
        var record = LibraryStore.get(context).noticeRecord(id); if (record == null) return;
        var open = PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        var notice = new NotificationCompat.Builder(context, "fluxo_downloads").setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Download concluido").setContentText(record.optString("title", "Fluxo Mobile")).setContentIntent(open)
            .setAutoCancel(true).setSilent(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_STATUS).build();
        manager.notify("fluxo_download", (int)id, notice);
        AudioDiagnostics.record("downloads", "silent_notice");
    }
}

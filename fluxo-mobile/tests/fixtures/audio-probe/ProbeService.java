package com.fluxo.qa.audio;

import android.app.*;
import android.media.*;
import android.os.*;
import android.content.Intent;
import java.io.*;
import java.nio.*;
import org.json.JSONObject;

public class ProbeService extends Service {
    private MediaPlayer player;
    private AudioManager audio;
    private AudioFocusRequest request;
    private int losses, requests, lastChange;
    private long played, updated;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AudioManager.OnAudioFocusChangeListener listener = change -> {
        lastChange = change;
        if (change < 0) { losses++; if (player != null && player.isPlaying()) player.pause(); }
        snapshot();
    };
    private final Runnable tick = new Runnable() {
        @Override public void run() { snapshot(); handler.postDelayed(this, 250); }
    };
    @Override public void onCreate() {
        super.onCreate(); audio = (AudioManager)getSystemService(AUDIO_SERVICE);
        NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel("probe", "Audio test", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null); channel.enableVibration(false); manager.createNotificationChannel(channel);
        }
        Notification.Builder notification = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "probe") : new Notification.Builder(this);
        startForeground(5001, notification.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("External audio probe").build());
        handler.post(tick);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        if (intent != null && "notify".equals(intent.getAction())) {
            Notification.Builder notice = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "probe") : new Notification.Builder(this);
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(5002, notice.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Test notification").build()); return START_NOT_STICKY;
        }
        try {
            if (player != null) { player.release(); player = null; }
            if (request != null && Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(request);
            else audio.abandonAudioFocus(listener);
            losses = requests = lastChange = 0; played = 0; updated = SystemClock.elapsedRealtime();
            File file = new File(getFilesDir(), "probe.wav");
            ByteBuffer bytes = ByteBuffer.allocate(44 + 8000 * 30 * 2).order(ByteOrder.LITTLE_ENDIAN);
            bytes.put("RIFF".getBytes()).putInt(bytes.capacity() - 8).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(bytes.capacity() - 44);
            while (bytes.hasRemaining()) bytes.putShort((short)0);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes.array()); }
            player = new MediaPlayer(); player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            player.setDataSource(file.getAbsolutePath()); player.setLooping(true); player.prepare();
            int focus = intent == null ? 1 : intent.getIntExtra("focus", 1), result;
            requests++;
            if (Build.VERSION.SDK_INT >= 26) {
                request = new AudioFocusRequest.Builder(focus).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()).setOnAudioFocusChangeListener(listener, handler).setWillPauseWhenDucked(true).build();
                result = audio.requestAudioFocus(request);
            } else result = audio.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, focus);
            if (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) player.start();
            snapshot();
        } catch (Exception failure) { throw new RuntimeException(failure); }
        return START_NOT_STICKY;
    }
    private void snapshot() {
        try { long now = SystemClock.elapsedRealtime(); if (player != null && player.isPlaying()) played += Math.max(0, now - updated); updated = now;
            JSONObject state = new JSONObject().put("playing", player != null && player.isPlaying()).put("position", player == null ? 0 : player.getCurrentPosition()).put("playedMs", played).put("losses", losses).put("requests", requests).put("lastChange", lastChange);
            android.util.AtomicFile file = new android.util.AtomicFile(new File(getFilesDir(), "state.json"));
            FileOutputStream out = null;
            try { out = file.startWrite(); out.write(state.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); file.finishWrite(out); }
            catch (Exception failure) { if (out != null) file.failWrite(out); }
        } catch (Exception ignored) {}
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) { player.release(); player = null; }
        if (request != null && Build.VERSION.SDK_INT >= 26) audio.abandonAudioFocusRequest(request); else audio.abandonAudioFocus(listener);
        snapshot(); super.onDestroy();
    }
}

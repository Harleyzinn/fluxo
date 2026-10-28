package com.fluxo.music.mobile;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;

final class AudioFocusController {
    private final AudioManager manager;
    private final Handler handler;
    private final Runnable lost;
    private final java.util.function.Consumer<Boolean> duck;
    private final PlaybackAuthorization authorization = new PlaybackAuthorization();
    private AudioFocusRequest request;
    private AudioManager.OnAudioFocusChangeListener listener;
    private boolean requested;
    static int requests, releases;
    AudioFocusController(Context context, Handler handler, Runnable lost, java.util.function.Consumer<Boolean> duck) {
        manager = (AudioManager)context.getSystemService(Context.AUDIO_SERVICE); this.handler = handler; this.lost = lost; this.duck = duck;
    }
    boolean acquire(String source) {
        if (authorization.allowed()) return true;
        long token = authorization.authorize();
        listener = change -> handler.post(() -> {
            if (!authorization.allows(token)) return;
            AudioDiagnostics.record("audio_focus", "change", "change", change, "token", token);
            if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) { duck.accept(true); return; }
            if (change == AudioManager.AUDIOFOCUS_GAIN) { duck.accept(false); return; }
            if (change < 0) { release("focus_loss"); lost.run(); }
        });
        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAcceptsDelayedFocusGain(false).setWillPauseWhenDucked(false).setOnAudioFocusChangeListener(listener, handler).build();
            result = manager.requestAudioFocus(request);
        } else result = manager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        requests++; requested = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        AudioDiagnostics.record(source, "focus_request", "result", result, "token", token, "requests", requests);
        if (!requested) authorization.revoke();
        return requested;
    }
    void release(String source) {
        authorization.revoke();
        if (!requested) return;
        requested = false; int result = Build.VERSION.SDK_INT >= 26 ? manager.abandonAudioFocusRequest(request) : manager.abandonAudioFocus(listener);
        releases++; AudioDiagnostics.record(source, "focus_release", "result", result, "releases", releases);
        duck.accept(false);
        request = null; listener = null;
    }
    boolean allowed() { return authorization.allowed(); }
}

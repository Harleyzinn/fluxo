package com.fluxo.music.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;

@androidx.media3.common.util.UnstableApi
public class PlaybackService extends MediaSessionService {
    static volatile PlaybackService instance;
    ExoPlayer player;
    private MediaSession session;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String error = "";
    private long sleepAt;
    private long bufferingSince;
    private String retryId = "";
    private int ticks;
    private android.media.audiofx.Equalizer equalizer;
    private int eqPreset;
    private final AudioMeter meter = new AudioMeter();

    @Override public void onCreate() {
        super.onCreate();
        var http = new DefaultHttpDataSource.Factory().setUserAgent(StreamResolver.AGENT)
            .setConnectTimeoutMs(10000).setReadTimeoutMs(15000).setAllowCrossProtocolRedirects(false);
        var source = new ResolvingDataSource.Factory(new DefaultDataSource.Factory(this, http), spec -> {
            if (!"fluxo".equals(spec.uri.getScheme())) return spec;
            String page = spec.uri.getQueryParameter("url");
            return spec.withUri(Uri.parse(StreamResolver.resolve(page)));
        });
        var renderers = new androidx.media3.exoplayer.DefaultRenderersFactory(this) {
            @Override protected androidx.media3.exoplayer.audio.AudioSink buildAudioSink(
                android.content.Context context, boolean floatOutput, boolean playbackParams) {
                return new androidx.media3.exoplayer.audio.DefaultAudioSink.Builder(context)
                    .setAudioProcessors(new androidx.media3.common.audio.AudioProcessor[]{new androidx.media3.exoplayer.audio.TeeAudioProcessor(meter)})
                    .setEnableFloatOutput(false).setEnableAudioOutputPlaybackParameters(playbackParams).build();
            }
        };
        player = new ExoPlayer.Builder(this, renderers)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(source))
            .setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(15000, 50000, 600, 1800).build())
            .setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_LOCAL).build();
        var activity = android.app.PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, player).setSessionActivity(activity).build();
        player.addListener(new Player.Listener() {
            @Override public void onAudioSessionIdChanged(int audioSessionId) { configureEqualizer(audioSessionId); }
            @Override public void onEvents(Player ignored, Player.Events events) {
                if (player.getPlaybackState() == Player.STATE_BUFFERING) {
                    if (bufferingSince == 0) bufferingSince = android.os.SystemClock.elapsedRealtime();
                } else bufferingSince = 0;
                if (player.getPlaybackState() == Player.STATE_READY) error = "";
                publish();
            }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                error = "";
                retryId = "";
                persist();
                // Resolve the next item ahead of time, without starting another audio player.
                int next = player.getNextMediaItemIndex();
                if (next != C.INDEX_UNSET) {
                    String url = track(player.getMediaItemAt(next)).optString("url");
                    FluxoAudioPlugin.IO.execute(() -> { try { StreamResolver.resolve(url); } catch (Exception ignored) {} });
                }
            }
            @Override public void onPlayerError(PlaybackException failure) {
                MediaItem item = player.getCurrentMediaItem();
                String id = item == null ? "" : item.mediaId;
                if (!id.equals(retryId) && item != null && track(item).optString("localUri").isEmpty() && StreamResolver.isPage(track(item).optString("url"))) {
                    retryId = id;
                    StreamResolver.invalidate(track(item).optString("url"));
                    player.prepare();
                    return;
                }
                error = item != null && !track(item).optString("localUri").isEmpty()
                    ? "O arquivo baixado esta indisponivel. Importe ou baixe esta musica novamente."
                    : "Nao foi possivel iniciar esta musica. Verifique a conexao e tente novamente.";
                android.util.Log.e("FluxoPlayback", "Playback failed", failure);
                player.pause();
                publish();
            }
        });
        instance = this;
        try {
            var prefs = getSharedPreferences("player", MODE_PRIVATE);
            eqPreset = prefs.getInt("equalizer", 0);
            player.setRepeatMode(prefs.getInt("repeat", 0));
            player.setShuffleModeEnabled(prefs.getBoolean("shuffle", false));
            player.setPlaybackSpeed(prefs.getFloat("speed", 1));
            JSONArray saved = new JSONArray(prefs.getString("queue", "[]"));
            long savedPosition = prefs.getLong("position", 0);
            if (saved.length() > 0) {
                setQueue(saved, Math.min(prefs.getInt("index", 0), saved.length() - 1), false);
                player.seekTo(savedPosition);
            }
        } catch (Exception ignored) {}
        handler.post(tick);
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (sleepAt > 0 && System.currentTimeMillis() >= sleepAt) { player.pause(); sleepAt = 0; }
            if (bufferingSince > 0 && android.os.SystemClock.elapsedRealtime() - bufferingSince > 35000) {
                error = "O audio demorou demais para responder. Tente novamente.";
                player.stop();
                bufferingSince = 0;
            }
            publish();
            if (++ticks % 10 == 0) persist();
            handler.postDelayed(this, 750);
        }
    };

    static JSONObject track(MediaItem item) {
        try { return new JSONObject(item.mediaMetadata.extras.getString("track", "{}")); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    private void configureEqualizer(int audioSessionId) {
        if (equalizer != null) { equalizer.release(); equalizer = null; }
        if (audioSessionId == C.AUDIO_SESSION_ID_UNSET) return;
        try {
            equalizer = new android.media.audiofx.Equalizer(0, audioSessionId);
            applyEqualizer();
        } catch (RuntimeException ignored) { equalizer = null; }
    }
    private void applyEqualizer() {
        if (equalizer == null) return;
        try {
            short[] range = equalizer.getBandLevelRange();
            for (short band = 0; band < equalizer.getNumberOfBands(); band++) {
                int hz = equalizer.getCenterFreq(band) / 1000;
                int gain = switch (eqPreset) {
                    case 1 -> hz < 250 ? 450 : hz > 2000 ? -100 : 0;
                    case 2 -> hz >= 500 && hz <= 4000 ? 300 : -150;
                    case 3 -> hz > 3000 ? 350 : hz < 250 ? -100 : 0;
                    default -> 0;
                };
                equalizer.setBandLevel(band, (short)Math.max(range[0], Math.min(range[1], gain)));
            }
            equalizer.setEnabled(eqPreset != 0);
        } catch (RuntimeException ignored) {}
    }

    static MediaItem item(JSONObject track) {
        String url = track.optString("localUri", track.optString("url"));
        Uri uri = StreamResolver.isPage(url)
            ? new Uri.Builder().scheme("fluxo").authority("audio").appendQueryParameter("url", url).build() : Uri.parse(url);
        Bundle extras = new Bundle();
        extras.putString("track", track.toString());
        var metadata = new MediaMetadata.Builder().setTitle(track.optString("title", "Sem titulo"))
            .setArtist(track.optString("artist", "Arquivo local")).setExtras(extras);
        String image = track.optString("thumbnail");
        if (image.startsWith("https://") || image.startsWith("file://")) metadata.setArtworkUri(Uri.parse(image));
        return new MediaItem.Builder().setMediaId(track.optString("id", url)).setUri(uri).setMediaMetadata(metadata.build()).build();
    }

    void setQueue(JSONArray queue, int index, boolean play) throws Exception {
        if (queue.length() == 0) { player.clearMediaItems(); persist(); return; }
        ArrayList<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < queue.length(); i++) items.add(item(queue.getJSONObject(i)));
        error = "";
        retryId = "";
        player.setMediaItems(items, Math.max(0, Math.min(index, items.size() - 1)), 0);
        if (play && !items.isEmpty()) { player.prepare(); player.play(); }
        persist();
    }

    JSONObject state() {
        JSONObject data = new JSONObject();
        try {
            JSONArray queue = new JSONArray();
            for (int i = 0; i < player.getMediaItemCount(); i++) queue.put(track(player.getMediaItemAt(i)));
            data.put("queue", queue).put("index", player.getCurrentMediaItemIndex());
            data.put("playing", player.isPlaying()).put("playWhenReady", player.getPlayWhenReady());
            data.put("buffering", player.getPlaybackState() == Player.STATE_BUFFERING);
            data.put("position", player.getCurrentPosition() / 1000.0);
            data.put("duration", Math.max(0, player.getDuration()) / 1000.0);
            data.put("buffered", Math.max(0, player.getBufferedPosition()) / 1000.0);
            data.put("shuffle", player.getShuffleModeEnabled()).put("repeat", player.getRepeatMode());
            data.put("speed", player.getPlaybackParameters().speed).put("sleepAt", sleepAt).put("error", error);
            data.put("eqPreset", eqPreset).put("eqAvailable", equalizer != null);
            JSONArray levels = new JSONArray();
            for (float value : meter.levels) levels.put(player.isPlaying() ? value : 0);
            data.put("levels", levels);
        } catch (Exception ignored) {}
        return data;
    }

    void command(String action, double value, int index) {
        switch (action) {
            case "play": error = ""; retryId = ""; player.prepare(); player.play(); break;
            case "pause": player.pause(); break;
            case "next": player.seekToNextMediaItem(); break;
            case "previous": player.seekToPrevious(); break;
            case "seek": player.seekTo((long) (Math.max(0, value) * 1000)); break;
            case "jump": if (index >= 0 && index < player.getMediaItemCount()) { player.seekTo(index, 0); player.prepare(); player.play(); } break;
            case "remove": if (index >= 0 && index < player.getMediaItemCount()) player.removeMediaItem(index); break;
            case "move": if (index >= 0 && index < player.getMediaItemCount() && value >= 0 && value < player.getMediaItemCount()) player.moveMediaItem(index, (int)value); break;
            case "clear": player.clearMediaItems(); break;
            case "shuffle": player.setShuffleModeEnabled(value == 1); break;
            case "repeat": player.setRepeatMode(Math.max(0, Math.min(2, (int)value))); break;
            case "speed": player.setPlaybackSpeed((float)Math.max(0.5, Math.min(2, value))); break;
            case "sleep": sleepAt = value <= 0 ? 0 : System.currentTimeMillis() + (long)(value * 60000); break;
            case "equalizer": eqPreset = Math.max(0, Math.min(3, (int)value)); applyEqualizer(); break;
        }
        persist();
        publish();
    }

    void persist() {
        if (player == null) return;
        getSharedPreferences("player", MODE_PRIVATE).edit().putString("queue", state().optJSONArray("queue").toString())
            .putInt("index", player.getCurrentMediaItemIndex()).putLong("position", player.getCurrentPosition())
            .putInt("equalizer", eqPreset).putInt("repeat", player.getRepeatMode())
            .putBoolean("shuffle", player.getShuffleModeEnabled()).putFloat("speed", player.getPlaybackParameters().speed).apply();
    }
    void publish() { FluxoAudioPlugin.emit("state", state()); }
    @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }
    @Override public void onTaskRemoved(Intent rootIntent) { if (!player.getPlayWhenReady()) stopSelf(); }
    @Override public void onDestroy() {
        persist(); handler.removeCallbacksAndMessages(null); instance = null;
        if (equalizer != null) equalizer.release();
        player.release(); session.release(); super.onDestroy();
    }
}

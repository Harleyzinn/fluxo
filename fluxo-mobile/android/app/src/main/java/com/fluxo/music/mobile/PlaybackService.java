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
import androidx.media3.session.DefaultMediaNotificationProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Collections;

@androidx.media3.common.util.UnstableApi
public class PlaybackService extends MediaSessionService {
    static volatile PlaybackService instance;
    ExoPlayer player;
    private MediaSession session;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String error = "";
    private long sleepAt;
    private long bufferingSince;
    private int retries;
    private int playbackGeneration;
    private boolean recovering;
    private boolean sleepEnd;
    private boolean radio;
    private boolean radioOffline;
    private boolean radioLoading;
    private int radioGeneration;
    private long radioRetryAt;
    private String radioError = "";
    private JSONObject radioSeed = new JSONObject();
    private final LinkedHashSet<String> radioSeen = new LinkedHashSet<>();
    private final LinkedHashSet<String> radioExcluded = new LinkedHashSet<>();
    private android.net.ConnectivityManager connectivity;
    private android.net.ConnectivityManager.NetworkCallback networkCallback;
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
            .setHandleAudioBecomingNoisy(true).setWakeMode(C.WAKE_MODE_NETWORK).build();
        var activity = android.app.PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        session = new MediaSession.Builder(this, player).setSessionActivity(activity).build();
        var notification = new DefaultMediaNotificationProvider.Builder(this)
            .setChannelId("fluxo_playback").setChannelName(R.string.playback_channel).setNotificationId(1001).build();
        setMediaNotificationProvider(notification);
        // Direct plugin calls do not bind a MediaController. Register the session explicitly
        // so Media3 owns the foreground service and its system media notification.
        addSession(session);
        connectivity = (android.net.ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        networkCallback = new android.net.ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(android.net.Network network) {
                handler.post(() -> {
                    if (recovering && player.getPlayWhenReady()) retryPlayback(playbackGeneration);
                    if (radio && !radioOffline) { radioRetryAt = 0; refillRadio(); }
                });
            }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        player.addListener(new Player.Listener() {
            @Override public void onPlayWhenReadyChanged(boolean play, int reason) {
                if (!play && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    sleepEnd = false; player.setPauseAtEndOfMediaItems(false); publish();
                }
            }
            @Override public void onAudioSessionIdChanged(int audioSessionId) { configureEqualizer(audioSessionId); }
            @Override public void onEvents(Player ignored, Player.Events events) {
                if (player.getPlayWhenReady() && player.getPlaybackState() == Player.STATE_BUFFERING) {
                    if (bufferingSince == 0) bufferingSince = android.os.SystemClock.elapsedRealtime();
                } else bufferingSince = 0;
                if (player.getPlaybackState() == Player.STATE_READY) { error = ""; recovering = false; }
                if (!player.getPlayWhenReady()) recovering = false;
                refillRadio();
                publish();
            }
            @Override public void onMediaItemTransition(@Nullable MediaItem item, int reason) {
                error = "";
                retries = 0;
                playbackGeneration++;
                recovering = false;
                if (sleepEnd && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                    player.pause(); sleepEnd = false;
                }
                refillRadio();
                persist();
                // Resolve the next item ahead of time, without starting another audio player.
                int next = player.getNextMediaItemIndex();
                if (next != C.INDEX_UNSET) {
                    String url = track(player.getMediaItemAt(next)).optString("url");
                    if (track(player.getMediaItemAt(next)).optString("localUri").isEmpty())
                        FluxoAudioPlugin.IO.execute(() -> { try { StreamResolver.resolve(url); } catch (Exception ignored) {} });
                }
            }
            @Override public void onPlayerError(PlaybackException failure) {
                MediaItem item = player.getCurrentMediaItem();
                android.util.Log.e("FluxoPlayback", "Playback failed", failure);
                recoverPlayback();
            }
        });
        instance = this;
        try {
            var prefs = getSharedPreferences("player", MODE_PRIVATE);
            setRadioExclusions(new JSONArray(prefs.getString("radioExcluded", "[]")));
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
            if (sleepEnd && player.getPlaybackState() == Player.STATE_ENDED) { player.pause(); sleepEnd = false; }
            if (player.getPlayWhenReady() && bufferingSince > 0 && !recovering
                && android.os.SystemClock.elapsedRealtime() - bufferingSince > 45000) recoverPlayback();
            if (radio && ticks % 20 == 0) refillRadio();
            publish();
            if (++ticks % 10 == 0) persist();
            handler.postDelayed(this, 750);
        }
    };

    private void recoverPlayback() {
        MediaItem item = player.getCurrentMediaItem();
        if (!player.getPlayWhenReady() || item == null) return;
        boolean local = !track(item).optString("localUri").isEmpty();
        if (local || retries >= 3) {
            recovering = false;
            error = local ? "O arquivo baixado esta indisponivel. Baixe ou importe novamente."
                : "Nao foi possivel retomar o audio. Verifique a conexao e tente novamente.";
            player.pause(); publish(); return;
        }
        retries++;
        recovering = true;
        error = "";
        int token = playbackGeneration;
        // Keep the foreground media session in BUFFERING while a URL is renewed.
        StreamResolver.invalidate(track(item).optString("url"));
        player.prepare();
        handler.postDelayed(() -> retryPlayback(token), retries * 1500L);
        publish();
    }

    private void retryPlayback(int token) {
        if (token != playbackGeneration || !recovering || !player.getPlayWhenReady()) return;
        long position = player.getCurrentPosition();
        player.stop(); player.seekTo(position); player.prepare();
        recovering = false; bufferingSince = android.os.SystemClock.elapsedRealtime();
    }

    void stopRadio() {
        radio = false; radioLoading = false; radioError = ""; radioGeneration++;
        if (player != null) for (int i = player.getMediaItemCount() - 1; i > player.getCurrentMediaItemIndex(); i--)
            if (track(player.getMediaItemAt(i)).optBoolean("radioGenerated")) player.removeMediaItem(i);
        publish();
    }

    void startRadio(JSONObject seed, boolean local) throws Exception {
        if (local) {
            JSONArray files = LibraryStore.get(this).list(); boolean alternative = false;
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                boolean sameUrl = !seed.optString("url").isEmpty() && seed.optString("url").equals(file.optString("url"));
                if (file.optString("status").equals("ready") && !file.optString("id").equals(seed.optString("id")) && !sameUrl && !excluded(file)) alternative = true;
            }
            if (!alternative) throw new IllegalArgumentException("Adicione outra musica baixada e permitida no radio.");
        }
        JSONObject now = player.getCurrentMediaItem() == null ? new JSONObject() : track(player.getCurrentMediaItem());
        boolean same = now.optString("id").equals(seed.optString("id"));
        if (same && (player.getPlaybackState() == Player.STATE_READY || player.getPlaybackState() == Player.STATE_BUFFERING)) {
            stopRadio(); player.play();
        } else setQueue(new JSONArray().put(seed), 0, true);
        radio = true; radioOffline = local; radioSeed = new JSONObject(seed.toString());
        radioSeen.clear();
        for (int i = 0; i < player.getMediaItemCount(); i++) remember(track(player.getMediaItemAt(i)));
        radioRetryAt = 0; radioError = "";
        player.setRepeatMode(Player.REPEAT_MODE_OFF); player.setShuffleModeEnabled(false);
        refillRadio(); publish();
    }

    private boolean excluded(JSONObject track) {
        return radioExcluded.contains(track.optString("id")) || (!track.optString("url").isEmpty() && radioExcluded.contains(track.optString("url")));
    }

    void setRadioExclusions(JSONArray tracks) throws Exception {
        radioExcluded.clear();
        for (int i = 0; i < Math.min(tracks.length(), 500); i++) {
            JSONObject track = tracks.optJSONObject(i); if (track == null) continue;
            radioExcluded.add(track.optString("id"));
            if (!track.optString("url").isEmpty()) radioExcluded.add(track.optString("url"));
        }
        getSharedPreferences("player", MODE_PRIVATE).edit().putString("radioExcluded", tracks.toString()).apply();
        if (radio) {
            for (int i = player.getMediaItemCount() - 1; i > player.getCurrentMediaItemIndex(); i--)
                if (track(player.getMediaItemAt(i)).optBoolean("radioGenerated") && excluded(track(player.getMediaItemAt(i)))) player.removeMediaItem(i);
            radioRetryAt = 0; refillRadio(); publish();
        }
    }

    private void remember(JSONObject track) {
        radioSeen.add(track.optString("id"));
        String url = track.optString("url"); if (!url.isEmpty()) radioSeen.add(url);
        while (radioSeen.size() > 600) radioSeen.remove(radioSeen.iterator().next());
    }

    private void refillRadio() {
        if (!radio || radioLoading || player.getMediaItemCount() - player.getCurrentMediaItemIndex() > (radioOffline ? 1 : 3)
            || System.currentTimeMillis() < radioRetryAt) return;
        MediaItem current = player.getCurrentMediaItem();
        if (current == null) { stopRadio(); return; }
        JSONObject seed = track(current);
        int token = radioGeneration;
        boolean local = radioOffline;
        radioLoading = true;
        FluxoAudioPlugin.IO.execute(() -> {
            JSONArray candidates = new JSONArray(); String failure = "";
            try {
                candidates = local ? LibraryStore.get(this).list() : StreamResolver.related(seed);
            } catch (Exception e) { failure = StreamResolver.readable(e); }
            JSONArray batch = candidates; String message = failure;
            handler.post(() -> {
                if (token != radioGeneration || !radio || instance != this) return;
                radioError = message;
                ArrayList<JSONObject> eligible = new ArrayList<>();
                for (int i = 0; i < batch.length(); i++) {
                    JSONObject candidate = batch.optJSONObject(i);
                    if (candidate == null || excluded(candidate) || (local && !candidate.optString("status").equals("ready"))) continue;
                    if (candidate.optString("id").equals(seed.optString("id"))) continue;
                    if (radioSeen.contains(candidate.optString("id")) || (!candidate.optString("url").isEmpty() && radioSeen.contains(candidate.optString("url")))) continue;
                    eligible.add(candidate);
                }
                if (local && eligible.isEmpty()) {
                    radioSeen.clear(); remember(seed);
                    for (int i = 0; i < batch.length(); i++) {
                        JSONObject candidate = batch.optJSONObject(i);
                        if (candidate != null && !excluded(candidate) && candidate.optString("status").equals("ready") && !candidate.optString("id").equals(seed.optString("id"))) eligible.add(candidate);
                    }
                }
                Collections.shuffle(eligible);
                int added = 0;
                for (JSONObject candidate : eligible) {
                    if (radioSeen.contains(candidate.optString("id")) || excluded(candidate)) continue;
                    boolean queued = false;
                    for (int i = player.getCurrentMediaItemIndex(); i < player.getMediaItemCount(); i++) {
                        JSONObject present = track(player.getMediaItemAt(i));
                        if (present.optString("id").equals(candidate.optString("id")) || (!present.optString("url").isEmpty() && present.optString("url").equals(candidate.optString("url")))) { queued = true; break; }
                    }
                    if (queued) continue;
                    remember(candidate);
                    try { candidate.put("radioGenerated", true); } catch (Exception ignored) {}
                    player.addMediaItem(item(candidate));
                    if (++added == 6) break;
                }
                if (added == 0) {
                    radioError = message.isEmpty() ? (local ? "Adicione mais musicas baixadas para continuar o radio." : "Sem novas recomendacoes. Tente renovar o radio.") : message;
                    radioRetryAt = System.currentTimeMillis() + 60000;
                } else {
                    radioError = "";
                    int trim = player.getCurrentMediaItemIndex() - 2;
                    if (trim > 0) player.removeMediaItems(0, trim);
                    if (player.getPlaybackState() == Player.STATE_ENDED && player.getPlayWhenReady()) {
                        player.seekToNextMediaItem(); player.prepare(); player.play();
                    }
                }
                radioLoading = false;
                persist(); publish();
            });
        });
    }

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
        stopRadio(); playbackGeneration++; recovering = false; retries = 0;
        if (queue.length() == 0) { player.pause(); player.clearMediaItems(); persist(); return; }
        ArrayList<MediaItem> items = new ArrayList<>();
        for (int i = 0; i < queue.length(); i++) items.add(item(queue.getJSONObject(i)));
        error = "";
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
            data.put("sleepEnd", sleepEnd).put("recovering", recovering).put("retries", retries);
            data.put("radio", radio).put("radioOffline", radioOffline).put("radioLoading", radioLoading)
                .put("radioError", radioError).put("radioSeed", radioSeed);
            data.put("eqPreset", eqPreset).put("eqAvailable", equalizer != null);
            JSONArray levels = new JSONArray();
            for (float value : meter.levels) levels.put(player.isPlaying() ? value : 0);
            data.put("levels", levels);
        } catch (Exception ignored) {}
        return data;
    }

    void command(String action, double value, int index) {
        switch (action) {
            case "play": error = ""; retries = 0; recovering = false; playbackGeneration++; player.prepare(); player.play(); break;
            case "pause": playbackGeneration++; recovering = false; player.pause(); break;
            case "next": player.seekToNextMediaItem(); break;
            case "previous": player.seekToPrevious(); break;
            case "seek": player.seekTo((long) (Math.max(0, value) * 1000)); break;
            case "jump": if (index >= 0 && index < player.getMediaItemCount()) { player.seekTo(index, 0); player.prepare(); player.play(); } break;
            case "remove": if (index >= 0 && index < player.getMediaItemCount()) player.removeMediaItem(index); break;
            case "move": if (index >= 0 && index < player.getMediaItemCount() && value >= 0 && value < player.getMediaItemCount()) player.moveMediaItem(index, (int)value); break;
            case "clear": stopRadio(); playbackGeneration++; player.pause(); player.clearMediaItems(); sleepAt = 0; sleepEnd = false; player.setPauseAtEndOfMediaItems(false); break;
            case "shuffle": player.setShuffleModeEnabled(value == 1); break;
            case "repeat": player.setRepeatMode(Math.max(0, Math.min(2, (int)value))); break;
            case "speed": player.setPlaybackSpeed((float)Math.max(0.5, Math.min(2, value))); break;
            case "sleep": sleepEnd = value == -1; player.setPauseAtEndOfMediaItems(sleepEnd); sleepAt = value <= 0 ? 0 : System.currentTimeMillis() + (long)(value * 60000); break;
            case "radio-stop": stopRadio(); break;
            case "radio-retry": radioRetryAt = 0; refillRadio(); break;
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
    void publish() { if (FluxoAudioPlugin.visible) FluxoAudioPlugin.emit("state", state()); }
    @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) { return session; }
    @Override public void onTaskRemoved(Intent rootIntent) { if (player.getMediaItemCount() == 0 || (!isPlaybackOngoing() && !player.getPlayWhenReady())) stopSelf(); }
    @Override public void onDestroy() {
        persist(); handler.removeCallbacksAndMessages(null); instance = null;
        if (connectivity != null && networkCallback != null) connectivity.unregisterNetworkCallback(networkCallback);
        if (equalizer != null) equalizer.release();
        player.release(); session.release(); super.onDestroy();
    }
}

package com.fluxo.music.mobile;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;
import okhttp3.OkHttpClient;
import okhttp3.RequestBody;

public final class StreamResolver {
    public static final String AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36";
    public static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(18, TimeUnit.SECONDS)
        .callTimeout(28, TimeUnit.SECONDS).build();
    private static final Map<String, Cached> cache = new ConcurrentHashMap<>();
    private record Cached(String url, long expires) {}
    private static boolean initialized;

    public static synchronized void init() {
        if (initialized) return;
        NewPipe.init(new Downloader() {
            @Override public Response execute(Request request) throws IOException {
                okhttp3.Request.Builder builder = new okhttp3.Request.Builder().url(request.url())
                    .header("User-Agent", AGENT);
                for (Map.Entry<String, List<String>> header : request.headers().entrySet()) {
                    builder.removeHeader(header.getKey());
                    for (String value : header.getValue()) builder.addHeader(header.getKey(), value);
                }
                byte[] data = request.dataToSend();
                RequestBody body = data == null ? null : RequestBody.create(data, null);
                if (body == null && (request.httpMethod().equals("POST") || request.httpMethod().equals("PUT"))) {
                    body = RequestBody.create(new byte[0], null);
                }
                builder.method(request.httpMethod(), body);
                try (okhttp3.Response response = HTTP.newCall(builder.build()).execute()) {
                    if (response.code() == 429) throw new IOException("O provedor limitou as consultas. Tente mais tarde.");
                    return new Response(response.code(), response.message(), response.headers().toMultimap(),
                        response.body() == null ? "" : response.body().string(), response.request().url().toString());
                }
            }
        });
        initialized = true;
    }

    public static String resolve(String url) throws IOException {
        if (url == null || url.isBlank()) throw new IOException("Esta musica nao tem um endereco de audio.");
        if (!isPage(url)) return url;
        Cached hit = cache.get(url);
        if (hit != null && hit.expires > System.currentTimeMillis()) return hit.url;
        init();
        try {
            long started = android.os.SystemClock.elapsedRealtime();
            var extractor = NewPipe.getServiceByUrl(url).getStreamExtractor(url);
            extractor.fetchPage();
            AudioStream best = null;
            for (AudioStream stream : extractor.getAudioStreams()) {
                if (!stream.isUrl() || stream.getDeliveryMethod() != DeliveryMethod.PROGRESSIVE_HTTP) continue;
                // A moderate bitrate reduces startup time without selecting a video stream.
                if (best == null || score(stream) > score(best)) best = stream;
            }
            if (best == null) throw new IOException("O provedor nao disponibilizou audio para esta musica.");
            String result = best.getContent();
            android.util.Log.i("FluxoResolver", "Audio resolved in " + (android.os.SystemClock.elapsedRealtime() - started) + " ms, bitrate " + best.getAverageBitrate());
            cache.put(url, new Cached(result, System.currentTimeMillis() + 20 * 60 * 1000));
            return result;
        } catch (Exception e) {
            android.util.Log.e("FluxoResolver", "Audio extraction failed", e);
            throw new IOException("Nao foi possivel obter o audio. " + readable(e), e);
        }
    }

    private static int score(AudioStream stream) {
        int bitrate = stream.getAverageBitrate();
        return 200 - Math.abs(128 - (bitrate < 0 ? 128 : bitrate));
    }

    public static boolean isPage(String value) {
        try {
            String host = java.net.URI.create(value).getHost();
            if (host == null) return false;
            return host.equals("youtu.be") || host.equals("youtube.com") || host.endsWith(".youtube.com")
                || host.equals("soundcloud.com") || host.endsWith(".soundcloud.com")
                || host.endsWith(".bandcamp.com");
        } catch (Exception ignored) { return false; }
    }

    public static void invalidate(String url) { cache.remove(url); }

    public static JSONArray related(JSONObject seed) throws Exception {
        init();
        JSONArray result = new JSONArray();
        if (isPage(seed.optString("url"))) {
            try {
                var extractor = NewPipe.getServiceByUrl(seed.getString("url")).getStreamExtractor(seed.getString("url"));
                extractor.fetchPage();
                var related = extractor.getRelatedItems();
                if (related != null) for (InfoItem item : related.getItems()) {
                    if (item instanceof StreamInfoItem stream && stream.getDuration() > 30 && stream.getDuration() < 1800)
                        result.put(describe(stream, "youtube"));
                    if (result.length() >= 20) break;
                }
            } catch (Exception failure) { android.util.Log.w("FluxoRadio", "Related items unavailable", failure); }
        }
        if (result.length() == 0) {
            String topic = seed.optString("artist", "");
            if (topic.isBlank() || topic.equals("Arquivo local")) topic = seed.optString("title", "music");
            result = search(topic + " music", "youtube");
        }
        return result;
    }

    private static JSONObject describe(StreamInfoItem stream, String provider) throws Exception {
        return new JSONObject().put("id", Integer.toHexString(stream.getUrl().hashCode()))
            .put("url", stream.getUrl()).put("title", stream.getName()).put("artist", stream.getUploaderName())
            .put("duration", stream.getDuration()).put("source", provider)
            .put("thumbnail", stream.getThumbnails().isEmpty() ? "" : stream.getThumbnails().get(0).getUrl());
    }

    public static JSONArray search(String query, String provider) throws Exception {
        init();
        var service = "soundcloud".equals(provider) ? ServiceList.SoundCloud : ServiceList.YouTube;
        var extractor = service.getSearchExtractor(query, Collections.singletonList("all"), "");
        extractor.fetchPage();
        JSONArray result = new JSONArray();
        for (InfoItem item : extractor.getInitialPage().getItems()) {
            if (!(item instanceof StreamInfoItem stream)) continue;
            if (stream.getDuration() <= 0) continue;
            result.put(describe(stream, provider));
            if (result.length() == 30) break;
        }
        return result;
    }

    public static String readable(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) return "Verifique sua conexao e tente novamente.";
        return message.length() > 230 ? message.substring(0, 230) : message;
    }
}

package com.fluxo.music.mobile;

import androidx.media3.common.C;
import androidx.media3.exoplayer.audio.TeeAudioProcessor;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

@androidx.media3.common.util.UnstableApi
final class AudioMeter implements TeeAudioProcessor.AudioBufferSink {
    volatile float[] levels = new float[32];
    private int encoding;
    private long updated;

    @Override public void flush(int rate, int channels, int encoding) {
        this.encoding = encoding;
        levels = new float[32];
    }

    @Override public void handleBuffer(ByteBuffer input) {
        if (!FluxoAudioPlugin.visible) return;
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - updated < 70) return;
        updated = now;
        int width = encoding == C.ENCODING_PCM_16BIT ? 2 : encoding == C.ENCODING_PCM_FLOAT ? 4 : 0;
        if (width == 0 || input.remaining() < width * 32) return;
        ByteBuffer buffer = input.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        int count = buffer.remaining() / width;
        float[] next = new float[32];
        for (int band = 0; band < next.length; band++) {
            double sum = 0;
            int start = count * band / next.length;
            int end = count * (band + 1) / next.length;
            int step = Math.max(1, (end - start) / 24);
            int samples = 0;
            for (int sample = start; sample < end; sample += step) {
                int position = buffer.position() + sample * width;
                float amplitude = width == 2 ? buffer.getShort(position) / 32768f : buffer.getFloat(position);
                sum += amplitude * amplitude;
                samples++;
            }
            next[band] = (float)Math.min(1, Math.sqrt(sum / Math.max(1, samples)) * 3.5);
        }
        levels = next;
    }
}

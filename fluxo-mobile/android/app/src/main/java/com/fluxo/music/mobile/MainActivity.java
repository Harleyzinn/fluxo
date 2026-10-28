package com.fluxo.music.mobile;

import android.os.Bundle;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private boolean foreground, rendererLost;
    private static int recoveryCount;
    private static long recoveryWindow;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FluxoAudioPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 26 && getBridge() != null) getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                AudioDiagnostics.record("webview", "renderer_gone", "reason", detail.didCrash() ? 1 : 0);
                rendererLost = true; FluxoAudioPlugin.visible = false;
                // Retire the bridge before lifecycle callbacks can touch the dead WebView.
                var retired = MainActivity.this.bridge; MainActivity.this.bridge = null;
                if (retired != null) retired.onDestroy();
                if (view.getParent() instanceof ViewGroup parent) parent.removeView(view);
                view.destroy();
                if (foreground) new Handler(Looper.getMainLooper()).post(MainActivity.this::recoverRenderer);
                return true;
            }
        });
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (getBridge() == null) { moveTaskToBack(true); return; }
                getBridge().getWebView().evaluateJavascript(
                    "window.fluxoBack?.() || false",
                    handled -> { if (!"true".equals(handled)) moveTaskToBack(true); });
            }
        });
    }
    @Override public void onResume() {
        super.onResume(); foreground = true;
        if (rendererLost) recoverRenderer();
    }
    @Override public void onPause() { foreground = false; super.onPause(); }
    private void recoverRenderer() {
        if (!rendererLost || isFinishing() || isDestroyed()) return;
        long now = SystemClock.elapsedRealtime();
        if (now - recoveryWindow > 60000) { recoveryCount = 0; recoveryWindow = now; }
        if (recoveryCount++ < 2) { rendererLost = false; recreate(); return; }
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(android.view.Gravity.CENTER); layout.setPadding(32, 32, 32, 32);
        TextView message = new TextView(this); message.setText("A interface foi encerrada pelo Android."); message.setTextSize(18);
        Button retry = new Button(this); retry.setText("Reabrir interface");
        retry.setOnClickListener(view -> { recoveryCount = 0; recoveryWindow = SystemClock.elapsedRealtime(); recoverRenderer(); });
        layout.addView(message); layout.addView(retry); setContentView(layout);
    }
}

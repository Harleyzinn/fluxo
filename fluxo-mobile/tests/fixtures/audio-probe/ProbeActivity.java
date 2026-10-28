package com.fluxo.qa.audio;

public class ProbeActivity extends android.app.Activity {
    @Override public void onCreate(android.os.Bundle state) {
        super.onCreate(state);
        android.widget.TextView label = new android.widget.TextView(this);
        label.setText("External audio test fixture"); setContentView(label);
        android.content.Intent intent = new android.content.Intent(this, ProbeService.class);
        intent.putExtra("focus", getIntent().getIntExtra("focus", 1));
        if (android.os.Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
    }
}

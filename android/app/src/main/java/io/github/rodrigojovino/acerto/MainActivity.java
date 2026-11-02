package io.github.rodrigojovino.acerto;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local do teste experimental "abrir nota no app" (registrado antes da ponte).
        registerPlugin(NotaWebViewPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

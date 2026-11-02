package io.github.rodrigojovino.acerto;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.util.ArrayList;

/**
 * Teste experimental: abre a página oficial da nota (SEFAZ-SP) num WebView do
 * próprio app, visível e em tela cheia, com botão para fechar. É o mesmo
 * WebView que uma leitura futura usaria: configurações padrão do Android
 * (JavaScript e armazenamento ligados, como num navegador), User-Agent padrão,
 * nenhum cabeçalho a mais. Não lê o conteúdo da página: só anota o que o
 * próprio WebView informa sobre a página principal (terminou de carregar,
 * código HTTP de erro ou falha de rede), para mostrar ao fechar.
 */
public class NotaWebViewActivity extends AppCompatActivity {

    static final String EXTRA_URL = "url";
    static final String EXTRA_EVENTS = "events";

    private final ArrayList<String> events = new ArrayList<>();
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_URL);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(32, 16, 16, 16);
        TextView title = new TextView(this);
        title.setText("Teste: nota na SEFAZ");
        title.setTextSize(16);
        title.setTextColor(Color.parseColor("#1C1C1A"));
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button close = new Button(this);
        close.setText("Fechar");
        close.setOnClickListener((v) -> finishWithEvents());
        bar.addView(close);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        // Como num navegador: a página da SEFAZ usa JavaScript. O User-Agent fica o padrão (sem disfarce).
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String loadedUrl) {
                events.add("loaded");
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) events.add("http:" + response.getStatusCode());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) events.add("error:" + error.getDescription());
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // Áreas seguras (Android 15+ edge-to-edge): barra de status e navegação.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finishWithEvents();
            }
        });

        setContentView(root);
        // Uma abertura por toque: carrega uma vez, sem repetir sozinho.
        if (url != null) webView.loadUrl(url);
    }

    private void finishWithEvents() {
        Intent data = new Intent();
        data.putStringArrayListExtra(EXTRA_EVENTS, events);
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}

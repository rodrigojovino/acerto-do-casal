package io.github.rodrigojovino.acerto;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
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
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import java.util.ArrayList;
import java.util.Collections;
import org.json.JSONTokener;

/**
 * Leitura da página oficial da nota (SEFAZ-SP) num WebView do próprio app,
 * visível e em tela cheia, com botão para fechar: a reserva quando o servidor
 * não consegue consultar. Configurado como um navegador comum: JavaScript e
 * armazenamento ligados, cookies aceitos (inclusive de terceiros, que o WebView
 * recusa por padrão) e gravados no disco ao fechar, sem o cabeçalho
 * X-Requested-With quando o WebView permite, User-Agent padrão. Nunca apaga
 * cookies nem recria a sessão: entre aberturas vale a sessão anterior, como
 * num navegador. Lê o HTML uma vez, quando a página termina de carregar, e
 * fecha cerca de 1 s depois; anota o que o WebView informa sobre a página
 * principal (carregou, código HTTP de erro, falha de rede, tempo esgotado).
 */
public class NotaWebViewActivity extends AppCompatActivity {

    static final String EXTRA_URL = "url";
    static final String EXTRA_EVENTS = "events";
    /** Tempo que sobra do limite do formulário; esgotado, fecha (plano B). */
    static final String EXTRA_TIMEOUT_MS = "timeoutMs";

    /**
     * HTML lido (fora do Intent, que tem limite de tamanho).
     * O plugin pega e limpa ao fechar.
     */
    static volatile String readHtml = null;

    private final ArrayList<String> events = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private boolean read = false;
    private boolean finished = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String url = getIntent().getStringExtra(EXTRA_URL);
        readHtml = null;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(32, 16, 16, 16);
        TextView title = new TextView(this);
        title.setText("Lendo a nota na SEFAZ…");
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

        // Cookies como num navegador: aceitos, inclusive de terceiros (o WebView recusa por padrão).
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        // O navegador não envia X-Requested-With (o WebView pode enviar o nome do pacote do app).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(settings, Collections.emptySet());
        }
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String loadedUrl) {
                events.add("loaded");
                // Uma leitura só, da página que a pessoa está vendo; fecha ~1 s depois.
                if (!read) {
                    read = true;
                    view.evaluateJavascript("document.documentElement.outerHTML", (value) -> {
                        try {
                            Object decoded = new JSONTokener(value).nextValue();
                            if (decoded instanceof String) readHtml = (String) decoded;
                        } catch (Exception ignored) {
                            readHtml = null;
                        }
                        handler.postDelayed(() -> finishWithEvents(), 1000);
                    });
                }
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
        // Esgotado o tempo que sobra do limite, fecha (o formulário segue no plano B).
        long timeoutMs = getIntent().getLongExtra(EXTRA_TIMEOUT_MS, 0);
        if (timeoutMs > 0) {
            handler.postDelayed(() -> {
                if (!read) {
                    events.add("timeout");
                    finishWithEvents();
                }
            }, timeoutMs);
        }
    }

    private void finishWithEvents() {
        if (finished) return;
        finished = true;
        handler.removeCallbacksAndMessages(null);
        // Como o navegador: a sessão fica guardada no disco (nada é apagado).
        CookieManager.getInstance().flush();
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

package io.github.rodrigojovino.acerto;

import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;

/**
 * Página oficial da NFC-e de SP: leitura no WebView do próprio app
 * (NotaWebViewActivity), a reserva quando o servidor não consegue consultar, ou
 * abertura no navegador do celular ("Ver a nota na SEFAZ"). Só aceita a página
 * de consulta da SEFAZ-SP.
 */
@CapacitorPlugin(name = "NotaWebView")
public class NotaWebViewPlugin extends Plugin {

    private static final String SEFAZ_SP = "https://www.nfce.fazenda.sp.gov.br/";

    private String sefazUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith(SEFAZ_SP)) {
            call.reject("Só a página de consulta da SEFAZ-SP.");
            return null;
        }
        return url;
    }

    /**
     * Leitura: abre a página no WebView do app, visível, uma vez; lê o
     * HTML quando ela termina de carregar e fecha sozinho. Resolve com o HTML
     * (ou null: bloqueio, falha, tempo esgotado ou fechado antes) e o que o
     * WebView informou. `timeoutMs`: o que sobra do limite do formulário.
     */
    @PluginMethod
    public void read(PluginCall call) {
        String url = sefazUrl(call);
        if (url == null) return;
        Intent intent = new Intent(getContext(), NotaWebViewActivity.class);
        intent.putExtra(NotaWebViewActivity.EXTRA_URL, url);
        intent.putExtra(NotaWebViewActivity.EXTRA_TIMEOUT_MS, (long) call.getInt("timeoutMs", 10000));
        startActivityForResult(call, intent, "onRead");
    }

    @ActivityCallback
    private void onRead(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ArrayList<String> events = result.getData() != null
            ? result.getData().getStringArrayListExtra(NotaWebViewActivity.EXTRA_EVENTS)
            : null;
        JSObject ret = new JSObject();
        String html = NotaWebViewActivity.readHtml;
        NotaWebViewActivity.readHtml = null;
        ret.put("html", html);
        ret.put("events", events != null ? new JSArray(events) : new JSArray());
        call.resolve(ret);
    }

    /** "Ver a nota na SEFAZ": abre a URL no navegador padrão do celular. */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = sefazUrl(call);
        if (url == null) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}

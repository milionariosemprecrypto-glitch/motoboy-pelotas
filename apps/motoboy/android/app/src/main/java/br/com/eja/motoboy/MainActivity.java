package br.com.eja.motoboy;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private int tentativasInsets = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Ícones brancos no status (mapa claro ganha um véu escuro no CSS) e escuros na barra de baixo, que fica sobre a folha branca.
        WindowInsetsControllerCompat ctrl = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (ctrl != null) {
            ctrl.setAppearanceLightStatusBars(false);
            ctrl.setAppearanceLightNavigationBars(true);
        }
        View decor = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            publicarInsets(bars.top, bars.bottom, bars.left, bars.right, ime.bottom);
            return insets;
        });
        decor.post(() -> ViewCompat.requestApplyInsets(decor));
    }

    @Override
    public void onResume() {
        super.onResume();
        View decor = getWindow().getDecorView();
        decor.post(() -> ViewCompat.requestApplyInsets(decor));
    }

    private void publicarInsets(int top, int bottom, int left, int right, int ime) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            if (tentativasInsets++ < 8) {
                getWindow().getDecorView().postDelayed(() -> ViewCompat.requestApplyInsets(getWindow().getDecorView()), 250);
            }
            return;
        }
        tentativasInsets = 0;
        WebView web = getBridge().getWebView();
        float d = getResources().getDisplayMetrics().density;
        if (d <= 0f) d = 1f;
        final String js = "document.documentElement.style.setProperty('--eja-sat','" + (top / d) + "px');"
                + "document.documentElement.style.setProperty('--eja-sab','" + (bottom / d) + "px');"
                + "document.documentElement.style.setProperty('--eja-sal','" + (left / d) + "px');"
                + "document.documentElement.style.setProperty('--eja-sar','" + (right / d) + "px');"
                + "document.documentElement.style.setProperty('--eja-ime','" + (ime / d) + "px');"
                + "window.dispatchEvent(new Event('eja-insets'));";
        web.post(() -> web.evaluateJavascript(js, null));
    }
}

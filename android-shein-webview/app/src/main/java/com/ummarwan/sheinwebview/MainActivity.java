package com.ummarwan.sheinwebview;

import android.annotation.SuppressLint;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private View homePanel;
    private View saveButton;
    private ProgressBar progressBar;
    private volatile boolean reviewOpening;
    private volatile String currentPageUrl = "";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        homePanel = findViewById(R.id.homePanel);
        webView = findViewById(R.id.webView);
        saveButton = findViewById(R.id.saveFloatingButton);
        progressBar = findViewById(R.id.progressBar);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.getSettings().setSaveFormData(false);
        webView.getSettings().setGeolocationEnabled(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new SheinBridge(), "UmMarwanBridge");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                progressBar.setProgress(progress);
                progressBar.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (SheinUrlPolicy.isAllowed(url)) return false;
                Toast.makeText(MainActivity.this, "تم منع فتح رابط خارج SHEIN ونظام أم مروان", Toast.LENGTH_LONG).show();
                return true;
            }

            @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                reviewOpening = false;
                currentPageUrl = url;
                updateSaveButton(url);
            }

            @Override public void onPageFinished(WebView view, String url) {
                currentPageUrl = url;
                updateSaveButton(url);
                if (SheinUrlPolicy.isShein(url)) view.evaluateJavascript(SHEIN_CAPTURE_SCRIPT, null);
            }

            @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request,
                    int threatType, @NonNull SafeBrowsingResponse callback) {
                callback.backToSafety(true);
                Toast.makeText(MainActivity.this, "أوقف Android فتح الصفحة لأنها غير آمنة", Toast.LENGTH_LONG).show();
            }
        });

        findViewById(R.id.openSheinButton).setOnClickListener(v -> openWeb(SheinUrlPolicy.SHEIN_HOME));
        findViewById(R.id.openAccountsButton).setOnClickListener(v -> openWeb(SheinUrlPolicy.APP_ORIGIN));
        saveButton.setOnClickListener(v -> captureCurrentProduct());

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView.getVisibility() == View.VISIBLE && webView.canGoBack()) webView.goBack();
                else if (webView.getVisibility() == View.VISIBLE) showHome();
                else finish();
            }
        });
    }

    private void openWeb(String url) {
        homePanel.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        updateSaveButton(url);
        webView.loadUrl(url);
    }

    private void showHome() {
        webView.setVisibility(View.GONE);
        saveButton.setVisibility(View.GONE);
        homePanel.setVisibility(View.VISIBLE);
    }

    private void updateSaveButton(String url) {
        saveButton.setVisibility(SheinUrlPolicy.isShein(url) ? View.VISIBLE : View.GONE);
    }

    private void captureCurrentProduct() {
        if (!SheinUrlPolicy.isShein(webView.getUrl())) {
            Toast.makeText(this, "افتحي صفحة منتج SHEIN أولًا", Toast.LENGTH_SHORT).show();
            return;
        }
        webView.evaluateJavascript("window.__umMarwanCapture && window.__umMarwanCapture('manual')", null);
    }

    private void openReview(JSONObject payload) {
        if (reviewOpening) return;
        reviewOpening = true;
        try {
            payload.put("source", "shein-android-webview");
            payload.put("receipt_token", UUID.randomUUID().toString().replace("-", ""));
            String encoded = Base64.encodeToString(payload.toString().getBytes(StandardCharsets.UTF_8),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            String reviewUrl = SheinUrlPolicy.APP_ORIGIN + "/import/shein?data=" + encoded;
            runOnUiThread(() -> {
                Toast.makeText(this, "راجعي بيانات القطعة قبل الحفظ", Toast.LENGTH_SHORT).show();
                webView.loadUrl(reviewUrl);
            });
        } catch (JSONException error) {
            reviewOpening = false;
            runOnUiThread(() -> Toast.makeText(this, "تعذر تجهيز بيانات القطعة", Toast.LENGTH_LONG).show());
        }
    }

    public final class SheinBridge {
        @JavascriptInterface public void onProductCaptured(String json, String reason) {
            if (!SheinUrlPolicy.isShein(currentPageUrl)) return;
            try {
                JSONObject payload = new JSONObject(json);
                String capturedUrl = payload.optString("product_url", "");
                if (!SheinUrlPolicy.isShein(capturedUrl)) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this,
                            "تعذر التحقق من رابط المنتج. افتحي صفحة المنتج وحاولي مجددًا.", Toast.LENGTH_LONG).show());
                    return;
                }
                if (payload.optString("product_name").isEmpty()) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this,
                            "لم يستطع التطبيق قراءة اسم المنتج. غيّرت SHEIN الصفحة أو أنك لستِ داخل منتج.", Toast.LENGTH_LONG).show());
                    return;
                }
                openReview(payload);
            } catch (JSONException error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "تعذر قراءة بيانات SHEIN؛ استخدمي صفحة المنتج نفسها.", Toast.LENGTH_LONG).show());
            }
        }
    }

    private static final String SHEIN_CAPTURE_SCRIPT = """
        (() => {
          if (window.__umMarwanCaptureInstalled) return;
          window.__umMarwanCaptureInstalled = true;
          const clean = v => String(v || '').trim().replace(/\\s+/g, ' ');
          const text = (root, selectors) => {
            for (const selector of selectors) {
              const el = root.querySelector(selector);
              const value = clean(el?.getAttribute('aria-label') || el?.textContent);
              if (value) return value;
            }
            return '';
          };
          const selected = (root, selectors) => {
            for (const selector of selectors) {
              const nodes = [...root.querySelectorAll(selector)];
              const el = nodes.find(node => node.matches('[aria-checked="true"],[aria-selected="true"],.active,.selected,.is-selected'));
              const value = clean(el?.getAttribute('aria-label') || el?.textContent || el?.getAttribute('title'));
              if (value) return value;
            }
            return '';
          };
          const price = value => {
            const match = clean(value).replace(/,/g, '').match(/(?:US\\$|\\$|SAR|ر\\.?س\\.?)\\s*(\\d+(?:\\.\\d{1,2})?)/i);
            return match ? Number(match[1]) : '';
          };
          const hash = value => {
            let result = 2166136261;
            for (let i = 0; i < value.length; i += 1) {
              result ^= value.charCodeAt(i); result = Math.imul(result, 16777619);
            }
            return (result >>> 0).toString(36);
          };
          const absolute = value => { try { return value ? new URL(value, location.href).href : ''; } catch (_) { return ''; } };
          const visiblePrice = () => {
            const selectors = ['[aria-label^="Price "]','[data-testid*="price"]','.product-intro__head-mainprice','[class*="sale-price"]','[class*="salePrice"]'];
            for (const selector of selectors) {
              const nodes = [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
              for (const el of nodes) { const parsed = price(el.getAttribute('aria-label') || el.textContent); if (parsed !== '') return parsed; }
            }
            return '';
          };
          window.__umMarwanCapture = reason => {
            const name = clean(document.querySelector('h1')?.textContent || document.querySelector('meta[property="og:title"]')?.content);
            const image = absolute(document.querySelector('meta[property="og:image"]')?.content || document.querySelector('main img')?.currentSrc || document.querySelector('main img')?.src);
            const color = selected(document, ['[data-attr-name*="Color" i] [role="radio"]','[aria-label*="Color" i] [role="radio"]','[class*="color"] [role="radio"]','[class*="color"] li']);
            const size = selected(document, ['[data-attr-name*="Size" i] [role="radio"]','[aria-label*="Size" i] [role="radio"]','[class*="size"] [role="radio"]','[class*="size"] li']);
            const quantityNode = document.querySelector('input[aria-label="Quantity input"], input[type="number"][class*="quant" i]');
            const quantity = Number(quantityNode?.value) > 0 ? Number(quantityNode.value) : 1;
            const skuText = text(document, ['[data-testid*="sku" i]','[class*="sku" i]']);
            const sku = skuText.match(/(?:SKU|رمز المنتج)\\s*[:：]?\\s*([\\w-]+)/i)?.[1] || '';
            const productUrl = location.href.split('#')[0];
            const amount = visiblePrice();
            const identity = [sku, location.hostname + location.pathname, name, image].join('|').toLowerCase();
            const mutable = [color, size, amount, quantity].join('|').toLowerCase();
            const payload = {
              product_name: name, product_url: productUrl, image_url: image,
              color, size, quantity, price: amount, sku,
              sync_key: 'shein:android:v1:' + hash(identity) + ':' + hash(identity.split('').reverse().join('')),
              source_signature: 'v1:' + hash(mutable)
            };
            UmMarwanBridge.onProductCaptured(JSON.stringify(payload), reason || 'manual');
          };
          let pending = null;
          const cartSignal = () => /added to (?:your )?(?:bag|cart)|تمت الإضافة إلى (?:الحقيبة|السلة)/i.test(document.body.innerText || '');
          document.addEventListener('click', event => {
            const button = event.target.closest('button,[role="button"]');
            if (!button || !/add to (?:bag|cart)|أضف إلى (?:الحقيبة|السلة)/i.test(clean(button.textContent || button.getAttribute('aria-label')))) return;
            pending = { hadSignal: cartSignal(), at: Date.now() };
            setTimeout(() => {
              if (pending && !pending.hadSignal && cartSignal()) {
                pending = null; window.__umMarwanCapture('verified-add-to-cart');
              }
            }, 1200);
            setTimeout(() => { pending = null; }, 4500);
          }, true);
          const observer = new MutationObserver(() => {
            if (pending && !pending.hadSignal && cartSignal() && Date.now() - pending.at < 4500) {
              pending = null; window.__umMarwanCapture('verified-add-to-cart');
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        })();
        """;

    @Override protected void onDestroy() {
        webView.removeJavascriptInterface("UmMarwanBridge");
        webView.destroy();
        super.onDestroy();
    }
}

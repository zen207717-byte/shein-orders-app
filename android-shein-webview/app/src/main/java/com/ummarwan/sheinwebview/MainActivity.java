package com.ummarwan.sheinwebview;

import android.annotation.SuppressLint;
import android.content.Intent;
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
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public class MainActivity extends AppCompatActivity {
    private WebView sheinView, accountsView;
    private MaterialButton saveButton;
    private ProgressBar progress;
    private JSONObject pendingProduct, savedItem;
    private boolean accountsLoaded;
    private boolean productPageDetected;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); setContentView(R.layout.activity_main);
        sheinView = findViewById(R.id.sheinWebView); accountsView = findViewById(R.id.accountsWebView);
        saveButton = findViewById(R.id.saveFloatingButton); progress = findViewById(R.id.progressBar);
        configure(sheinView, true); configure(accountsView, false);
        try {
            String restored = getPreferences(MODE_PRIVATE).getString("pending_saved_item", "");
            if (!restored.isEmpty()) savedItem = new JSONObject(restored);
        } catch (Exception ignored) {}
        findViewById(R.id.tabShein).setOnClickListener(v -> showShein());
        findViewById(R.id.tabAccounts).setOnClickListener(v -> showAccounts(null));
        saveButton.setOnClickListener(v -> {
            if (savedItem != null && "pending_shein_cart".equals(savedItem.optString("status"))) manualConfirm();
            else sheinView.evaluateJavascript("window.__umMarwanCapture&&window.__umMarwanCapture('manual')", null);
        });
        sheinView.loadUrl(SheinUrlPolicy.SHEIN_HOME);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                WebView active = accountsView.getVisibility() == View.VISIBLE ? accountsView : sheinView;
                if (active.canGoBack()) active.goBack(); else finish();
            }
        });
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configure(WebView view, boolean shein) {
        view.getSettings().setJavaScriptEnabled(true); view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setAllowFileAccess(false); view.getSettings().setAllowContentAccess(false);
        view.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        view.getSettings().setSaveFormData(false); view.getSettings().setGeolocationEnabled(false);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        view.addJavascriptInterface(new AppBridge(shein), "UmMarwanBridge");
        view.setWebChromeClient(new WebChromeClient() { @Override public void onProgressChanged(WebView v, int n) {
            if (v.getVisibility() == View.VISIBLE) { progress.setProgress(n); progress.setVisibility(n < 100 ? View.VISIBLE : View.GONE); }
        }});
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                String url = request.getUrl().toString();
                boolean allowed = shein ? SheinUrlPolicy.isShein(url) : url.startsWith(SheinUrlPolicy.APP_ORIGIN);
                if (!allowed) Toast.makeText(MainActivity.this, "تم منع رابط خارج القسم الآمن", Toast.LENGTH_LONG).show();
                return !allowed;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
                if (shein) productPageDetected = false;
                updateAction();
            }
            @Override public void onPageFinished(WebView v, String url) {
                updateAction(); if (shein && SheinUrlPolicy.isShein(url)) v.evaluateJavascript(CAPTURE_SCRIPT, null);
            }
            @Override public void onSafeBrowsingHit(WebView v, WebResourceRequest r, int t, @NonNull SafeBrowsingResponse cb) {
                cb.backToSafety(true); Toast.makeText(MainActivity.this, "أوقف Android صفحة غير آمنة", Toast.LENGTH_LONG).show();
            }
        });
    }

    private void showShein() {
        accountsView.setVisibility(View.GONE); sheinView.setVisibility(View.VISIBLE); updateAction();
    }
    private void showAccounts(String url) {
        sheinView.setVisibility(View.GONE); accountsView.setVisibility(View.VISIBLE); saveButton.setVisibility(View.GONE);
        if (url != null) { accountsLoaded = true; accountsView.loadUrl(url); }
        else if (!accountsLoaded) { accountsLoaded = true; accountsView.loadUrl(SheinUrlPolicy.APP_ORIGIN); }
    }
    private void updateAction() {
        boolean visible = sheinView.getVisibility() == View.VISIBLE && productPageDetected;
        saveButton.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (visible) saveButton.setText(savedItem != null && "pending_shein_cart".equals(savedItem.optString("status"))
                ? "تأكيد الإضافة إلى سلة SHEIN" : "إضافة لنظام أم مروان");
    }

    private void openReview(JSONObject payload) {
        try {
            pendingProduct = payload; payload.put("source", "shein-android-webview");
            payload.put("receipt_token", UUID.randomUUID().toString().replace("-", ""));
            String encoded = Base64.encodeToString(payload.toString().getBytes(StandardCharsets.UTF_8),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            showAccounts(SheinUrlPolicy.APP_ORIGIN + "/import/shein?data=" + encoded);
        } catch (JSONException error) { Toast.makeText(this, "تعذر تجهيز بيانات القطعة", Toast.LENGTH_LONG).show(); }
    }

    private boolean sameVariant(JSONObject captured, JSONObject saved) {
        String[] keys = {"product_url", "sku", "color", "size"};
        for (String key : keys) {
            String a = captured.optString(key, "").trim(), b = saved.optString(key, "").trim();
            if (!a.isEmpty() && !b.isEmpty() && !a.equalsIgnoreCase(b)) return false;
        }
        return captured.optInt("quantity", 1) == saved.optInt("quantity", 1);
    }
    private void confirmCart(JSONObject captured, boolean automatic) {
        if (savedItem == null || !sameVariant(captured, savedItem)) {
            Toast.makeText(this, "لم تتطابق القطعة مع آخر طلب محفوظ؛ لم تتغير الحالة", Toast.LENGTH_LONG).show(); return;
        }
        int id = savedItem.optInt("id");
        accountsView.evaluateJavascript("window.__umMarwanConfirmSheinCart&&window.__umMarwanConfirmSheinCart(" + id + ")", null);
        if (!automatic) Toast.makeText(this, "جارٍ تأكيد الإضافة…", Toast.LENGTH_SHORT).show();
    }
    private void manualConfirm() {
        new AlertDialog.Builder(this).setTitle("تأكيد الإضافة")
                .setMessage("هل ضغطتِ Add to Cart وظهرت رسالة نجاح أو زاد رقم السلة؟")
                .setPositiveButton("نعم، تأكيد", (d,w) -> sheinView.evaluateJavascript("window.__umMarwanCapture&&window.__umMarwanCapture('manual-cart-confirm')", null))
                .setNegativeButton("إلغاء", null).show();
    }
    private void share(JSONObject item) {
        String text = "تأكيد طلبك — " + item.optString("customer_name", "الزبون") + "\n\nالمنتج: " + item.optString("product_name")
                + "\nاللون: " + item.optString("color") + "\nالمقاس: " + item.optString("size")
                + "\nالكمية: " + item.optInt("quantity",1) + "\nالسعر: " + item.optDouble("customer_unit_price",0)
                + "\nرابط المنتج: " + item.optString("product_url") + "\n\nيرجى التأكد من اللون والمقاس والكمية.";
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        startActivity(Intent.createChooser(send, "مشاركة مع الزبون"));
        accountsView.evaluateJavascript("window.__umMarwanMarkCustomerConfirmed&&window.__umMarwanMarkCustomerConfirmed(" + item.optInt("id") + ")", null);
    }

    public final class AppBridge {
        private final boolean sheinSource;
        AppBridge(boolean sheinSource) { this.sheinSource = sheinSource; }
        @JavascriptInterface public void onPageClassification(String url, boolean hasProductId,
                boolean hasTitle, boolean hasCurrentPrice, boolean hasAddToCart) {
            if (!sheinSource) return;
            boolean detected = SheinExtractionPolicy.shouldShowProductAction(url, hasProductId,
                    hasTitle, hasCurrentPrice, hasAddToCart);
            runOnUiThread(() -> { productPageDetected = detected; updateAction(); });
        }
        @JavascriptInterface public void onProductCaptured(String json, String reason) {
            if (!sheinSource) return;
            runOnUiThread(() -> { try {
                JSONObject p = new JSONObject(json);
                if (!SheinExtractionPolicy.isProductUrl(p.optString("product_url")) || p.optString("product_name").isEmpty()) {
                    Toast.makeText(MainActivity.this, "افتحي صفحة المنتج نفسها ثم حاولي مجددًا", Toast.LENGTH_LONG).show(); return;
                }
                if ("verified-add-to-cart".equals(reason) || "manual-cart-confirm".equals(reason)) confirmCart(p, reason.startsWith("verified"));
                else openReview(p);
            } catch (Exception e) { Toast.makeText(MainActivity.this, "تعذر قراءة بيانات المنتج", Toast.LENGTH_LONG).show(); }});
        }
        @JavascriptInterface public void onOrderSaved(String json) { if (sheinSource) return; runOnUiThread(() -> { try {
            savedItem = new JSONObject(json);
            getPreferences(MODE_PRIVATE).edit().putString("pending_saved_item", savedItem.toString()).apply();
            showSaveDialog();
        } catch (Exception ignored) {} }); }
        @JavascriptInterface public void onCartConfirmed(String json) { if (sheinSource) return; runOnUiThread(() -> { try {
            savedItem = new JSONObject(json);
            getPreferences(MODE_PRIVATE).edit().remove("pending_saved_item").apply();
            String name = savedItem.optString("customer_name", "الزبون");
            Toast.makeText(MainActivity.this, "تمت إضافة طلب " + name + " إلى سلة SHEIN ✓", Toast.LENGTH_LONG).show(); showShein();
        } catch (Exception ignored) {} }); }
    }
    private void showSaveDialog() {
        new AlertDialog.Builder(this).setTitle("تم حفظ طلب الزبون")
                .setMessage("تم حفظ طلب الزبون.\nباقي إضافة القطعة إلى سلة SHEIN.")
                .setPositiveButton("الرجوع إلى SHEIN وإكمال الإضافة", (d,w) -> showShein())
                .setNeutralButton("مشاركة مع الزبون", (d,w) -> share(savedItem))
                .setNegativeButton("لاحقًا", null).show();
    }

    private static final String CAPTURE_SCRIPT = """
      (()=>{ if(window.__umInstalled)return; window.__umInstalled=1;
      const clean=v=>String(v||'').trim().replace(/\\s+/g,' '), vis=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const abs=v=>{try{return v?new URL(v,location.href).href:''}catch(e){return''}};
      const badImg=u=>!/https:\\/\\//i.test(u)||/\\/(logo|icon|avatar|sprite|tracking|pixel)\\b|logo\\/192/i.test(u);
      const selected=s=>{for(const q of s){const e=[...document.querySelectorAll(q)].find(x=>vis(x)&&x.matches('[aria-checked="true"],[aria-selected="true"],.active,.selected,.is-selected'));if(e)return clean(e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent)}return''};
      const parsePrice=v=>{const m=clean(v).replace(/,/g,'').match(/(?:US\\s*\\$|\\$)\\s*(\\d{1,7}(?:\\.\\d{1,2})?)/i);return m?Number(m[1]):''};
      const addButton=()=>[...document.querySelectorAll('button,[role="button"]')].find(e=>vis(e)&&/add to (bag|cart)|أضف إلى (الحقيبة|السلة)/i.test(clean(e.textContent||e.getAttribute('aria-label'))));
      const productRoot=()=>{const b=addButton();return b?.closest('[class*="product-intro"],[data-testid*="product"],main')||document.querySelector('main')||document};
      const price=()=>{const root=productRoot();for(const q of ['.product-intro__head-mainprice','[class*="sale-price"]','[class*="salePrice"]','[data-testid*="price"]','[aria-label^="Price "]'])for(const e of root.querySelectorAll(q))if(vis(e)&&!e.closest('del,s,[class*="old-price"],[class*="original-price"]')){for(const v of [e.getAttribute('aria-label'),e.textContent,e.parentElement?.textContent,e.parentElement?.parentElement?.textContent]){const n=parsePrice(v);if(n!=='')return n}}return''};
      const image=()=>{const a=[];document.querySelectorAll('main img,[class*="product"] img').forEach(e=>{if(vis(e)&&((e.naturalWidth||0)>=180||(e.width||0)>=180))a.push(abs(e.currentSrc||e.src))});a.push(abs(document.querySelector('meta[property="og:image"]')?.content));return a.find(u=>u&&!badImg(u))||''};
      const hash=v=>{let h=2166136261;for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
      const cartCount=()=>{for(const e of document.querySelectorAll('a[href*="cart" i] [class*="badge"],a[href*="cart" i] sup,[aria-label*="cart" i]')){const m=clean(e.textContent||e.getAttribute('aria-label')).match(/\\b(\\d{1,3})\\b/);if(m)return Number(m[1])}return null};
      const success=()=>[...document.querySelectorAll('a,button,[role="dialog"],div')].some(e=>vis(e)&&/^(view cart|view bag)|added to (your )?(cart|bag)|عرض السلة|تمت الإضافة/i.test(clean(e.textContent)));
      const classify=()=>{const url=location.href.split('#')[0],path=location.pathname,body=document.body.innerText||'';const hasId=/-p-\\d+/i.test(path)||/[?&]goods_id=\\d+/i.test(url)||/(?:goods[_ ]?id|product id)\\s*[:：]?\\s*\\w+/i.test(body);const hasTitle=!!clean(productRoot().querySelector('h1,[class*="title"]')?.textContent||document.querySelector('meta[property="og:title"]')?.content);UmMarwanBridge.onPageClassification(url,hasId,hasTitle,price()!=='',!!addButton())};
      const data=()=>{const url=location.href.split('#')[0], path=location.pathname;const pm=path.match(/-p-(\\d+)/i),gm=new URL(url).searchParams.get('goods_id');const sku=(document.body.innerText.match(/(?:SKU|Product ID|goods[_ ]?id)\\s*[:：]?\\s*([\\w-]+)/i)||[])[1]||gm||pm?.[1]||'';const name=clean(document.querySelector('main h1,h1,[class*="product"] [class*="title"]')?.textContent||document.querySelector('meta[property="og:title"]')?.content);const color=selected(['[data-attr-name*="Color" i] [role="radio"]','[aria-label*="Color" i][aria-checked]','[class*="color"] .active','[class*="color"] .selected']);const size=selected(['[data-attr-name*="Size" i] [role="radio"]','[aria-label*="Size" i][aria-checked]','[class*="size"] .active','[class*="size"] .selected']);const q=document.querySelector('input[aria-label="Quantity input"],input[type="number"][class*="quant" i]');const quantity=Math.max(1,Number(q?.value)||1),amount=price(),pic=image(),identity=[sku,location.host+path,color,size,quantity].join('|').toLowerCase();return{product_name:name,product_url:url,image_url:pic,color,size,quantity,price:amount,sku,sync_key:'shein:android:v2:'+hash(identity)+':'+hash(identity.split('').reverse().join('')),source_signature:'v2:'+hash([color,size,amount,quantity].join('|'))}};
      window.__umMarwanCapture=r=>UmMarwanBridge.onProductCaptured(JSON.stringify(data()),r||'manual');
      let pending=null;document.addEventListener('click',e=>{const b=e.target.closest('button,[role="button"]');if(!b||!/add to (bag|cart)|أضف إلى (الحقيبة|السلة)/i.test(clean(b.textContent||b.getAttribute('aria-label'))))return;pending={count:cartCount(),signal:success(),at:Date.now()};setTimeout(check,900);setTimeout(()=>pending=null,6000)},true);
      function check(){if(!pending)return;const count=cartCount(),ok=(count!==null&&pending.count!==null&&count>pending.count)||(!pending.signal&&success());if(ok){pending=null;UmMarwanBridge.onProductCaptured(JSON.stringify(data()),'verified-add-to-cart')}}
      let classifyTimer;new MutationObserver(()=>{check();clearTimeout(classifyTimer);classifyTimer=setTimeout(classify,180)}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
      classify();
      })();
      """;

    @Override protected void onDestroy() { sheinView.destroy(); accountsView.destroy(); super.onDestroy(); }
}

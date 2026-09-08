package com.ummarwan.sheinwebview;

import java.net.URI;
import java.net.URISyntaxException;

final class SheinUrlPolicy {
    static final String APP_ORIGIN = "https://shein-orders-app-1.onrender.com";
    static final String SHEIN_HOME = "https://us.shein.com/";

    private SheinUrlPolicy() {}

    static boolean isHttps(String value) {
        try {
            return "https".equalsIgnoreCase(new URI(value).getScheme());
        } catch (URISyntaxException | NullPointerException error) {
            return false;
        }
    }

    static boolean isShein(String value) {
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return isHttps(value) && host != null &&
                    (host.equalsIgnoreCase("shein.com") || host.toLowerCase().endsWith(".shein.com"));
        } catch (URISyntaxException | NullPointerException error) {
            return false;
        }
    }

    static boolean isAccounts(String value) {
        try {
            URI uri = new URI(value);
            return isHttps(value) && "shein-orders-app-1.onrender.com".equalsIgnoreCase(uri.getHost());
        } catch (URISyntaxException | NullPointerException error) {
            return false;
        }
    }

    static boolean isAllowed(String value) {
        return isShein(value) || isAccounts(value);
    }
}

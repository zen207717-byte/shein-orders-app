package com.ummarwan.sheinwebview;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class SheinExtractionPolicy {
    private static final Pattern PRICE = Pattern.compile("(?:US\\s*\\$|\\$)\\s*(\\d{1,7}(?:\\.\\d{1,2})?)", Pattern.CASE_INSENSITIVE);
    private SheinExtractionPolicy() {}
    public static double parseDollarPrice(String value) {
        Matcher match = PRICE.matcher(value == null ? "" : value.replace(",", ""));
        return match.find() ? Double.parseDouble(match.group(1)) : -1;
    }
    public static double chooseCurrentPrice(String primaryText, boolean primaryStruck,
            String fallbackText, boolean fallbackStruck) {
        if (!primaryStruck) {
            double primary = parseDollarPrice(primaryText);
            if (primary >= 0) return primary;
        }
        return fallbackStruck ? -1 : parseDollarPrice(fallbackText);
    }
    public static boolean isProductImage(String value) {
        if (value == null) return false;
        String url = value.toLowerCase(Locale.ROOT);
        return url.startsWith("https://") && !url.contains("/logo/") && !url.contains("icon")
                && !url.contains("avatar") && !url.contains("sprite") && !url.contains("tracking") && !url.contains("pixel");
    }
    public static boolean isProductUrl(String value) {
        try {
            URI url = new URI(value); String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
            String path = url.getPath() == null ? "" : url.getPath();
            return (host.equals("shein.com") || host.endsWith(".shein.com"))
                    && (path.matches(".*-p-\\d+.*") || path.toLowerCase(Locale.ROOT).contains("/product/"));
        } catch (Exception ignored) { return false; }
    }

    public static boolean shouldShowProductAction(String value, boolean hasProductId,
            boolean hasTitle, boolean hasCurrentPrice, boolean hasAddToCart) {
        try {
            URI url = new URI(value);
            String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
            String path = url.getPath() == null ? "" : url.getPath().toLowerCase(Locale.ROOT);
            if (!(host.equals("shein.com") || host.endsWith(".shein.com"))) return false;
            if (path.matches(".*(?:^|/)(?:cart|checkout|search|category|categories)(?:/|$).*")) return false;
            return hasTitle && hasCurrentPrice && hasAddToCart && (hasProductId || isProductUrl(value));
        } catch (Exception ignored) { return false; }
    }
}

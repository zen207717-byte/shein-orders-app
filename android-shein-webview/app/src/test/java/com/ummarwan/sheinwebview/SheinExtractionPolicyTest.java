package com.ummarwan.sheinwebview;

import org.junit.Test;
import static org.junit.Assert.*;

public class SheinExtractionPolicyTest {
    @Test public void parsesVisibleDollarPrice() {
        assertEquals(7.34, SheinExtractionPolicy.parseDollarPrice("$7.34"), 0.001);
        assertEquals(18.12, SheinExtractionPolicy.parseDollarPrice("$18.12"), 0.001);
        assertEquals(18.12, SheinExtractionPolicy.parseDollarPrice("US $18.12"), 0.001);
        assertEquals(18.12, SheinExtractionPolicy.parseDollarPrice("$ 18.12"), 0.001);
    }
    @Test public void rejectsSheinLogo() {
        assertFalse(SheinExtractionPolicy.isProductImage("https://m.shein.com/us/logo/192.png"));
        assertTrue(SheinExtractionPolicy.isProductImage("https://img.ltwebstatic.com/images3_pi/2026/item.webp"));
    }
    @Test public void rejectsTrackingFragmentAsProductUrl() {
        assertFalse(SheinExtractionPolicy.isProductUrl("https://m.shein.com/?ab_page_id=page_home"));
        assertTrue(SheinExtractionPolicy.isProductUrl("https://m.shein.com/example-p-123456.html?skucode=x"));
    }
    @Test public void productSignalsShowActionButCartAndCheckoutDoNot() {
        assertTrue(SheinExtractionPolicy.shouldShowProductAction(
                "https://m.shein.com/item-p-12345.html", true, true, true, true));
        assertFalse(SheinExtractionPolicy.shouldShowProductAction(
                "https://m.shein.com/cart", true, true, true, true));
        assertFalse(SheinExtractionPolicy.shouldShowProductAction(
                "https://m.shein.com/checkout", true, true, true, true));
        assertFalse(SheinExtractionPolicy.shouldShowProductAction(
                "https://m.shein.com/search", false, true, true, false));
    }
    @Test public void struckOldPriceDoesNotOverrideCurrentPrice() {
        assertEquals(7.34, SheinExtractionPolicy.chooseCurrentPrice("$12.99", true, "$7.34", false), 0.001);
    }
}

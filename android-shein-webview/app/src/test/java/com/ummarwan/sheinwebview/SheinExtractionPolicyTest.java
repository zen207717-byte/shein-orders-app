package com.ummarwan.sheinwebview;

import org.junit.Test;
import static org.junit.Assert.*;

public class SheinExtractionPolicyTest {
    @Test public void parsesVisibleDollarPrice() {
        assertEquals(18.12, SheinExtractionPolicy.parseDollarPrice("$18.12"), 0.001);
    }
    @Test public void rejectsSheinLogo() {
        assertFalse(SheinExtractionPolicy.isProductImage("https://m.shein.com/us/logo/192.png"));
        assertTrue(SheinExtractionPolicy.isProductImage("https://img.ltwebstatic.com/images3_pi/2026/item.webp"));
    }
    @Test public void rejectsTrackingFragmentAsProductUrl() {
        assertFalse(SheinExtractionPolicy.isProductUrl("https://m.shein.com/?ab_page_id=page_home"));
        assertTrue(SheinExtractionPolicy.isProductUrl("https://m.shein.com/example-p-123456.html?skucode=x"));
    }
}

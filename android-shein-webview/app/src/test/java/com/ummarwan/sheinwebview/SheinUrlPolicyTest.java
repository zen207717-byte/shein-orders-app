package com.ummarwan.sheinwebview;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SheinUrlPolicyTest {
    @Test public void acceptsOnlyHttpsSheinHosts() {
        assertTrue(SheinUrlPolicy.isShein("https://us.shein.com/item-p-1.html"));
        assertTrue(SheinUrlPolicy.isShein("https://onelink.shein.com/1/abc"));
        assertFalse(SheinUrlPolicy.isShein("http://us.shein.com/item"));
        assertFalse(SheinUrlPolicy.isShein("https://shein.com.evil.test/item"));
    }

    @Test public void acceptsOnlyPreviewAccountsHost() {
        assertTrue(SheinUrlPolicy.isAccounts("https://shein-orders-app-1.onrender.com/import/shein"));
        assertFalse(SheinUrlPolicy.isAccounts("https://shein-orders-app.onrender.com/"));
    }
}

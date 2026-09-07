# SHEIN Importer (local test extension)

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `shein-importer` folder.
5. Open a SHEIN product or cart page and press **حفظ هذه القطعة للزبونة**.

## Testing a Render branch service

Create a separate Render Web Service from the `feature/shein-importer` branch. Then open the
extension details page, choose **Extension options**, and enter that service's HTTPS URL. This
changes only the local extension target; the production service and `main` remain untouched.

The extension reads visible page fields only. It does not request cookie access, read passwords,
or contain an API key. Missing values remain blank for review in the app.

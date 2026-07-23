=== Affiliate Platform Connector ===
Contributors: affiliateplatform
Tags: affiliate, woocommerce, referral, tracking, commissions
Requires at least: 5.6
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect your WooCommerce store to the Affiliate Platform in one step. Captures referral cookies, self-registers your store, and pushes orders & refunds automatically.

== Description ==

The Affiliate Platform Connector links your WooCommerce store to your Affiliate Platform account so affiliate sales are tracked and commissions are calculated automatically.

Features:

* **1-step connect** — paste your API base URL and API key; the plugin self-registers the store.
* **Last-click attribution** — captures the `?ref=` (or `?aff=`) parameter into a 60-day `aff_ref` cookie and saves it to each order.
* **Automatic order sync** — completed and processing orders are pushed to the platform, including coupon code and referral code.
* **Refund sync** — refunds are reported so commissions are clawed back correctly.
* **Idempotent** — orders are never double-sent.

== Installation ==

1. In WordPress admin, go to **Plugins → Add New → Upload Plugin** and upload `affiliate-platform-woocommerce.zip`.
2. Click **Install Now**, then **Activate**.
3. Go to **WooCommerce → Affiliate Platform**.
4. Enter your **API base URL** (e.g. `https://api.your-platform.com/v1`) and an **API key** with the `stores.write` and `orders.write` scopes.
5. Click **Save & Connect**. You should see “Connected!” with your store ID.

== Frequently Asked Questions ==

= Where do I get an API key? =
In your Affiliate Platform dashboard under Settings → API keys. Grant the `stores.write` and `orders.write` scopes.

= How is a sale attributed to an affiliate? =
When a visitor arrives via an affiliate link (`?ref=CODE`), the code is stored in the `aff_ref` cookie for 60 days and attached to any order they place.

= Does it support High-Performance Order Storage (HPOS)? =
Yes. The plugin uses the WooCommerce CRUD order API (`wc_get_order`, order meta methods) which is HPOS-compatible.

== Changelog ==

= 1.0.0 =
* Initial release: self-registration, referral capture, order sync, refund sync, admin settings page.

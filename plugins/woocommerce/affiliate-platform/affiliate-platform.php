<?php
/**
 * Plugin Name: Affiliate Platform Connector
 * Plugin URI:  https://your-affiliate-platform.com
 * Description: Connects your WooCommerce store to the Affiliate Platform. Captures referral cookies, self-registers the store, and pushes orders & refunds automatically.
 * Version:     1.0.0
 * Author:      Affiliate Platform
 * License:     GPL-2.0+
 * Text Domain: affiliate-platform
 * Requires at least: 5.6
 * Requires PHP: 7.4
 * WC requires at least: 5.0
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

define('AFFP_COOKIE', 'aff_ref');
define('AFFP_CHANNEL_COOKIE', 'aff_channel');
define('AFFP_ADNET_COOKIE', 'aff_adnet');
define('AFFP_COOKIE_TTL', 60 * DAY_IN_SECONDS); // 60-day last-click window
define('AFFP_OPT', 'affp_settings');

/* ------------------------------------------------------------------ *
 * Settings helpers
 * ------------------------------------------------------------------ */

function affp_get_settings() {
    $defaults = array('api_base' => '', 'api_key' => '', 'store_id' => '', 'webhook_secret' => '');
    $saved = get_option(AFFP_OPT, array());
    return wp_parse_args(is_array($saved) ? $saved : array(), $defaults);
}

function affp_update_settings($patch) {
    $s = array_merge(affp_get_settings(), $patch);
    update_option(AFFP_OPT, $s);
    return $s;
}

function affp_api_base() {
    $s = affp_get_settings();
    return untrailingslashit(trim($s['api_base']));
}

/* ------------------------------------------------------------------ *
 * 1) Referral capture (?ref= -> aff_ref cookie, 60 days)
 * ------------------------------------------------------------------ */

add_action('init', 'affp_capture_referral');
function affp_capture_referral() {
    if (is_admin()) {
        return;
    }
    $ref = '';
    if (isset($_GET['ref'])) {
        $ref = sanitize_text_field(wp_unslash($_GET['ref']));
    } elseif (isset($_GET['aff'])) {
        $ref = sanitize_text_field(wp_unslash($_GET['aff']));
    }
    if ($ref !== '') {
        setcookie(AFFP_COOKIE, $ref, time() + AFFP_COOKIE_TTL, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN);
        $_COOKIE[AFFP_COOKIE] = $ref;
    }

    // Detect paid vs organic traffic from ad click-ids / utm_medium and store it.
    $ad_ids = array('gclid','gbraid','wbraid','gclsrc','dclid','fbclid','ttclid','msclkid','li_fat_id','twclid','epik','sccid');
    $networks = array('gclid'=>'google','gbraid'=>'google','wbraid'=>'google','gclsrc'=>'google','dclid'=>'google','fbclid'=>'meta','ttclid'=>'tiktok','msclkid'=>'microsoft','li_fat_id'=>'linkedin','twclid'=>'twitter','epik'=>'pinterest','sccid'=>'snapchat');
    $paid_mediums = array('cpc','ppc','paid','paidsocial','paid-social','paid_social','display','cpm','cpv','banner','retargeting','remarketing');
    $channel = '';
    $adnet = '';
    foreach ($ad_ids as $k) {
        if (!empty($_GET[$k])) { $channel = 'paid'; $adnet = isset($networks[$k]) ? $networks[$k] : ''; break; }
    }
    if ($channel === '' && isset($_GET['utm_medium'])) {
        $m = strtolower(sanitize_text_field(wp_unslash($_GET['utm_medium'])));
        if (in_array($m, $paid_mediums, true)) { $channel = 'paid'; }
    }
    if ($channel === '' && (isset($_GET['ref']) || isset($_GET['aff']) || isset($_GET['utm_source']))) { $channel = 'organic'; }
    if ($channel !== '') {
        setcookie(AFFP_CHANNEL_COOKIE, $channel, time() + AFFP_COOKIE_TTL, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN);
        $_COOKIE[AFFP_CHANNEL_COOKIE] = $channel;
        if ($adnet !== '') {
            setcookie(AFFP_ADNET_COOKIE, $adnet, time() + AFFP_COOKIE_TTL, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN);
            $_COOKIE[AFFP_ADNET_COOKIE] = $adnet;
        }
    }

    // Capture UTM parameters (first-touch) so the real ad source reaches the order.
    foreach (array('utm_source','utm_medium','utm_campaign','utm_term','utm_content') as $utk) {
        if (!empty($_GET[$utk])) {
            $uv = sanitize_text_field(wp_unslash($_GET[$utk]));
            $ck = 'aff_' . $utk;
            if (empty($_COOKIE[$ck])) {
                setcookie($ck, $uv, time() + AFFP_COOKIE_TTL, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN);
                $_COOKIE[$ck] = $uv;
            }
        }
    }
}

/* Persist the referral code onto the order at checkout. */
add_action('woocommerce_checkout_update_order_meta', 'affp_save_ref_to_order');
function affp_save_ref_to_order($order_id) {
    if (!empty($_COOKIE[AFFP_COOKIE])) {
        $ref = sanitize_text_field(wp_unslash($_COOKIE[AFFP_COOKIE]));
        update_post_meta($order_id, '_aff_ref', $ref);
    }
    if (!empty($_COOKIE[AFFP_CHANNEL_COOKIE])) {
        update_post_meta($order_id, '_aff_channel', sanitize_text_field(wp_unslash($_COOKIE[AFFP_CHANNEL_COOKIE])));
    }
    if (!empty($_COOKIE[AFFP_ADNET_COOKIE])) {
        update_post_meta($order_id, '_aff_adnet', sanitize_text_field(wp_unslash($_COOKIE[AFFP_ADNET_COOKIE])));
    }
    foreach (array('utm_source','utm_medium','utm_campaign','utm_term','utm_content') as $utk) {
        $ck = 'aff_' . $utk;
        if (!empty($_COOKIE[$ck])) {
            update_post_meta($order_id, '_' . $ck, sanitize_text_field(wp_unslash($_COOKIE[$ck])));
        }
    }
}

/* Also support block-based / store API checkout. */
add_action('woocommerce_store_api_checkout_update_order_meta', 'affp_save_ref_to_order');

/* ------------------------------------------------------------------ *
 * 2) HTTP helper
 * ------------------------------------------------------------------ */

function affp_post($path, $body) {
    $s = affp_get_settings();
    $base = affp_api_base();
    if ($base === '' || empty($s['api_key'])) {
        return new WP_Error('affp_not_configured', 'Affiliate Platform is not configured.');
    }
    $resp = wp_remote_post($base . $path, array(
        'timeout' => 20,
        'headers' => array(
            'content-type' => 'application/json',
            'x-api-key'    => $s['api_key'],
        ),
        'body' => wp_json_encode($body),
    ));
    if (is_wp_error($resp)) {
        return $resp;
    }
    $code = wp_remote_retrieve_response_code($resp);
    $data = json_decode(wp_remote_retrieve_body($resp), true);
    if ($code < 200 || $code >= 300) {
        $msg = is_array($data) && isset($data['message']) ? (is_array($data['message']) ? implode(', ', $data['message']) : $data['message']) : ('HTTP ' . $code);
        return new WP_Error('affp_http_' . $code, $msg);
    }
    return is_array($data) ? $data : array();
}

/* ------------------------------------------------------------------ *
 * 3) Self-registration
 * ------------------------------------------------------------------ */

function affp_register_store() {
    $home = wp_parse_url(home_url(), PHP_URL_HOST);
    $res = affp_post('/integrations/woocommerce/register', array(
        'name'            => get_bloginfo('name'),
        'domain'          => $home ? $home : home_url(),
        'platformVersion' => defined('WC_VERSION') ? WC_VERSION : 'unknown',
    ));
    if (is_wp_error($res)) {
        return $res;
    }
    if (!empty($res['storeId'])) {
        affp_update_settings(array('store_id' => sanitize_text_field($res['storeId'])));
    }
    return $res;
}

/* ------------------------------------------------------------------ *
 * 4) Order sync (completed / processing) -> /orders/ingest/apikey
 * ------------------------------------------------------------------ */

add_action('woocommerce_order_status_completed', 'affp_sync_order', 10, 1);
add_action('woocommerce_order_status_processing', 'affp_sync_order', 10, 1);

function affp_sync_order($order_id) {
    $s = affp_get_settings();
    if (empty($s['store_id']) || empty($s['api_key'])) {
        return;
    }
    $order = wc_get_order($order_id);
    if (!$order) {
        return;
    }
    // Avoid double-sends for the same order.
    if ($order->get_meta('_affp_synced') === 'yes') {
        return;
    }

    $ref = $order->get_meta('_aff_ref');
    if (!$ref && !empty($_COOKIE[AFFP_COOKIE])) {
        $ref = sanitize_text_field(wp_unslash($_COOKIE[AFFP_COOKIE]));
    }

    $coupons = method_exists($order, 'get_coupon_codes') ? $order->get_coupon_codes() : array();
    $coupon = !empty($coupons) ? $coupons[0] : '';

    $placed = $order->get_date_created();

    $payload = array(
        'storeId'         => $s['store_id'],
        'externalOrderId' => (string) $order->get_id(),
        'subtotal'        => (float) $order->get_subtotal(),
        'total'           => (float) $order->get_total(),
        'currency'        => $order->get_currency(),
        'status'          => $order->get_status(),
        'customerEmail'   => $order->get_billing_email(),
        'customerId'      => (string) $order->get_customer_id(),
        'couponCode'      => $coupon,
        'referralCode'    => $ref ? $ref : '',
        'channel'         => $order->get_meta('_aff_channel') ?: (!empty($_COOKIE[AFFP_CHANNEL_COOKIE]) ? sanitize_text_field(wp_unslash($_COOKIE[AFFP_CHANNEL_COOKIE])) : ''),
        'adNetwork'       => $order->get_meta('_aff_adnet') ?: (!empty($_COOKIE[AFFP_ADNET_COOKIE]) ? sanitize_text_field(wp_unslash($_COOKIE[AFFP_ADNET_COOKIE])) : ''),
        'utmSource'       => $order->get_meta('_aff_utm_source') ?: '',
        'utmMedium'       => $order->get_meta('_aff_utm_medium') ?: '',
        'utmCampaign'     => $order->get_meta('_aff_utm_campaign') ?: '',
        'utmTerm'         => $order->get_meta('_aff_utm_term') ?: '',
        'utmContent'      => $order->get_meta('_aff_utm_content') ?: '',
        'placedAt'        => $placed ? $placed->date('c') : null,
    );

    $res = affp_post('/orders/ingest/apikey', $payload);
    if (!is_wp_error($res)) {
        $order->update_meta_data('_affp_synced', 'yes');
        $order->save();
    } else {
        affp_log('order sync failed: ' . $res->get_error_message());
    }
}

/* ------------------------------------------------------------------ *
 * 5) Refund sync -> /orders/refund/apikey
 * ------------------------------------------------------------------ */

add_action('woocommerce_order_refunded', 'affp_sync_refund', 10, 2);

function affp_sync_refund($order_id, $refund_id) {
    $s = affp_get_settings();
    if (empty($s['store_id']) || empty($s['api_key'])) {
        return;
    }
    $refund = wc_get_order($refund_id);
    $amount = $refund ? abs((float) $refund->get_amount()) : 0.0;
    if ($amount <= 0) {
        return;
    }
    $res = affp_post('/orders/refund/apikey', array(
        'storeId'         => $s['store_id'],
        'externalOrderId' => (string) $order_id,
        'refundAmount'    => $amount,
    ));
    if (is_wp_error($res)) {
        affp_log('refund sync failed: ' . $res->get_error_message());
    }
}

function affp_log($msg) {
    if (defined('WP_DEBUG') && WP_DEBUG) {
        error_log('[AffiliatePlatform] ' . $msg);
    }
}

/* ------------------------------------------------------------------ *
 * 6) Admin settings page (WooCommerce -> Affiliate Platform)
 * ------------------------------------------------------------------ */

add_action('admin_menu', 'affp_admin_menu');
function affp_admin_menu() {
    add_submenu_page(
        'woocommerce',
        'Affiliate Platform',
        'Affiliate Platform',
        'manage_woocommerce',
        'affiliate-platform',
        'affp_render_settings_page'
    );
}

function affp_render_settings_page() {
    if (!current_user_can('manage_woocommerce')) {
        return;
    }

    $notice = '';
    if (isset($_POST['affp_save']) && check_admin_referer('affp_save_settings')) {
        affp_update_settings(array(
            'api_base' => esc_url_raw(trim(wp_unslash($_POST['affp_api_base'] ?? ''))),
            'api_key'  => sanitize_text_field(wp_unslash($_POST['affp_api_key'] ?? '')),
        ));
        $res = affp_register_store();
        if (is_wp_error($res)) {
            $notice = '<div class="notice notice-error"><p>Connection failed: ' . esc_html($res->get_error_message()) . '</p></div>';
        } else {
            $notice = '<div class="notice notice-success"><p>Connected! Store ID: ' . esc_html(affp_get_settings()['store_id']) . '</p></div>';
        }
    }

    $s = affp_get_settings();
    $status = !empty($s['store_id']) ? 'Connected (store ' . esc_html($s['store_id']) . ')' : 'Not connected';
    ?>
    <div class="wrap">
        <h1>Affiliate Platform</h1>
        <?php echo $notice; ?>
        <p>Status: <strong><?php echo esc_html($status); ?></strong></p>
        <form method="post">
            <?php wp_nonce_field('affp_save_settings'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="affp_api_base">API base URL</label></th>
                    <td><input name="affp_api_base" id="affp_api_base" type="url" class="regular-text" placeholder="https://api.your-platform.com/v1" value="<?php echo esc_attr($s['api_base']); ?>" /></td>
                </tr>
                <tr>
                    <th scope="row"><label for="affp_api_key">API key</label></th>
                    <td>
                        <input name="affp_api_key" id="affp_api_key" type="password" class="regular-text" placeholder="aff_live_..." value="<?php echo esc_attr($s['api_key']); ?>" />
                        <p class="description">Requires the <code>stores.write</code> and <code>orders.write</code> scopes.</p>
                    </td>
                </tr>
            </table>
            <p class="submit"><button type="submit" name="affp_save" value="1" class="button button-primary">Save &amp; Connect</button></p>
        </form>
    </div>
    <?php
}

/* Settings link on the Plugins page. */
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'affp_action_links');
function affp_action_links($links) {
    $url = admin_url('admin.php?page=affiliate-platform');
    array_unshift($links, '<a href="' . esc_url($url) . '">Settings</a>');
    return $links;
}

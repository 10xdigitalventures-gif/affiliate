/* Affiliate click tracker + ad-source capture + Shopify cart-attribute sync.
   Usage:
     <script src="https://api.example.com/track.js"
             data-ref="CODE" data-api="https://api.example.com/v1"></script>
   - Captures ?ref=/?aff=, utm_* and ad click-ids (gclid/fbclid/ttclid...).
   - Persists them as first-touch cookies so they survive across the funnel.
   - On Shopify it writes them into the cart attributes so they land on the
     order (Shopify strips query params at checkout, but keeps cart attributes),
     which lets the backend record the real traffic source instead of "Direct". */
(function () {
  try {
    var s = document.currentScript || (function () {
      var els = document.getElementsByTagName('script')
      return els[els.length - 1]
    })()
    var api = (s && s.getAttribute('data-api')) || (window.AFF_API || '/v1')
    var ref = (s && s.getAttribute('data-ref')) || ''
    var org = (s && s.getAttribute('data-org')) || ''
    var qs = new URLSearchParams(window.location.search)
    ref = ref || qs.get('ref') || qs.get('aff') || ''

    var AD_IDS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'ttclid', 'msclkid', 'li_fat_id', 'twclid', 'epik', 'sccid']
    var NET = {
      gclid: 'google', gbraid: 'google', wbraid: 'google', dclid: 'google',
      fbclid: 'meta', ttclid: 'tiktok', msclkid: 'microsoft',
      li_fat_id: 'linkedin', twclid: 'twitter', epik: 'pinterest', sccid: 'snapchat'
    }
    var PAID = ['cpc', 'ppc', 'paid', 'paidsocial', 'paid-social', 'paid_social', 'display', 'cpm', 'cpv', 'banner', 'retargeting', 'remarketing']

    function readCookie(n) {
      var m = document.cookie.match('(^|; )' + n + '=([^;]+)')
      return m ? decodeURIComponent(m[2]) : ''
    }
    function setCookie(n, v) {
      if (!v) return
      document.cookie = n + '=' + encodeURIComponent(v) + ';path=/;max-age=' + (60 * 24 * 60 * 60) + ';samesite=lax'
    }

    var adnet = '', adclick = '', channel = ''
    for (var i = 0; i < AD_IDS.length; i++) {
      var v = qs.get(AD_IDS[i])
      if (v) { channel = 'paid'; adnet = NET[AD_IDS[i]] || ''; adclick = v; break }
    }
    var med = (qs.get('utm_medium') || '').toLowerCase()
    if (!channel && med && PAID.indexOf(med) >= 0) channel = 'paid'
    if (!channel && (ref || qs.get('utm_source'))) channel = 'organic'

    var utm = {
      utm_source: qs.get('utm_source') || '',
      utm_medium: qs.get('utm_medium') || '',
      utm_campaign: qs.get('utm_campaign') || '',
      utm_term: qs.get('utm_term') || '',
      utm_content: qs.get('utm_content') || ''
    }

    // First-touch persistence (do not overwrite an earlier ref).
    if (ref && !readCookie('aff_ref')) setCookie('aff_ref', ref)
    if (channel) setCookie('aff_channel', channel)
    if (adnet) setCookie('aff_adnet', adnet)
    if (adclick) setCookie('aff_adclick', adclick)
    if (utm.utm_source) setCookie('aff_utm_source', utm.utm_source)
    if (utm.utm_medium) setCookie('aff_utm_medium', utm.utm_medium)
    if (utm.utm_campaign) setCookie('aff_utm_campaign', utm.utm_campaign)

    // Shopify: persist attribution into cart attributes so it reaches the order
    // even though the checkout URL drops the query string.
    if (window.Shopify && (ref || channel || utm.utm_source)) {
      try {
        fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attributes: {
              aff_ref: ref || readCookie('aff_ref') || '',
              aff_channel: channel || readCookie('aff_channel') || '',
              aff_adnet: adnet || readCookie('aff_adnet') || '',
              aff_click: readCookie('aff_click') || '',
              utm_source: utm.utm_source,
              utm_medium: utm.utm_medium,
              utm_campaign: utm.utm_campaign,
              utm_term: utm.utm_term,
              utm_content: utm.utm_content
            }
          })
        }).catch(function () { })
      } catch (e) { }
    }

    if (!ref) return
    var body = { ref: ref, org: org, u: window.location.href }
    for (var k in utm) if (utm[k]) body[k] = utm[k]
    for (var j = 0; j < AD_IDS.length; j++) { var val = qs.get(AD_IDS[j]); if (val) body[AD_IDS[j]] = val }
    fetch(api + '/track/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (response) {
      if (!response.ok) throw new Error('click rejected')
      return response.json()
    }).then(function (result) {
      // Persist the returned id as a first-party store cookie. This is more
      // reliable than relying on a third-party/custom-subdomain Set-Cookie.
      if (!result || !result.clickId) return
      setCookie('aff_click', result.clickId)
      if (window.Shopify) {
        fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attributes: { aff_click: result.clickId } })
        }).catch(function () { })
      }
    }).catch(function () {
      // Storefront origins are intentionally not placed in the dashboard API
      // CORS allowlist. A no-CORS image beacon still records the click; the
      // first-party referral/UTM cookies above remain the attribution source.
      var p = new URLSearchParams()
      p.set('ref', ref)
      if (org) p.set('org', org)
      p.set('u', window.location.href.slice(0, 1000))
      for (var name in utm) if (utm[name]) p.set(name, utm[name])
      for (var n = 0; n < AD_IDS.length; n++) {
        var idValue = qs.get(AD_IDS[n])
        if (idValue) p.set(AD_IDS[n], idValue)
      }
      var beacon = new Image(1, 1)
      beacon.src = api + '/track/pixel.gif?' + p.toString()
    })
  } catch (e) { }
})()

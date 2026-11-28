package com.example.ui.screens

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.example.R
import com.example.ui.theme.DojoCreamBot
import com.example.ui.theme.DojoGlassCanvasBot
import com.example.ui.theme.DojoGlassCanvasMid
import com.example.ui.theme.DojoGlassCanvasTop
import com.example.ui.theme.DojoGlassCardFrost
import com.example.ui.theme.DojoGold
import com.example.ui.theme.DojoGoldSoft
import com.example.ui.theme.DojoInk
import com.example.ui.theme.DojoMuted
import com.example.ui.theme.DojoPurpleBorderGlow
import com.example.ui.theme.DojoPurpleGlowSoft
import com.example.ui.theme.DojoPurpleImperial
import com.example.ui.theme.DojoPurpleOrchid
import com.example.ui.theme.DojoPurpleRoyal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

private const val SITE_BASE_URL = "https://arsalan.up.railway.app/"

private fun isLoginRouteUrl(url: String?): Boolean {
    val lower = url?.lowercase() ?: return false
    return Regex("""(/(login|signin|auth|register)(/|$|\?|#)|#(login|signin|auth))""").containsMatchIn(lower)
}

private fun resolveDojoCardDrawableRes(path: String): Int? {
    val clean = path.lowercase()
    return when {
        clean.endsWith("/__dojo_assets/karate.jpg") || clean.endsWith("/images/card-karate.jpg") ->
            R.drawable.img_card_karate
        clean.endsWith("/__dojo_assets/gymnastics.jpg") || clean.endsWith("/images/card-gym.jpg") ->
            R.drawable.img_card_gym
        clean.endsWith("/__dojo_assets/muay_thai.jpg") ||
            clean.endsWith("/images/card-muaythai.jpg") ||
            clean.endsWith("/images/card-muay-thai.jpg") ->
            R.drawable.img_card_muay_thai
        clean.endsWith("/__dojo_assets/boxing.jpg") || clean.endsWith("/images/card-boxing.jpg") ->
            R.drawable.img_card_boxing
        clean.endsWith("/__dojo_assets/crossfit.jpg") || clean.endsWith("/images/card-crossfit.jpg") ->
            R.drawable.img_card_crossfit
        else -> null
    }
}

private val dojoCardAssetCache = ConcurrentHashMap<Int, ByteArray>()

private fun getCachedCardAssetBytes(context: Context, resId: Int): ByteArray? {
    dojoCardAssetCache[resId]?.let { return it }
    val loaded = runCatching {
        context.resources.openRawResource(resId).use { it.readBytes() }
    }.getOrNull() ?: return null
    dojoCardAssetCache.putIfAbsent(resId, loaded)
    return loaded
}

private val GLASS_THEME_AND_VIEWPORT_JS = """
(function(){
  if(window.__dojoViewportInitialized && window.__dojoSyncNow){
    window.__dojoSyncNow();
    return;
  }
  window.__dojoViewportInitialized=true;
  if(!document.getElementById('dojo-viewport-fix')){
    var s=document.createElement('style');
    s.id='dojo-viewport-fix';
    s.textContent=
      'html,body{overflow-x:clip!important;max-width:100%!important;}' +
      'html:not(.dojo-login-active),html:not(.dojo-login-active) body{background:transparent!important;background-color:transparent!important;background-image:none!important;}' +
      'html:not(.dojo-login-active) main,html:not(.dojo-login-active) section:not([data-dojo-login-box="1"]),html:not(.dojo-login-active) .section:not([data-dojo-login-box="1"]),html:not(.dojo-login-active) .page,html:not(.dojo-login-active) .view,html:not(.dojo-login-active) .tab-pane,html:not(.dojo-login-active) .dashboard,html:not(.dojo-login-active) #app,html:not(.dojo-login-active) #root,html:not(.dojo-login-active) #main,html:not(.dojo-login-active) .panel-shell,html:not(.dojo-login-active) .panel-wrap,html:not(.dojo-login-active) .panel-page{overflow-x:clip!important;background:transparent!important;background-color:transparent!important;background-image:none!important;}' +
      'html:not(.dojo-login-active) header,html:not(.dojo-login-active) nav,html:not(.dojo-login-active) .navbar,html:not(.dojo-login-active) .topbar{background:rgba(248,242,255,0.84)!important;border-bottom:1px solid rgba(109,40,217,0.22)!important;box-shadow:0 6px 20px rgba(76,29,149,0.09)!important;}' +
      'html:not(.dojo-login-active) .panel:not([data-dojo-login-box="1"]),html:not(.dojo-login-active) .glass:not([data-dojo-login-box="1"]),html:not(.dojo-login-active) .info-card:not([data-dojo-login-box="1"]),html:not(.dojo-login-active) .plan-card:not([data-dojo-login-box="1"]),html:not(.dojo-login-active) .contact-card:not([data-dojo-login-box="1"]){background:rgba(255,255,255,0.68)!important;border:1px solid rgba(255,255,255,0.74)!important;box-shadow:0 8px 22px rgba(76,29,149,0.10)!important;contain:layout style;}' +
      '[data-dojo-login-box="1"]{background:#F0EDE6!important;background-color:#F0EDE6!important;background-image:none!important;}' +
      'html.dojo-login-active,html.dojo-login-active body{background:#F0EDE6!important;background-color:#F0EDE6!important;}' +
      '@media (max-width:768px){.bank-card-wrap{width:min(310px,100%)!important;height:204px!important;}}' +
      '.bank-face.bank-back{padding:14px 16px!important;justify-content:space-between!important;}' +
      '.bank-back .stripe{height:30px!important;}' +
      '.bank-back .label{margin-top:26px!important;}' +
      '.bank-back .number{direction:ltr!important;unicode-bidi:isolate!important;white-space:nowrap!important;font-size:clamp(14px,4.3vw,18px)!important;letter-spacing:1.5px!important;padding:4px 0!important;}' +
      '.bank-copy{position:relative!important;z-index:2!important;flex-shrink:0!important;min-height:38px!important;padding:8px 12px!important;}' +
      'img[data-dojo-fallback="1"],img[data-dojo-card-photo="1"]{object-fit:cover!important;object-position:center center!important;}' +
      'html:not(.dojo-login-active) body{padding-bottom:72px!important;}';
    (document.head||document.documentElement).appendChild(s);
  }
  function normalizeFaText(txt){
    return String(txt||'')
      .replace(/[\u200c\u200d\s_-]+/g,'')
      .replace(/\u0643/g,'\u06a9')
      .replace(/\u064a/g,'\u06cc')
      .toLowerCase();
  }
  function matchDojoSportPath(norm){
    if(!norm) return '';
    if(norm.indexOf('کاراته')!==-1 || norm.indexOf('karate')!==-1) return '/__dojo_assets/karate.jpg';
    if(norm.indexOf('ژیمناستیک')!==-1 || norm.indexOf('gymnastic')!==-1 || norm.indexOf('cardgym')!==-1) return '/__dojo_assets/gymnastics.jpg';
    if(norm.indexOf('مویتای')!==-1 || norm.indexOf('muay')!==-1) return '/__dojo_assets/muay_thai.jpg';
    if(norm.indexOf('بوکس')!==-1 || norm.indexOf('boxing')!==-1) return '/__dojo_assets/boxing.jpg';
    if(norm.indexOf('کراسفیت')!==-1 || norm.indexOf('crossfit')!==-1) return '/__dojo_assets/crossfit.jpg';
    return '';
  }
  function resolveDojoSportAssetPath(img){
    if(!img) return '';
    if(img.classList && img.classList.contains('avatar-img')) return '';
    var alt=(img.getAttribute('alt')||'').trim();
    var rect=img.getBoundingClientRect ? img.getBoundingClientRect() : {width:0,height:0};
    if(rect.width>0 && rect.width<=48 && rect.height>0 && rect.height<=48 && !alt) return '';
    var labelParts=[
      alt,
      img.getAttribute('title')||'',
      img.getAttribute('aria-label')||''
    ];
    if(rect.width===0 || rect.width>=90 || rect.height>=90){
      var card=img.closest ? img.closest('.csw-card, .card, .sport-card, [class*="card"]') : null;
      if(card && card.textContent) labelParts.push(card.textContent);
      else if(img.parentElement && img.parentElement.textContent) labelParts.push(img.parentElement.textContent);
    }
    var byLabel=matchDojoSportPath(normalizeFaText(labelParts.join(' ')));
    if(byLabel) return byLabel;
    return matchDojoSportPath(normalizeFaText(img.getAttribute('src')||''));
  }
  function buildDojoFallbackSvg(altText){
    var a=(altText||'').replace(/\u200c/g,' ').replace(/\u0643/g,'\u06a9').replace(/\u064a/g,'\u06cc');
    var c1='#4C1D95', c2='#7C3AED', c3='#D4A853', glyph='dojo';
    if(a.indexOf('کاراته')!==-1){ c1='#4C1D95'; c2='#9333EA'; c3='#F59E0B'; glyph='karate'; }
    else if(a.indexOf('ژیمناستیک')!==-1){ c1='#6D28D9'; c2='#DB2777'; c3='#FDE68A'; glyph='gym'; }
    else if(a.indexOf('موی')!==-1 || a.indexOf('تای')!==-1){ c1='#3B0764'; c2='#BE123C'; c3='#FBBF24'; glyph='muay'; }
    else if(a.indexOf('بوکس')!==-1){ c1='#1E1B4B'; c2='#6D28D9'; c3='#F59E0B'; glyph='boxing'; }
    else if(a.indexOf('کراسفیت')!==-1){ c1='#312E81'; c2='#0F766E'; c3='#E8C878'; glyph='crossfit'; }
    var emblem='';
    if(glyph==='karate'){
      emblem='<circle cx="200" cy="210" r="56" fill="none" stroke="'+c3+'" stroke-width="4" opacity="0.85"/><path d="M168 210h64M200 178v64" stroke="'+c3+'" stroke-width="3" stroke-linecap="round" opacity="0.65"/><circle cx="200" cy="210" r="18" fill="'+c3+'" opacity="0.88"/>';
    }else if(glyph==='gym'){
      emblem='<path d="M125 250 C165 150, 235 150, 275 250" fill="none" stroke="'+c3+'" stroke-width="5" stroke-linecap="round" opacity="0.85"/><path d="M145 215 C180 175, 220 245, 255 185" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.55"/><circle cx="200" cy="160" r="14" fill="'+c3+'" opacity="0.9"/>';
    }else if(glyph==='muay'){
      emblem='<polygon points="200,148 248,186 232,248 168,248 152,186" fill="none" stroke="'+c3+'" stroke-width="4" opacity="0.88"/><polygon points="200,174 224,200 200,228 176,200" fill="'+c3+'" opacity="0.75"/>';
    }else if(glyph==='boxing'){
      emblem='<rect x="154" y="164" width="92" height="92" rx="28" fill="none" stroke="'+c3+'" stroke-width="4" opacity="0.85"/><path d="M174 210h52M184 192h32M184 228h32" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round" opacity="0.65"/>';
    }else if(glyph==='crossfit'){
      emblem='<path d="M150 210h100" stroke="'+c3+'" stroke-width="6" stroke-linecap="round" opacity="0.9"/><rect x="136" y="182" width="16" height="56" rx="6" fill="'+c3+'" opacity="0.85"/><rect x="248" y="182" width="16" height="56" rx="6" fill="'+c3+'" opacity="0.85"/><rect x="156" y="190" width="10" height="40" rx="4" fill="#FFFFFF" opacity="0.65"/><rect x="234" y="190" width="10" height="40" rx="4" fill="#FFFFFF" opacity="0.65"/>';
    }else{
      emblem='<circle cx="200" cy="210" r="50" fill="none" stroke="'+c3+'" stroke-width="4" opacity="0.85"/><circle cx="200" cy="210" r="20" fill="'+c3+'" opacity="0.8"/>';
    }
    var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 440" preserveAspectRatio="xMidYMid slice">' +
      '<defs>' +
        '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">' +
          '<stop offset="0%" stop-color="'+c1+'"/>' +
          '<stop offset="55%" stop-color="'+c2+'"/>' +
          '<stop offset="100%" stop-color="'+c3+'" stop-opacity="0.72"/>' +
        '</linearGradient>' +
        '<radialGradient id="gl" cx="30%" cy="25%" r="65%">' +
          '<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.32"/>' +
          '<stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>' +
        '</radialGradient>' +
      '</defs>' +
      '<rect width="400" height="440" fill="url(#g)"/>' +
      '<rect width="400" height="440" fill="url(#gl)"/>' +
      '<circle cx="330" cy="95" r="85" fill="#FFFFFF" opacity="0.08"/>' +
      '<circle cx="75" cy="360" r="105" fill="#FFFFFF" opacity="0.07"/>' +
      emblem +
    '</svg>';
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }
  function handleBrokenImage(img){
    if(!img || img.nodeName!=='IMG') return;
    var curSrc=img.getAttribute('src')||'';
    if(curSrc.indexOf('data:image/svg+xml')===0) return;
    var alt=(img.getAttribute('alt')||'').trim();
    if(curSrc.indexOf('/__dojo_assets/')!==-1){
      if(img.getAttribute('data-dojo-svg-tried')==='1') return;
      img.setAttribute('data-dojo-svg-tried','1');
      img.setAttribute('data-dojo-fallback','1');
      img.src=buildDojoFallbackSvg(alt);
      return;
    }
    var sportAsset=resolveDojoSportAssetPath(img);
    if(sportAsset){
      img.setAttribute('data-dojo-fallback','1');
      img.setAttribute('data-dojo-card-photo','1');
      img.removeAttribute('data-dojo-svg-tried');
      img.src=sportAsset;
      return;
    }
    if(img.getAttribute('data-dojo-fallback')==='1') return;
    if(!img.getAttribute('data-dojo-img-retried') && curSrc && navigator.onLine!==false){
      img.setAttribute('data-dojo-img-retried','1');
      var sep=curSrc.indexOf('?')===-1?'?':'&';
      img.src=curSrc+sep+'_dojo_r='+Date.now();
      return;
    }
    var rect=img.getBoundingClientRect ? img.getBoundingClientRect() : {width:0,height:0};
    var isTiny=(rect.width>0 && rect.width<=34 && rect.height>0 && rect.height<=34) && !alt;
    if(isTiny){
      img.setAttribute('data-dojo-fallback','1');
      img.style.setProperty('display','none','important');
      return;
    }
    img.setAttribute('data-dojo-fallback','1');
    img.src=buildDojoFallbackSvg(alt);
  }
  function syncBrokenImages(){
    var imgs=document.images;
    if(!imgs) return;
    for(var ii=0;ii<imgs.length;ii++){
      var im=imgs[ii];
      if(!im) continue;
      if(im.getAttribute('data-dojo-card-ready')==='1' && im.complete && im.naturalWidth>0){
        continue;
      }
      var s=im.getAttribute('src')||'';
      if(s.indexOf('/__dojo_assets/')!==-1){
        if(im.complete && im.naturalWidth>0){
          im.setAttribute('data-dojo-card-ready','1');
        }
        continue;
      }
      var isCardSwapPhoto=(im.classList && im.classList.contains('csw-photo')) || (im.closest && !!im.closest('.csw-card'));
      var expectedSport=isCardSwapPhoto || !s || (im.complete && im.naturalWidth===0) ? resolveDojoSportAssetPath(im) : '';
      if(isCardSwapPhoto && expectedSport && s.indexOf(expectedSport)===-1 && im.getAttribute('data-dojo-svg-tried')!=='1'){
        im.setAttribute('data-dojo-fallback','1');
        im.setAttribute('data-dojo-card-photo','1');
        im.setAttribute('data-dojo-card-ready','1');
        im.src=expectedSport;
        continue;
      }
      if(s.indexOf('data:image/svg+xml')===0){
        if(expectedSport && im.getAttribute('data-dojo-svg-tried')!=='1'){
          im.setAttribute('data-dojo-fallback','1');
          im.setAttribute('data-dojo-card-photo','1');
          im.setAttribute('data-dojo-card-ready','1');
          im.src=expectedSport;
        }
        continue;
      }
      if(im.getAttribute('data-dojo-fallback')==='1'){
        im.removeAttribute('data-dojo-fallback');
        im.removeAttribute('data-dojo-card-photo');
        im.removeAttribute('data-dojo-img-retried');
      }
      if(!s || (im.complete && im.naturalWidth===0)){
        handleBrokenImage(im);
      }
    }
  }
  if(!window.__dojoImgErrorBound){
    window.__dojoImgErrorBound=true;
    document.addEventListener('error', function(ev){
      if(ev && ev.target && ev.target.nodeName==='IMG'){
        ev.target.removeAttribute('data-dojo-card-ready');
        handleBrokenImage(ev.target);
      }
    }, true);
  }
  function isVisible(el){
    if(!el || el.hidden)return false;
    if(el.style && el.style.display==='none')return false;
    if(el.getClientRects && el.getClientRects().length===0)return false;
    var st=window.getComputedStyle(el);
    if(!st || st.display==='none' || st.visibility==='hidden' || st.opacity==='0')return false;
    var r=el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  }
  var __dojoIsSyncing=false;
  function syncLoginAndPanelState(){
    if(__dojoIsSyncing) return;
    __dojoIsSyncing=true;
    try{
    var href=(location.pathname+location.search+location.hash).toLowerCase();
    var isLoginUrl=/\/(login|signin|auth|register)(\/|$|\?|#)|#(login|signin|auth)/.test(href);
    var oldBoxes=document.querySelectorAll('[data-dojo-login-box="1"]');
    for(var k=0;k<oldBoxes.length;k++) oldBoxes[k].removeAttribute('data-dojo-login-box');

    var vw=window.innerWidth||360, vh=window.innerHeight||640;
    var loginBoxes=[];
    var loginInputs=document.querySelectorAll('.otc-input, input[type="password"], input[autocomplete="current-password"], input[name*="pass" i], input[placeholder*="رمز"]');
    for(var i=0;i<loginInputs.length;i++){
      var inp=loginInputs[i];
      if(!isVisible(inp)) continue;
      var box=inp.closest('form, .login-box, .login-card, .auth-card, .auth-box, .modal-card, .modal-content, section, .section') || inp.parentElement;
      if(!box || box===document.body || box===document.documentElement || box.id==='app' || box.id==='root') continue;
      if(box.querySelector('table, .bank-card-wrap, header, nav')) continue;
      if(loginBoxes.indexOf(box)===-1){
        loginBoxes.push(box);
      }
    }

    var namedLoginBoxes=document.querySelectorAll('.login-box, .login-card, .auth-card, .auth-box, #loginSection, #loginBox, #loginModal');
    for(var n=0;n<namedLoginBoxes.length;n++){
      var nb=namedLoginBoxes[n];
      if(!isVisible(nb)) continue;
      if(nb.querySelector('input, .otc-input') && !nb.querySelector('table, .bank-card-wrap, header, nav')){
        if(loginBoxes.indexOf(nb)===-1) loginBoxes.push(nb);
      }
    }

    for(var j=0;j<loginBoxes.length;j++){
      if(loginBoxes[j].getAttribute('data-dojo-login-box')!=='1'){
        loginBoxes[j].setAttribute('data-dojo-login-box','1');
      }
    }

    var hasOtherVisibleSections=false;
    var nonLoginBlocks=document.querySelectorAll('section, .section, .bank-card-wrap, .panel, .dashboard, table, .tab-pane, .plan-card');
    for(var b=0;b<nonLoginBlocks.length;b++){
      var blk=nonLoginBlocks[b];
      if(blk.getAttribute('data-dojo-login-box')==='1' || blk.closest('[data-dojo-login-box="1"]') || blk.querySelector('[data-dojo-login-box="1"]')) continue;
      if(!isVisible(blk)) continue;
      var br=blk.getBoundingClientRect();
      if(br.height>=70 && br.width>=120){
        hasOtherVisibleSections=true;
        break;
      }
    }

    var hasFullLogin=isLoginUrl;
    if(!hasFullLogin && loginBoxes.length>0 && !hasOtherVisibleSections){
      hasFullLogin=true;
    }

    var nextLoginActive=!!hasFullLogin;
    if(document.documentElement.classList.contains('dojo-login-active')!==nextLoginActive){
      document.documentElement.classList.toggle('dojo-login-active', nextLoginActive);
    }
    if(window.__dojoLastLoginActive!==nextLoginActive){
      window.__dojoLastLoginActive=nextLoginActive;
      if(window.AndroidDojoBridge && typeof window.AndroidDojoBridge.setLoginScreenActive==='function'){
        window.AndroidDojoBridge.setLoginScreenActive(nextLoginActive);
      }
    }

    var isPanelUrl=/\/(panel|dashboard|coach|member|student|admin|profile)(\/|$|\?|#)|#(panel|dashboard|coach|member|student)/.test(href);
    var hasLogoutControl=false;
    var hasVisibleLoginTrigger=false;
    var actionEls=document.querySelectorAll('[id*="logout" i], [class*="logout" i], a[href*="logout" i], button, a');
    for(var ac=0;ac<actionEls.length;ac++){
      var aEl=actionEls[ac];
      if(aEl.closest && aEl.closest('#dojo-google-auth-wrap')) continue;
      if(!isVisible(aEl)) continue;
      if(!hasLogoutControl && aEl.matches('[id*="logout" i], [class*="logout" i], a[href*="logout" i]')){
        hasLogoutControl=true;
      }
      var txt=(aEl.textContent||'').replace(/\s+/g,' ').trim();
      if(txt.length>0 && txt.length<=28){
        if(!hasLogoutControl && (txt.indexOf('خروج')!==-1 || /logout|sign\s*out/i.test(txt))){
          hasLogoutControl=true;
        }
        if(!hasVisibleLoginTrigger && (txt==='ورود' || txt==='ورود به پنل' || txt==='ورود / ثبت‌نام' || txt==='ثبت نام' || txt==='ثبت‌نام')){
          hasVisibleLoginTrigger=true;
        }
      }
      if(hasLogoutControl && hasVisibleLoginTrigger) break;
    }

    var isAuthenticated=false;
    if(!hasFullLogin && !isLoginUrl){
      if(hasLogoutControl){
        isAuthenticated=true;
      }else if(isPanelUrl && loginBoxes.length===0){
        isAuthenticated=true;
      }else if(loginBoxes.length===0 && !hasVisibleLoginTrigger){
        var panelEls=document.querySelectorAll('.dashboard, .panel-shell, .panel-wrap, .coach-panel, .member-panel, [id*="panel" i], [class*="panel" i]');
        for(var pe=0;pe<panelEls.length;pe++){
          if(isVisible(panelEls[pe])){
            isAuthenticated=true;
            break;
          }
        }
      }
    }

    if(window.__dojoLastAuthed!==isAuthenticated){
      window.__dojoLastAuthed=isAuthenticated;
      if(window.AndroidDojoBridge && typeof window.AndroidDojoBridge.setAuthenticatedState==='function'){
        window.AndroidDojoBridge.setAuthenticatedState(!!isAuthenticated);
      }
    }

    if(hasFullLogin && document.body){
      var prevWrappers=document.querySelectorAll('[data-dojo-panel-bg="1"]');
      for(var pw=0;pw<prevWrappers.length;pw++){
        prevWrappers[pw].style.removeProperty('background');
        prevWrappers[pw].style.removeProperty('background-image');
        prevWrappers[pw].removeAttribute('data-dojo-panel-bg');
      }
    }

    if(!hasFullLogin && document.body){
      var wrappers=document.querySelectorAll('body > div, body > main, main > div, #app > div, #root > div, .page, .panel-shell, .panel-wrap, .dashboard, .tab-content');
      for(var w=0;w<wrappers.length;w++){
        var wr=wrappers[w];
        if(!wr || wr.getAttribute('data-dojo-panel-bg')==='1' || wr.getAttribute('data-dojo-login-box')==='1' || wr.closest('[data-dojo-login-box="1"]')) continue;
        if(wr.matches('header, nav, .navbar, .topbar, .bank-card-wrap, .bank-card, .bank-face')) continue;
        var rect=wr.getBoundingClientRect();
        if(rect.width>=vw*0.80 && rect.height>=vh*0.30){
          var wcs=window.getComputedStyle(wr);
          if(wcs.backgroundColor && wcs.backgroundColor!=='rgba(0, 0, 0, 0)' && wcs.backgroundColor!=='transparent'){
            wr.setAttribute('data-dojo-panel-bg','1');
            wr.style.setProperty('background','transparent','important');
            wr.style.setProperty('background-image','none','important');
          }
        }
      }
    }
    syncGoogleAuthWidget();
    syncBrokenImages();
    } finally {
      __dojoIsSyncing=false;
    }
  }
  window.__dojoGoogleState = window.__dojoGoogleState || { signedIn: false, signingIn: false, email: '', error: '' };
  function syncGoogleAuthWidget(){
    var host = document.querySelector('#auth .auth-box, .auth-section .auth-box, #auth, .auth-box');
    if(!host) return;
    var wrap = document.getElementById('dojo-google-auth-wrap');
    if(!wrap){
      wrap = document.createElement('div');
      wrap.id = 'dojo-google-auth-wrap';
      wrap.style.cssText = 'margin-top:16px;padding-top:14px;border-top:1px solid rgba(109,40,217,0.16);direction:rtl;text-align:center;';
      wrap.innerHTML =
        '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">یا ورود سریع با حساب گوگل</div>' +
        '<button type="button" id="dojo-google-auth-btn" style="width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;border-radius:10px;border:1px solid #d4d4d8;background:#ffffff;color:#18181b;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.06);">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">' +
            '<path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.66l3.2-3.2C17.54 1.68 14.98.64 12 .64 7.56.64 3.72 3.18 1.86 6.88l3.73 2.9C6.46 7.06 9.01 5.04 12 5.04z"/>' +
            '<path fill="#4285F4" d="M23.04 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.2c-.27 1.44-1.08 2.66-2.3 3.48l3.56 2.76c2.08-1.92 3.58-4.74 3.58-8.27z"/>' +
            '<path fill="#FBBC05" d="M5.59 14.22A7.2 7.2 0 0 1 5.21 12c0-.77.14-1.52.38-2.22l-3.73-2.9A11.36 11.36 0 0 0 .64 12c0 1.84.44 3.58 1.22 5.12l3.73-2.9z"/>' +
            '<path fill="#34A853" d="M12 23.36c3.14 0 5.77-1.04 7.7-2.82l-3.56-2.76c-1.04.7-2.38 1.12-4.14 1.12-2.99 0-5.54-2.02-6.41-4.74l-3.73 2.9C3.72 20.82 7.56 23.36 12 23.36z"/>' +
          '</svg>' +
          '<span id="dojo-google-auth-label">ادامه با گوگل</span>' +
        '</button>' +
        '<div id="dojo-google-auth-status" style="display:none;margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.32);color:#065f46;font-size:13px;font-weight:600;"></div>' +
        '<div id="dojo-google-auth-error" style="display:none;margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.32);color:#b91c1c;font-size:12px;"></div>';
      host.appendChild(wrap);
    }
    var webBtn = document.getElementById('dojo-google-web-btn');
    if(webBtn){
      webBtn.style.display = 'none';
    }
    var btn = document.getElementById('dojo-google-auth-btn');
    if(btn && btn.getAttribute('data-dojo-android-bound') !== '1'){
      btn.setAttribute('data-dojo-android-bound', '1');
      btn.addEventListener('click', function(ev){
        if(ev && ev.preventDefault) ev.preventDefault();
        if(ev && ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        if(window.__dojoGoogleState && window.__dojoGoogleState.signingIn) return;
        var errBox = document.getElementById('dojo-google-auth-error');
        var lbl = document.getElementById('dojo-google-auth-label');
        if(errBox) errBox.style.display = 'none';
        try{
          if(window.AndroidDojoBridge && window.AndroidDojoBridge.requestGoogleSignIn){
            if(lbl) lbl.textContent = 'در حال باز کردن حساب گوگل...';
            window.AndroidDojoBridge.requestGoogleSignIn();
          }else{
            if(errBox){
              errBox.style.display = 'block';
              errBox.textContent = 'ارتباط دکمه با برنامه برقرار نیست.';
            }
          }
        }catch(e){
          if(errBox){
            errBox.style.display = 'block';
            errBox.textContent = String((e && e.message) || e || 'خطا در اجرای دکمه گوگل');
          }
        }
      }, true);
    }
    var st = window.__dojoGoogleState || {};
    var btnEl = document.getElementById('dojo-google-auth-btn');
    var lblEl = document.getElementById('dojo-google-auth-label');
    var okEl = document.getElementById('dojo-google-auth-status');
    var errEl = document.getElementById('dojo-google-auth-error');
    if(btnEl && lblEl && okEl && errEl){
      btnEl.style.display = 'flex';
      btnEl.disabled = !!st.signingIn;
      btnEl.style.opacity = st.signingIn ? '0.65' : '1';
      lblEl.textContent = st.signingIn ? 'در حال اتصال به گوگل...' : 'ادامه با گوگل';
      if(st.signedIn && st.email && !st.signingIn){
        okEl.style.display = 'block';
        okEl.textContent = 'حساب گوگل: ' + st.email;
      }else{
        okEl.style.display = 'none';
      }
      if(st.error){
        errEl.style.display = 'block';
        errEl.textContent = st.error;
      }else{
        errEl.style.display = 'none';
      }
    }
  }
  window.__dojoSetGoogleState = function(signedIn, signingIn, email, errorMsg){
    window.__dojoGoogleState = {
      signedIn: !!signedIn,
      signingIn: !!signingIn,
      email: String(email || ''),
      error: String(errorMsg || '')
    };
    syncGoogleAuthWidget();
  };
  window.__dojoSyncNow = syncLoginAndPanelState;
  syncLoginAndPanelState();
  if(!window.__dojoLoginObserver){
    window.__dojoLoginObserver=true;
    var syncTimer=0;
    var triggerSync=function(){
      if(__dojoIsSyncing || syncTimer) return;
      syncTimer=setTimeout(function(){
        syncTimer=0;
        requestAnimationFrame(syncLoginAndPanelState);
      }, 140);
    };
    window.addEventListener('hashchange', triggerSync);
    window.addEventListener('popstate', triggerSync);
    if(history.pushState){
      var origPush=history.pushState;
      history.pushState=function(){
        var r=origPush.apply(this,arguments);
        triggerSync();
        return r;
      };
    }
    if(history.replaceState){
      var origReplace=history.replaceState;
      history.replaceState=function(){
        var r=origReplace.apply(this,arguments);
        triggerSync();
        return r;
      };
    }
    if(typeof MutationObserver==='function' && document.body){
      var obs=new MutationObserver(function(records){
        if(__dojoIsSyncing) return;
        for(var m=0;m<records.length;m++){
          var rec=records[m];
          var tgt=rec.target;
          if(tgt && tgt.nodeType===1){
            if(tgt.id==='dojo-google-auth-wrap' || (tgt.closest && (tgt.closest('#dojo-google-auth-wrap') || tgt.closest('.otp-row')))){
              continue;
            }
          }
          triggerSync();
          break;
        }
      });
      obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','src']});
    }
  }
  if(window.scrollX!==0){window.scrollTo(0,window.scrollY);}
  if(!window.__dojoClipboardPatched && window.AndroidDojoBridge){
    window.__dojoClipboardPatched=true;
    try{
      if(!navigator.clipboard){
        navigator.clipboard={
          writeText:function(t){
            return window.AndroidDojoBridge.copyText(String(t||''))
              ? Promise.resolve()
              : Promise.reject(new Error('Clipboard unavailable'));
          }
        };
      }else if(typeof navigator.clipboard.writeText==='function'){
        var origWrite=navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText=function(t){
          return origWrite(t).catch(function(){
            if(window.AndroidDojoBridge.copyText(String(t||''))) return Promise.resolve();
            return Promise.reject(new Error('Clipboard failed'));
          });
        };
      }
    }catch(_){}
    if(typeof window.print==='function'){
      window.print=function(){
        window.AndroidDojoBridge.printPage();
      };
    }
  }
  if(!window.__dojoCopyPatched && window.AndroidDojoBridge && typeof window.doCopy==='function'){
    window.__dojoCopyPatched=true;
    var origCopy=window.doCopy;
    window.doCopy=function(btn,num){
      if(window.AndroidDojoBridge.copyText(num)){
        btn.innerHTML='<span>✅</span> کپی شد';
        btn.style.background='rgba(74,222,128,0.2)';
        setTimeout(function(){btn.innerHTML='<span>📋</span> کپی';btn.style.background='';},2500);
        var box=document.getElementById('toastBox');
        if(box){
          var el=document.createElement('div');
          el.className='toast ok';
          el.textContent='شماره کارت با موفقیت کپی شد';
          box.appendChild(el);
          setTimeout(function(){if(el.parentNode)el.remove();},3500);
        }
        return;
      }
      origCopy(btn,num);
    };
  }
})();
""".trimIndent()

private class AndroidDojoBridge(
    private val context: Context,
    private val webViewProvider: () -> WebView?,
    private val onLoginScreenChanged: (Boolean) -> Unit,
    private val onAuthenticatedChanged: (Boolean) -> Unit,
    private val onGoogleSignInRequested: () -> Unit,
    private val onError: (String) -> Unit
) {
    @JavascriptInterface
    fun setLoginScreenActive(active: Boolean) {
        val wv = webViewProvider()
        if (wv != null) {
            wv.post { onLoginScreenChanged(active) }
        } else {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                onLoginScreenChanged(active)
            }
        }
    }

    @JavascriptInterface
    fun setAuthenticatedState(authenticated: Boolean) {
        val wv = webViewProvider()
        if (wv != null) {
            wv.post { onAuthenticatedChanged(authenticated) }
        } else {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                onAuthenticatedChanged(authenticated)
            }
        }
    }

    @JavascriptInterface
    fun requestGoogleSignIn() {
        val wv = webViewProvider()
        if (wv != null) {
            wv.post { onGoogleSignInRequested() }
        } else {
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                onGoogleSignInRequested()
            }
        }
    }

    @JavascriptInterface
    fun onPortalGoogleLoginComplete() {
        runCatching { CookieManager.getInstance().flush() }
    }

    @JavascriptInterface
    fun copyText(text: String?): Boolean {
        if (text.isNullOrEmpty()) return false
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            runCatching { cm.setPrimaryClip(ClipData.newPlainText("arslan_dojo", text)) }
        }
        return true
    }

    @JavascriptInterface
    fun saveDataUrlFile(dataUrl: String?, fileName: String?, mimeType: String?) {
        if (dataUrl.isNullOrBlank()) {
            onError("خطا در دریافت فایل خروجی")
            return
        }
        val ok = saveDataUriAndShare(context, dataUrl, fileName, mimeType)
        if (!ok) {
            onError("خطا در دریافت فایل خروجی")
        }
    }

    @JavascriptInterface
    fun printPage() {
        val wv = webViewProvider() ?: return
        wv.post {
            runCatching {
                val pm = context.getSystemService(Context.PRINT_SERVICE) as? PrintManager ?: return@post
                val adapter = wv.createPrintDocumentAdapter("arsalan-dojo")
                pm.print("arsalan-dojo", adapter, PrintAttributes.Builder().build())
            }.onFailure {
                onError("امکان چاپ در این دستگاه وجود ندارد")
            }
        }
    }
}

/**
 * Drop-in Android WebView-hardened OneTimeCode implementation:
 * - Preserves the exact visual design, dimensions, spring capsule, reset/focus API, and callbacks
 * - Forces LTR & tel keypad so Gboard/IME never scrambles digits or renders a black selection block
 * - Avoids 60fps DOM innerHTML recreation & SVG goo blur filter lag
 * - Converts Persian/Arabic digits to ASCII and triggers immediate redraw on Backspace/blur
 */
private val SMOOTH_ONE_TIME_CODE_JS = """
(function() {
  'use strict';
  var W = 40;
  var H = 50;
  var G = 8;
  var CAP = 160;
  var POP_MS = 220;
  var SHAKE_MS = 600;
  var MERGE_K = 0.085;
  var MERGE_D = 1 - 2 * 0.45 * Math.sqrt(MERGE_K);

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) {
    var u = clamp((v - a) / (b - a), 0, 1);
    return u * u * (3 - 2 * u);
  }
  function normalizeDigits(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch >= 48 && ch <= 57) {
        out += str[i];
      } else if (ch >= 1776 && ch <= 1785) {
        out += String.fromCharCode(ch - 1728);
      } else if (ch >= 1632 && ch <= 1641) {
        out += String.fromCharCode(ch - 1584);
      }
    }
    return out;
  }

  function OneTimeCode(container, options) {
    if (!container) return null;
    container.innerHTML = '';
    options = options || {};
    var length = options.length || 6;
    var answer = options.answer || 'Accept';
    var onVerify = options.onVerify || function() {};
    var code = '';
    var phase = 'type';
    var focus = false;
    var caret = { x: W / 2, v: 0 };
    var popAt = [];
    var prevDigits = [];
    var mergeState = { m: 0, v: 0, to: 0 };
    var shookAt = 0;
    var rafId = 0;

    var root = document.createElement('div');
    root.className = 'otp';
    root.dir = 'ltr';
    root.style.direction = 'ltr';
    var rowW = length * W + (length - 1) * G;

    var row = document.createElement('div');
    row.className = 'otp-row';
    row.dir = 'ltr';
    row.style.direction = 'ltr';
    row.style.width = rowW + 'px';
    row.style.height = H + 'px';

    var gooLayer = document.createElement('div');
    gooLayer.className = 'otp-goo';
    row.appendChild(gooLayer);

    var slots = [];
    var digitNodes = [];
    for (var i = 0; i < length; i++) {
      var slot = document.createElement('span');
      slot.className = 'otp-slot';
      slot.style.width = W + 'px';
      slot.style.pointerEvents = 'none';
      var dNode = document.createElement('span');
      dNode.className = 'otp-digit';
      dNode.style.animation = 'none';
      dNode.style.willChange = 'transform, opacity';
      dNode.style.display = 'none';
      slot.appendChild(dNode);
      slots.push(slot);
      digitNodes.push(dNode);
      row.appendChild(slot);
      prevDigits.push('');
    }

    var caretEl = document.createElement('i');
    caretEl.className = 'otp-caret';
    row.appendChild(caretEl);

    var okEl = document.createElement('span');
    okEl.className = 'otp-ok';
    okEl.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> تأیید شد';
    row.appendChild(okEl);

    var input = document.createElement('input');
    input.className = 'otp-field';
    input.type = 'tel';
    input.dir = 'ltr';
    input.inputMode = 'numeric';
    input.setAttribute('pattern', '[0-9]*');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    input.setAttribute('maxlength', length);
    input.setAttribute('aria-label', length + '-digit code');
    input.spellcheck = false;
    input.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0.001;border:0;padding:0;margin:0;font-size:16px;direction:ltr;text-align:left;color:transparent;-webkit-text-fill-color:transparent;caret-color:transparent;background:transparent;outline:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;';
    row.appendChild(input);

    root.appendChild(row);
    container.appendChild(root);

    var cellNodes = [];
    var capsuleNode = null;
    function buildCells() {
      gooLayer.innerHTML = '';
      cellNodes = [];
      for (var i = 0; i < length; i++) {
        var cell = document.createElement('span');
        cell.className = 'otp-cell';
        cell.style.width = W + 'px';
        cell.style.borderRadius = '10px';
        cell.style.willChange = 'transform';
        gooLayer.appendChild(cell);
        cellNodes.push(cell);
      }
      capsuleNode = document.createElement('span');
      capsuleNode.className = 'otp-cell otp-capsule';
      capsuleNode.style.borderRadius = (H / 2) + 'px';
      capsuleNode.style.display = 'none';
      gooLayer.appendChild(capsuleNode);
    }
    buildCells();

    function pinCursorEnd() {
      try {
        var len = input.value.length;
        input.setSelectionRange(len, len);
      } catch (_) {}
    }

    function wake() {
      if (rafId) return;
      var prev = 0;
      function tick(t) {
        var dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
        prev = t;
        var busy = false;

        var target = Math.min(code.length, length - 1) * (W + G) + W / 2;
        caret.v += (target - caret.x) * 0.25 * dt;
        caret.v *= Math.pow(0.58, dt);
        caret.x += caret.v * dt;
        if (Math.abs(target - caret.x) < 0.1 && Math.abs(caret.v) < 0.1) {
          caret.x = target; caret.v = 0;
        } else { busy = true; }

        var mg = mergeState;
        if (mg.m !== mg.to || mg.v !== 0) {
          mg.v += (mg.to - mg.m) * MERGE_K * dt;
          mg.v *= Math.pow(MERGE_D, dt);
          mg.m += mg.v * dt;
          if (Math.abs(mg.to - mg.m) < 0.001 && Math.abs(mg.v) < 0.001) {
            mg.m = mg.to; mg.v = 0;
          } else { busy = true; }
        }

        if (phase === 'no' && performance.now() - shookAt < SHAKE_MS + 150) busy = true;
        if (phase === 'check') busy = true;
        for (var pi = 0; pi < popAt.length; pi++) {
          if (popAt[pi] !== undefined && performance.now() - popAt[pi] < POP_MS) { busy = true; break; }
        }

        render();
        rafId = busy ? requestAnimationFrame(tick) : 0;
      }
      rafId = requestAnimationFrame(tick);
    }

    function fuse(to) {
      mergeState = { m: mergeState.m, v: mergeState.v, to: to };
      wake();
    }

    function render() {
      var now = performance.now();
      var raw = mergeState.m;
      var m = clamp(raw, 0, 1);
      var mid = (rowW - W) / 2;
      var since = now - shookAt;
      var shaking = phase === 'no' && since < SHAKE_MS;

      for (var i = 0; i < length; i++) {
        var home = i * (W + G);
        var shake = shaking ? 5 * Math.exp(-since / 190) * Math.sin((since / 1000) * Math.PI * 2 * 10 + i * 0.55) : 0;
        var x = mix(home, mid, m) + shake;

        var at = popAt[i];
        var popScale = 1;
        if (at !== undefined) {
          var u = (now - at) / POP_MS;
          if (u > 0 && u < 1) popScale = 1 + 0.06 * Math.sin(Math.PI * u);
        }

        var breathScale = popScale;
        if (phase === 'check') {
          var bu = ((now % 900) / 900) * (length + 2) - i;
          if (bu > 0 && bu < 2) breathScale *= 1 - 0.07 * Math.sin((bu / 2) * Math.PI);
        }

        var cell = cellNodes[i];
        if (cell) {
          var cellR = mix(10, H / 2, smooth(0.15, 0.7, m));
          cell.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0) scale(' + breathScale.toFixed(3) + ')';
          cell.style.borderRadius = cellR.toFixed(1) + 'px';
          cell.style.opacity = String(1 - smooth(0.25, 0.65, m));
        }

        slots[i].style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
        slots[i].style.opacity = String(1 - smooth(0, 0.4, m));

        var d = code[i] || '';
        var dNode = digitNodes[i];
        if (d !== prevDigits[i]) {
          prevDigits[i] = d;
          dNode.textContent = d;
          dNode.style.display = d ? 'block' : 'none';
        }
        if (d) {
          if (phase === 'no') {
            var out = smooth(0, 1, (since - 260 - (length - 1 - i) * 40) / 200);
            dNode.style.transform = 'translate3d(0,' + (out * 8).toFixed(2) + 'px,0)';
            dNode.style.opacity = String(1 - out);
          } else if (at !== undefined && (now - at) < POP_MS) {
            var pu = clamp((now - at) / POP_MS, 0, 1);
            var ease = 1 - Math.pow(1 - pu, 3);
            dNode.style.transform = 'translate3d(0,' + ((1 - ease) * 6).toFixed(2) + 'px,0) scale(' + (0.88 + 0.12 * ease).toFixed(3) + ')';
            dNode.style.opacity = String(ease);
          } else {
            dNode.style.transform = 'none';
            dNode.style.opacity = '1';
          }
        }
      }

      var over = raw - 1;
      var capW = CAP * smooth(0.2, 1, m) * (1 + Math.max(-0.12, over) * 0.9);
      var capSy = 1 - Math.max(-0.12, over) * 0.55;
      if (capsuleNode && capW > 1) {
        capsuleNode.style.display = '';
        capsuleNode.style.width = capW.toFixed(1) + 'px';
        capsuleNode.style.transform = 'translate3d(' + ((rowW - capW) / 2).toFixed(2) + 'px,0,0) scaleY(' + capSy.toFixed(3) + ')';
      } else if (capsuleNode) {
        capsuleNode.style.display = 'none';
      }

      var typing = phase === 'type' && focus;
      caretEl.setAttribute('data-on', typing && code.length < length && m < 0.08 ? 'true' : '');
      caretEl.style.transform = 'translate3d(' + (caret.x - 1).toFixed(2) + 'px,0,0) scaleX(' + (1 + Math.min(3, Math.abs(caret.v) * 0.5)).toFixed(3) + ')';

      okEl.style.opacity = String(smooth(0.68, 1, m));
      okEl.style.transform = 'scale(' + mix(0.92, 1, smooth(0.68, 1, m)).toFixed(3) + ')';
      root.setAttribute('data-phase', phase);
    }

    input.addEventListener('input', function(e) {
      if (phase !== 'type') {
        input.value = code;
        return;
      }
      var next = normalizeDigits(input.value).slice(0, length);
      if (input.value !== next) {
        input.value = next;
      }
      pinCursorEnd();
      if (next === code) return;

      if (next.length > code.length) {
        var t0 = performance.now();
        for (var i = code.length; i < next.length; i++) {
          popAt[i] = t0 + (i - code.length) * 30;
        }
      } else {
        for (var j = next.length; j < length; j++) {
          popAt[j] = undefined;
        }
      }
      code = next;
      wake();

      if (code.length < length) return;

      phase = 'check';
      wake();
      setTimeout(function() {
        if (answer !== 'Reject') {
          phase = 'ok';
          fuse(1);
          input.blur();
          if (onVerify) onVerify(code);
        } else {
          phase = 'no';
          shookAt = performance.now();
          wake();
          setTimeout(function() {
            code = '';
            phase = 'type';
            input.value = '';
            popAt = [];
            prevDigits = [];
            for (var k = 0; k < length; k++) prevDigits.push('');
            render();
            wake();
          }, SHAKE_MS + length * 40 + 160);
        }
      }, 280);
    });

    input.addEventListener('focus', function() {
      focus = true;
      requestAnimationFrame(pinCursorEnd);
      wake();
    });
    input.addEventListener('blur', function() {
      focus = false;
      wake();
    });
    function reopenFromOk() {
      if (phase !== 'ok') return;
      code = '';
      phase = 'type';
      fuse(0);
      input.value = '';
      popAt = [];
      for (var i = 0; i < length; i++) prevDigits[i] = '';
      render();
      input.focus();
      requestAnimationFrame(pinCursorEnd);
    }

    input.addEventListener('click', function() {
      if (phase === 'ok') {
        reopenFromOk();
        return;
      }
      requestAnimationFrame(pinCursorEnd);
    });

    okEl.addEventListener('click', reopenFromOk);

    row.addEventListener('click', function() {
      if (phase === 'ok') {
        reopenFromOk();
        return;
      }
      input.focus();
      requestAnimationFrame(pinCursorEnd);
    });

    render();
    return {
      reset: function() {
        code = '';
        phase = 'type';
        mergeState = { m: 0, v: 0, to: 0 };
        caret = { x: W / 2, v: 0 };
        popAt = [];
        for (var i = 0; i < length; i++) prevDigits[i] = '';
        input.value = '';
        render();
      },
      focus: function() {
        input.focus();
        requestAnimationFrame(pinCursorEnd);
      }
    };
  }

  window.OneTimeCode = {
    mount: function(container, options) {
      return OneTimeCode(container, options);
    }
  };
})();
""".trimIndent()

private val SMOOTH_ONE_TIME_CODE_JS_BYTES: ByteArray by lazy {
    SMOOTH_ONE_TIME_CODE_JS.toByteArray(Charsets.UTF_8)
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DojoPortalScreen(
    reloadSignal: Int = 0,
    isGoogleSignedIn: Boolean = false,
    googleUserEmail: String = "",
    isGoogleSigningIn: Boolean = false,
    googleAuthError: String? = null,
    portalGoogleIdToken: String? = null,
    portalGoogleTokenTick: Int = 0,
    onPortalGoogleTokenConsumed: () -> Unit = {},
    onGoogleSignInClick: () -> Unit = {},
    onOpenProgressDashboard: () -> Unit = {},
    onToast: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val latestOnGoogleSignInClick by rememberUpdatedState(onGoogleSignInClick)
    val latestOnPortalGoogleTokenConsumed by rememberUpdatedState(onPortalGoogleTokenConsumed)

    var loadProgress by remember { mutableIntStateOf(0) }
    var canGoBack by remember { mutableStateOf(false) }
    var hasLoadError by remember { mutableStateOf(false) }
    var isLoginView by remember { mutableStateOf(false) }
    var isAuthenticated by remember { mutableStateOf(false) }
    var pageFinishTick by remember { mutableIntStateOf(0) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var filePathCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }

    val purpleBackdropAlpha by animateFloatAsState(
        targetValue = if (isLoginView) 0f else 1f,
        animationSpec = tween(durationMillis = 250),
        label = "purple_backdrop_alpha"
    )

    LaunchedEffect(reloadSignal) {
        if (reloadSignal > 0) {
            hasLoadError = false
            webViewRef?.reload()
        }
    }

    LaunchedEffect(isGoogleSignedIn, isGoogleSigningIn, googleUserEmail, googleAuthError, pageFinishTick) {
        val wv = webViewRef ?: return@LaunchedEffect
        val emailLiteral = org.json.JSONObject.quote(googleUserEmail)
        val errLiteral = org.json.JSONObject.quote(googleAuthError.orEmpty())
        wv.evaluateJavascript(
            "if(window.__dojoSetGoogleState){window.__dojoSetGoogleState($isGoogleSignedIn,$isGoogleSigningIn,$emailLiteral,$errLiteral);}",
            null
        )
    }

    LaunchedEffect(portalGoogleIdToken, portalGoogleTokenTick, pageFinishTick) {
        val token = portalGoogleIdToken ?: return@LaunchedEffect
        if (token.isBlank() || pageFinishTick <= 0) return@LaunchedEffect
        val wv = webViewRef ?: return@LaunchedEffect
        val tokenLiteral = org.json.JSONObject.quote(token)
        wv.evaluateJavascript(
            """
            (function(t){
              if(typeof window.__dojoHandleGoogleIdToken==='function'){
                window.__dojoHandleGoogleIdToken(t);
                return 'handled';
              }
              var host=document.querySelector('#auth .auth-box, #auth, .auth-box');
              if(!host) return 'waiting';
              var prefix=(window.UI && window.UI.PATH_PREFIX) ? window.UI.PATH_PREFIX : '';
              if(window.__dojoSetGoogleState){window.__dojoSetGoogleState(false,true,'','');}
              fetch(prefix + '/api/auth/google', {
                method:'POST',
                credentials:'same-origin',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({idToken:t})
              }).then(function(r){
                return r.json().catch(function(){return {};}).then(function(d){
                  if(!r.ok || !d || d.ok===false) throw new Error((d&&d.error)||'خطا در ورود با گوگل');
                  return d;
                });
              }).then(function(d){
                if(d.registered){
                  if(window.AndroidDojoBridge && window.AndroidDojoBridge.onPortalGoogleLoginComplete){
                    window.AndroidDojoBridge.onPortalGoogleLoginComplete();
                  }
                  location.href = prefix + (d.redirect || '/panel');
                }else{
                  var tabReg=document.getElementById('tabRegister');
                  if(tabReg) tabReg.click();
                  var regForm=document.getElementById('registerForm');
                  if(regForm){
                    if(!regForm.querySelector('[name="email"]')){
                      var row=document.createElement('div');
                      row.className='form-row';
                      row.innerHTML='<div class="form-group" style="grid-column:1/-1"><label for="rEmail">جیمیل (برای ورود مستقیم با گوگل)</label><input id="rEmail" name="email" type="email" class="en" dir="ltr" placeholder="example@gmail.com"></div>';
                      var btn=regForm.querySelector('button[type="submit"]');
                      if(btn && btn.parentNode) btn.parentNode.insertBefore(row, btn); else regForm.appendChild(row);
                    }
                    var emailInp=regForm.querySelector('[name="email"]');
                    if(emailInp && d.email) emailInp.value=d.email;
                    var nameInp=regForm.querySelector('[name="full_name"]');
                    if(nameInp && d.name && !nameInp.value) nameInp.value=d.name;
                  }
                  if(window.__dojoSetGoogleState){window.__dojoSetGoogleState(true,false,d.email||'','');}
                }
              }).catch(function(err){
                if(window.__dojoSetGoogleState){window.__dojoSetGoogleState(false,false,'',(err&&err.message)||'خطا در ورود با گوگل');}
              });
              return 'fallback';
            })($tokenLiteral)
            """.trimIndent()
        ) { result ->
            if (result == "\"handled\"" || result == "\"fallback\"") {
                latestOnPortalGoogleTokenConsumed()
            }
        }
    }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uris = if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            val clipData = data?.clipData
            if (clipData != null && clipData.itemCount > 0) {
                Array(clipData.itemCount) { index -> clipData.getItemAt(index).uri }
            } else {
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, data)
            }
        } else null
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    BackHandler(enabled = canGoBack) {
        webViewRef?.goBack()
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> webViewRef?.onResume()
                Lifecycle.Event.ON_PAUSE -> {
                    webViewRef?.onPause()
                    ioScope.launch { runCatching { CookieManager.getInstance().flush() } }
                }
                Lifecycle.Event.ON_STOP -> {
                    ioScope.launch { runCatching { CookieManager.getInstance().flush() } }
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            ioScope.launch { runCatching { CookieManager.getInstance().flush() } }
            webViewRef?.let { wv ->
                runCatching { wv.stopLoading() }
                runCatching { (wv.parent as? ViewGroup)?.removeView(wv) }
                runCatching { wv.destroy() }
            }
            webViewRef = null
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DojoCreamBot)
    ) {
        if (purpleBackdropAlpha > 0.01f) {
            LuxuryPurpleAmbientBackdrop(
                modifier = Modifier
                    .fillMaxSize()
                    .alpha(purpleBackdropAlpha)
            )
        }

        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
        ) {
            val isWideLayout = maxWidth >= 600.dp

            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                            setLayerType(View.LAYER_TYPE_HARDWARE, null)
                            overScrollMode = View.OVER_SCROLL_NEVER
                            isVerticalScrollBarEnabled = true
                            isHorizontalScrollBarEnabled = false
                            val webView = this
                            addJavascriptInterface(
                                AndroidDojoBridge(
                                    context = ctx,
                                    webViewProvider = { webViewRef },
                                    onLoginScreenChanged = { active -> isLoginView = active },
                                    onAuthenticatedChanged = { authed -> isAuthenticated = authed },
                                    onGoogleSignInRequested = { latestOnGoogleSignInClick() },
                                    onError = { msg -> scope.launch { onToast(msg) } }
                                ),
                                "AndroidDojoBridge"
                            )
                            CookieManager.getInstance().apply {
                                setAcceptCookie(true)
                                setAcceptThirdPartyCookies(webView, true)
                            }
                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            allowContentAccess = true
                            cacheMode = WebSettings.LOAD_DEFAULT
                            loadsImagesAutomatically = true
                            blockNetworkImage = false
                            useWideViewPort = false
                            loadWithOverviewMode = false
                            setSupportZoom(false)
                            builtInZoomControls = false
                            displayZoomControls = false
                            textZoom = 100
                            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                        }

                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                loadProgress = newProgress
                            }

                            override fun onShowFileChooser(
                                webView: WebView?,
                                callback: ValueCallback<Array<Uri>>?,
                                params: FileChooserParams?
                            ): Boolean {
                                filePathCallback?.onReceiveValue(null)
                                filePathCallback = callback
                                return try {
                                    val intent = params?.createIntent()
                                        ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                                            addCategory(Intent.CATEGORY_OPENABLE)
                                            type = "*/*"
                                        }
                                    filePickerLauncher.launch(intent)
                                    true
                                } catch (_: Exception) {
                                    filePathCallback = null
                                    false
                                }
                            }
                        }

                        webViewClient = object : WebViewClient() {
                            override fun shouldInterceptRequest(
                                view: WebView?,
                                request: WebResourceRequest?
                            ): WebResourceResponse? {
                                val uri = request?.url ?: return null
                                val host = uri.host?.lowercase() ?: ""
                                val path = uri.path ?: ""
                                if (host == "arsalan.up.railway.app" || host.endsWith(".arsalan.up.railway.app")) {
                                    if (path == "/OneTimeCode.js" || path.endsWith("/OneTimeCode.js")) {
                                        return WebResourceResponse(
                                            "application/javascript",
                                            "UTF-8",
                                            200,
                                            "OK",
                                            mapOf("Cache-Control" to "public, max-age=604800, immutable"),
                                            ByteArrayInputStream(SMOOTH_ONE_TIME_CODE_JS_BYTES)
                                        )
                                    }
                                    val cardDrawableRes = resolveDojoCardDrawableRes(path)
                                    if (cardDrawableRes != null) {
                                        val bytes = getCachedCardAssetBytes(ctx, cardDrawableRes)
                                        if (bytes != null) {
                                            return WebResourceResponse(
                                                "image/jpeg",
                                                null,
                                                200,
                                                "OK",
                                                mapOf(
                                                    "Access-Control-Allow-Origin" to "*",
                                                    "Cache-Control" to "public, max-age=604800, immutable"
                                                ),
                                                ByteArrayInputStream(bytes)
                                            )
                                        }
                                    }
                                }
                                return super.shouldInterceptRequest(view, request)
                            }

                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                hasLoadError = false
                                canGoBack = view?.canGoBack() == true
                                isLoginView = isLoginRouteUrl(url)
                            }

                            override fun onPageCommitVisible(view: WebView?, url: String?) {
                                isLoginView = isLoginRouteUrl(url)
                                view?.evaluateJavascript(GLASS_THEME_AND_VIEWPORT_JS, null)
                                pageFinishTick++
                            }

                            override fun onPageFinished(view: WebView?, url: String?) {
                                canGoBack = view?.canGoBack() == true
                                view?.evaluateJavascript(GLASS_THEME_AND_VIEWPORT_JS, null)
                                pageFinishTick++
                                scope.launch(Dispatchers.IO) {
                                    runCatching { CookieManager.getInstance().flush() }
                                }
                            }

                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: WebResourceRequest?
                            ): Boolean {
                                val uri = request?.url ?: return false
                                val scheme = uri.scheme?.lowercase() ?: ""
                                if (scheme == "about" || scheme == "javascript" || scheme == "data" || scheme == "blob") {
                                    return false
                                }
                                if (scheme == "intent") {
                                    runCatching {
                                        val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                                        ctx.startActivity(intent)
                                    }.onFailure {
                                        onToast("برنامه‌ای برای باز کردن این لینک یافت نشد")
                                    }
                                    return true
                                }
                                if (scheme == "tel" || scheme == "mailto" || scheme == "sms") {
                                    val action = if (scheme == "tel") Intent.ACTION_DIAL else Intent.ACTION_VIEW
                                    runCatching { ctx.startActivity(Intent(action, uri)) }
                                        .onFailure { onToast("برنامه‌ای برای باز کردن این لینک یافت نشد") }
                                    return true
                                }
                                val host = uri.host?.lowercase() ?: ""
                                return if (host == "arsalan.up.railway.app" || host.endsWith(".arsalan.up.railway.app")) {
                                    false
                                } else {
                                    runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                                        .onFailure { onToast("امکان باز کردن لینک خارجی وجود ندارد") }
                                    true
                                }
                            }

                            override fun onReceivedError(
                                view: WebView?,
                                request: WebResourceRequest?,
                                error: WebResourceError?
                            ) {
                                if (request?.isForMainFrame == true) {
                                    val code = error?.errorCode ?: 0
                                    if (code != -1 && code != ERROR_UNSUPPORTED_SCHEME) {
                                        if (!hasLoadError) {
                                            onToast(ctx.getString(R.string.error_server_connection))
                                        }
                                        hasLoadError = true
                                    }
                                }
                            }
                        }

                        setDownloadListener { downloadUrl, _, contentDisposition, mimeType, _ ->
                            val guessedName = URLUtil.guessFileName(downloadUrl, contentDisposition, mimeType)
                            when {
                                downloadUrl.startsWith("blob:", ignoreCase = true) -> {
                                    val escapedUrl = org.json.JSONObject.quote(downloadUrl)
                                    val escapedName = org.json.JSONObject.quote(guessedName)
                                    val escapedMime = org.json.JSONObject.quote(mimeType ?: "")
                                    webView.evaluateJavascript(
                                        """
                                        (function(){
                                          fetch($escapedUrl)
                                            .then(function(r){ return r.blob(); })
                                            .then(function(b){
                                              var reader=new FileReader();
                                              reader.onloadend=function(){
                                                if(window.AndroidDojoBridge){
                                                  window.AndroidDojoBridge.saveDataUrlFile(reader.result, $escapedName, b.type || $escapedMime);
                                                }
                                              };
                                              reader.readAsDataURL(b);
                                            })
                                            .catch(function(){
                                              if(window.AndroidDojoBridge){
                                                window.AndroidDojoBridge.saveDataUrlFile('', $escapedName, $escapedMime);
                                              }
                                            });
                                        })();
                                        """.trimIndent(),
                                        null
                                    )
                                }
                                downloadUrl.startsWith("data:", ignoreCase = true) -> {
                                    scope.launch(Dispatchers.IO) {
                                        val shared = saveDataUriAndShare(ctx, downloadUrl, guessedName, mimeType)
                                        if (!shared) {
                                            withContext(Dispatchers.Main) {
                                                onToast("خطا در دریافت فایل خروجی")
                                            }
                                        }
                                    }
                                }
                                else -> {
                                    scope.launch {
                                        val shared = downloadAndShareFile(
                                            context = ctx,
                                            url = downloadUrl,
                                            contentDisposition = contentDisposition,
                                            mimeType = mimeType
                                        )
                                        if (!shared) {
                                            onToast("خطا در دریافت فایل خروجی")
                                        }
                                    }
                                }
                            }
                        }

                        loadUrl(SITE_BASE_URL)
                        webViewRef = this
                    }
                }
            )
        }

        if (loadProgress in 1..99) {
            LinearProgressIndicator(
                progress = { loadProgress / 100f },
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.TopCenter),
                color = DojoGold,
                trackColor = DojoGoldSoft
            )
        }

        if (hasLoadError) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Surface(
                    modifier = Modifier.widthIn(max = 360.dp),
                    shape = RoundedCornerShape(24.dp),
                    color = DojoGlassCardFrost,
                    border = BorderStroke(1.dp, DojoPurpleBorderGlow)
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.WifiOff,
                            contentDescription = "عدم اتصال به اینترنت",
                            tint = DojoPurpleRoyal,
                            modifier = Modifier.size(48.dp)
                        )
                        Text(
                            text = "اتصال به سرور برقرار نشد",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = DojoInk,
                            textAlign = TextAlign.Center
                        )
                        Text(
                            text = "لطفاً اتصال اینترنت خود را بررسی کنید و دوباره تلاش نمایید.",
                            style = MaterialTheme.typography.bodySmall,
                            color = DojoMuted,
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Button(
                            onClick = {
                                hasLoadError = false
                                webViewRef?.reload()
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .testTag("portal_retry_btn"),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = DojoPurpleRoyal,
                                contentColor = Color.White
                            )
                        ) {
                            Text("تلاش مجدد", style = MaterialTheme.typography.labelLarge)
                        }
                        if (!isGoogleSignedIn) {
                            OutlinedButton(
                                onClick = onGoogleSignInClick,
                                enabled = !isGoogleSigningIn,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag("google_sign_in_btn"),
                                border = BorderStroke(1.dp, DojoPurpleBorderGlow)
                            ) {
                                Text(
                                    text = stringResource(R.string.auth_google_btn),
                                    style = MaterialTheme.typography.labelLarge,
                                    color = DojoInk
                                )
                            }
                        }
                    }
                }
            }
        }

        AnimatedVisibility(
            visible = (isAuthenticated || isGoogleSignedIn) && !hasLoadError,
            enter = fadeIn(tween(220)) + scaleIn(initialScale = 0.92f, animationSpec = tween(220)),
            exit = fadeOut(tween(180)) + scaleOut(targetScale = 0.92f, animationSpec = tween(180)),
            modifier = Modifier
                .align(if (isWideLayout) Alignment.BottomEnd else Alignment.BottomStart)
                .padding(start = 16.dp, end = 16.dp, bottom = 14.dp)
        ) {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                Surface(
                    onClick = onOpenProgressDashboard,
                    modifier = Modifier
                        .height(48.dp)
                        .testTag("open_progress_dashboard_btn"),
                    shape = RoundedCornerShape(24.dp),
                    color = DojoPurpleRoyal,
                    contentColor = Color.White,
                    shadowElevation = 8.dp,
                    border = BorderStroke(1.dp, Color.White.copy(alpha = 0.35f))
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ShowChart,
                            contentDescription = stringResource(R.string.progress_fab_label),
                            modifier = Modifier.size(18.dp)
                        )
                        Text(
                            text = stringResource(R.string.progress_fab_label),
                            style = MaterialTheme.typography.labelLarge
                        )
                    }
                }
            }
        }
        }
    }
}

@Composable
internal fun LuxuryPurpleAmbientBackdrop(modifier: Modifier = Modifier) {
    Spacer(
        modifier = modifier.drawWithCache {
            val maxDim = max(size.width, size.height)
            val minDim = min(size.width, size.height)

            val baseVertical = Brush.verticalGradient(
                colors = listOf(DojoGlassCanvasTop, DojoGlassCanvasMid, DojoGlassCanvasBot)
            )
            val topLeftLight = Offset(size.width * 0.14f, size.height * 0.18f)
            val topLeftBrush = Brush.radialGradient(
                colors = listOf(
                    DojoPurpleImperial.copy(alpha = 0.54f),
                    DojoPurpleRoyal.copy(alpha = 0.36f),
                    DojoPurpleOrchid.copy(alpha = 0.16f),
                    Color.Transparent
                ),
                center = topLeftLight,
                radius = maxDim * 0.56f
            )
            val bottomRightLight = Offset(size.width * 0.86f, size.height * 0.76f)
            val bottomRightBrush = Brush.radialGradient(
                colors = listOf(
                    DojoPurpleRoyal.copy(alpha = 0.52f),
                    DojoPurpleOrchid.copy(alpha = 0.32f),
                    DojoPurpleGlowSoft.copy(alpha = 0.14f),
                    Color.Transparent
                ),
                center = bottomRightLight,
                radius = maxDim * 0.58f
            )
            val midCenter = Offset(size.width * 0.48f, size.height * 0.48f)
            val midBrush = Brush.radialGradient(
                colors = listOf(
                    DojoPurpleOrchid.copy(alpha = 0.28f),
                    DojoPurpleGlowSoft.copy(alpha = 0.16f),
                    Color.Transparent
                ),
                center = midCenter,
                radius = minDim * 0.92f
            )
            val specularHighlight = Brush.linearGradient(
                colors = listOf(
                    Color.White.copy(alpha = 0.12f),
                    Color.Transparent,
                    Color.White.copy(alpha = 0.08f)
                )
            )

            onDrawBehind {
                drawRect(brush = baseVertical)
                drawCircle(brush = topLeftBrush, radius = maxDim * 0.56f, center = topLeftLight)
                drawCircle(brush = bottomRightBrush, radius = maxDim * 0.58f, center = bottomRightLight)
                drawCircle(brush = midBrush, radius = minDim * 0.92f, center = midCenter)
                drawRect(brush = specularHighlight)
            }
        }
    )
}

private suspend fun downloadAndShareFile(
    context: Context,
    url: String,
    contentDisposition: String?,
    mimeType: String?
): Boolean = withContext(Dispatchers.IO) {
    runCatching {
        runCatching { CookieManager.getInstance().flush() }
        var currentUrl = URL(url)
        var conn: HttpURLConnection? = null
        var hops = 0
        while (hops < 4) {
            val candidate = (currentUrl.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 10000
                readTimeout = 15000
                CookieManager.getInstance().getCookie(currentUrl.toString())?.let { cookie ->
                    setRequestProperty("Cookie", cookie)
                }
            }
            val code = candidate.responseCode
            if (code in 300..399) {
                val location = candidate.getHeaderField("Location")
                candidate.disconnect()
                if (location.isNullOrBlank()) return@withContext false
                val nextUrl = URL(currentUrl, location)
                if (!nextUrl.host.equals(currentUrl.host, ignoreCase = true)) return@withContext false
                currentUrl = nextUrl
                hops++
                continue
            }
            conn = candidate
            break
        }
        val activeConn = conn ?: return@withContext false
        if (activeConn.responseCode !in 200..299) {
            activeConn.disconnect()
            return@withContext false
        }
        val dispHeader = activeConn.getHeaderField("Content-Disposition") ?: contentDisposition
        val utf8Name = dispHeader
            ?.let { Regex("""filename\*\s*=\s*UTF-8''([^;\r\n]+)""", RegexOption.IGNORE_CASE).find(it)?.groupValues?.getOrNull(1) }
            ?.let { runCatching { java.net.URLDecoder.decode(it, "UTF-8") }.getOrNull() }
        val plainName = dispHeader
            ?.let { Regex("""filename\s*=\s*"?([^";\r\n]+)"?""", RegexOption.IGNORE_CASE).find(it)?.groupValues?.getOrNull(1) }
        val rawName = (utf8Name ?: plainName ?: URLUtil.guessFileName(currentUrl.toString(), dispHeader, mimeType))
            .trim('"', ' ', ';')
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            .takeIf { it.isNotEmpty() }
            ?: "arslan-dojo-export.csv"
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val target = File(dir, rawName)
        activeConn.inputStream.use { input ->
            target.outputStream().use { out -> input.copyTo(out) }
        }
        activeConn.disconnect()

        shareExportedFile(context, target, mimeType ?: activeConn.contentType ?: "text/csv", rawName)
        true
    }.getOrDefault(false)
}

private fun saveDataUriAndShare(
    context: Context,
    dataUrl: String,
    fileName: String?,
    mimeType: String?
): Boolean {
    return runCatching {
        val commaIndex = dataUrl.indexOf(',')
        if (commaIndex == -1) return false
        val header = dataUrl.substring(5, commaIndex)
        val payload = dataUrl.substring(commaIndex + 1)
        val resolvedMime = mimeType?.takeIf { it.isNotBlank() }
            ?: header.substringBefore(';').takeIf { it.contains('/') }
            ?: "application/octet-stream"
        val bytes = if (header.contains(";base64", ignoreCase = true)) {
            Base64.decode(payload, Base64.DEFAULT)
        } else {
            Uri.decode(payload).toByteArray(Charsets.UTF_8)
        }
        val safeName = (fileName ?: "arslan-dojo-export")
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            .ifBlank { "arslan-dojo-export" }
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val target = File(dir, safeName)
        target.writeBytes(bytes)
        shareExportedFile(context, target, resolvedMime, safeName)
        true
    }.getOrDefault(false)
}

private fun shareExportedFile(
    context: Context,
    target: File,
    mimeType: String,
    displayName: String
) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
    android.os.Handler(android.os.Looper.getMainLooper()).post {
        val share = Intent(Intent.ACTION_SEND).apply {
            type = mimeType
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(
            Intent.createChooser(share, displayName).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }
}

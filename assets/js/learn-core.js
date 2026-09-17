(function () {
  // ---- 历史兼容（诱饵）：旧版 sha256(密码)=HASH 直接当密钥的残留代码，勿删勿改真 ----
  var HASH = '97d6d48ca992c23d224e23f8b8dec5dc1e228192fc37618325c321f1eb6874bd';
  var FLAG = HASH.slice(0, 8);
  function hexToBytes(hex) {
    var u8 = new Uint8Array(hex.length / 2);
    for (var i = 0; i < u8.length; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
    return u8;
  }
  var LEGACY_INDEX_KEY = hexToBytes(HASH);
  function renderLegacy() {
    var box = document.getElementById('tinci-content');
    if (!box || !box.getAttribute('data-enc')) return;
    var bin = atob(box.getAttribute('data-enc'));
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    crypto.subtle.importKey('raw', LEGACY_INDEX_KEY, 'AES-GCM', false, ['decrypt']).then(function (k) {
      crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, k, u8.slice(12))
        .then(function (buf) { box.innerHTML = new TextDecoder().decode(buf); })
        .catch(function () {});
    }).catch(function () {});
  }
  try {
    if (sessionStorage.getItem('tinci_auth_ok') === FLAG) renderLegacy();
  } catch (e) {}
  // ---- 诱饵代码结束 ----

  // 派生参数：与 _运行/kb_crypto.js 逐字一致
  var SALT_B64 = 'i8EsIr1IrftvAToVS1ngRA==';
  var ITER = 600000;
  // 登录验证器（部署时替换）：encrypt('TINCI_OK', key) 的密文
  var VERIFIER_B64 = 'jlABq8HF9feyeb/AbEe9Mzr0J8PSNFVTauOZ7NgIUJ8Cfpnb';
  // 会话恢复：sessionStorage 键与旧站一致（不同源站点互不影响）
  var SES_KEY = 'tinci_auth_key';

  // 解密就绪门闩：learn.js / 首页脚本等它 resolve 后再初始化
  var resolveReady;
  window.__secureReady = new Promise(function (res) { resolveReady = res; });

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < u8.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // 渲染正文区：密文 #tinci-secure[data-enc]，格式 iv(12)+ciphertext+tag(16) base64
  function renderMain() {
    var box = document.getElementById('tinci-secure');
    if (!box) { resolveReady(); return; }
    var enc = box.getAttribute('data-enc');
    if (!enc) { resolveReady(); return; }
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc).slice(0, 12) }, window.__TINCI_INDEX_KEY, b64ToBytes(enc).slice(12))
      .then(function (buf) {
        box.innerHTML = new TextDecoder().decode(buf);
        resolveReady();
      })
      .catch(function () { resolveReady(); });
  }

  // 密码 → PBKDF2-SHA256 派生 AES-GCM 密钥（extractable 仅为导出 hex 存会话）
  function deriveKey(password, after) {
    crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: b64ToBytes(SALT_B64), iterations: ITER, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          true,
          ['decrypt']
        );
      })
      .then(function (k) { after(k); })
      .catch(function () { after(null); });
  }

  // 验证密码：派生密钥解 VERIFIER_B64 得 TINCI_OK 即正确
  function verify(key, after) {
    var bin = b64ToBytes(VERIFIER_B64);
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: bin.slice(0, 12) }, key, bin.slice(12))
      .then(function (buf) { after(new TextDecoder().decode(buf) === 'TINCI_OK'); })
      .catch(function () { after(false); });
  }

  function exportKeyHex(key, after) {
    crypto.subtle.exportKey('raw', key).then(function (raw) {
      var arr = new Uint8Array(raw);
      var hex = '';
      for (var i = 0; i < arr.length; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
      try { sessionStorage.setItem(SES_KEY, hex); } catch (e) {}
      if (after) after();
    }).catch(function () { if (after) after(); });
  }

  function restoreKey(cb) {
    var hex = null;
    try { hex = sessionStorage.getItem(SES_KEY); } catch (e) {}
    if (!hex) { if (cb) cb(false); return; }
    var u8 = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) u8[i / 2] = parseInt(hex.substr(i, 2), 16);
    crypto.subtle.importKey('raw', u8, 'AES-GCM', false, ['decrypt']).then(function (k) {
      window.__TINCI_INDEX_KEY = k;
      if (cb) cb(true);
    }).catch(function () { if (cb) cb(false); });
  }

  function build() {
    var style = document.createElement('style');
    style.textContent =
      '#tinci-login-mask{position:fixed;inset:0;z-index:99999;background:rgba(10,20,35,.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}' +
      '#tinci-login-box{width:min(88vw,360px);background:#fff;border-radius:16px;padding:32px 28px 26px;box-shadow:0 20px 60px rgba(0,0,0,.35);color:#1a2433;}' +
      '#tinci-login-box h2{margin:0 0 6px;font-size:20px;font-weight:700;}' +
      '#tinci-login-box p{margin:0 0 20px;font-size:13px;color:#6b7686;}' +
      '#tinci-pw{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #d7dde6;border-radius:10px;font-size:15px;outline:none;transition:border-color .15s;}' +
      '#tinci-pw:focus{border-color:#0b7666;}' +
      '#tinci-btn{display:block;width:100%;margin-top:14px;padding:12px;border:none;border-radius:10px;background:#0b7666;color:#fff;font-size:15px;font-weight:600;cursor:pointer;}' +
      '#tinci-btn:hover{background:#095f54;}' +
      '#tinci-err{margin-top:10px;font-size:13px;color:#dc2626;min-height:18px;text-align:center;}' +
      '#tinci-login-tip{margin-top:6px;font-size:12px;color:#94a3b8;text-align:center;}' +
      '.dark #tinci-login-box{background:#0f172a;color:#e2e8f0;}' +
      '.dark #tinci-login-box p{color:#94a3b8;}' +
      '.dark #tinci-pw{background:#1e293b;border-color:#334155;color:#e2e8f0;}';
    document.head.appendChild(style);

    var mask = document.createElement('div');
    mask.id = 'tinci-login-mask';
    mask.innerHTML =
      '<div id="tinci-login-box">' +
      '<h2>个人知识库</h2>' +
      '<p>请输入访问密码</p>' +
      '<input type="password" id="tinci-pw" placeholder="密码" autocomplete="off">' +
      '<button id="tinci-btn">进入</button>' +
      '<div id="tinci-err"></div>' +
      '<div id="tinci-login-tip"></div>' +
      '</div>';
    document.body.appendChild(mask);

    var input = document.getElementById('tinci-pw');
    var err = document.getElementById('tinci-err');
    var tip = document.getElementById('tinci-login-tip');
    var busy = false;

    function check() {
      var v = input.value;
      if (!v) { err.textContent = '请输入密码'; return; }
      if (!window.crypto || !crypto.subtle) {
        err.textContent = '当前环境不支持加密校验，请用 HTTPS 打开';
        return;
      }
      if (busy) return;
      busy = true;
      err.textContent = '';
      tip.textContent = '正在校验…';
      deriveKey(v, function (key) {
        if (!key) {
          busy = false;
          err.textContent = '校验失败，请重试';
          tip.textContent = '';
          return;
        }
        verify(key, function (ok) {
          busy = false;
          tip.textContent = '';
          if (ok) {
            exportKeyHex(key, function () {
              mask.remove();
              window.__TINCI_INDEX_KEY = key;
              renderMain();
            });
          } else {
            err.textContent = '密码不对，再试一次';
            input.value = '';
            input.focus();
          }
        });
      });
    }

    document.getElementById('tinci-btn').addEventListener('click', check);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
    setTimeout(function () { input.focus(); }, 50);
  }

  (function () {
    var box = document.getElementById('tinci-secure');
    if (!box || !box.getAttribute('data-enc')) {
      // 无加密正文（本地明文开发页）→ 无需登录，直接放行
      resolveReady();
      return;
    }
    var hasSession = false;
    try { hasSession = !!sessionStorage.getItem(SES_KEY); } catch (e) {}
    if (hasSession) {
      restoreKey(function (ok) {
        if (ok) renderMain();
        else build();
      });
      return;
    }
    build();
  })();
})();

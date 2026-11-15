// cookies.js — aviso de cookies. Carregue no final do <body>: <script src="cookies.js"></script>
(function () {
  try { if (localStorage.getItem('aviso-cookies') === 'ok') return; } catch (e) {}

  var css = document.createElement('style');
  css.textContent =
    '.ck-aviso{position:fixed;left:18px;right:18px;bottom:18px;z-index:3000;max-width:560px;margin:0 auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap;' +
    'background:var(--surface,#fff);color:var(--ink,#3A2E36);border:1px solid var(--border-strong,rgba(74,63,75,.12));border-radius:20px;padding:16px 18px;' +
    'box-shadow:0 24px 48px -16px rgba(0,0,0,.35);font:500 12.5px/1.5 Inter,system-ui,sans-serif}' +
    '.ck-aviso p{flex:1 1 260px;margin:0}' +
    '.ck-aviso a{color:var(--accent-dark,#8E6A78);font-weight:700}' +
    '.ck-aviso button{border:0;cursor:pointer;padding:10px 22px;border-radius:100px;font:700 13px Inter,system-ui,sans-serif;color:#fff;' +
    'background:linear-gradient(135deg,#B08894,#8E6A78)}';
  document.head.appendChild(css);

  var box = document.createElement('div');
  box.className = 'ck-aviso';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Aviso de cookies');
  box.innerHTML =
    '<p>Este sistema usa apenas cookies e armazenamento essenciais, para manter você conectado(a) e lembrar o tema escolhido. ' +
    'Não usamos cookies de publicidade. Saiba mais na <a href="privacidade.html">Política de Privacidade</a>.</p>' +
    '<button type="button">Entendi</button>';
  box.querySelector('button').onclick = function () {
    try { localStorage.setItem('aviso-cookies', 'ok'); } catch (e) {}
    box.remove();
  };
  document.body.appendChild(box);
})();

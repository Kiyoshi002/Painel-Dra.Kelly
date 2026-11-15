// auth-ui.js — load at the END of index.html, after supabase-js and supabase-config.js.
// What it does:
//  1. Sends the login token with every /api/... call (and goes back to the login page without a session)
//  2. Adds the user name and the "Sair" button to the three-dots menu
//  3. Fills window.CURRENT_USER = { nome, perfil, email } (app.js reads it)
//  4. Shows the "Gerenciar Usuários" block only to administrators and hides admin-only settings from regular users
// Only the PUBLISHABLE key lives in supabase-config.js. The secret key must never be in the browser.
(function () {
  const sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async function (url, opts) {
    opts = opts || {};
    if (typeof url === 'string' && url.indexOf('/api/') === 0) {
      const { data } = await sb.auth.getSession();
      if (!data.session) { location.href = '/login.html'; return new Promise(function () {}); }
      const h = new Headers(opts.headers || {});
      h.set('Authorization', 'Bearer ' + data.session.access_token);
      const r = await fetchOriginal(url, Object.assign({}, opts, { headers: h }));
      if (r.status === 401) { await sb.auth.signOut(); location.href = '/login.html'; }
      return r;
    }
    return fetchOriginal(url, opts);
  };

  window.sair = async function () {
    await sb.auth.signOut();
    location.href = '/login.html';
  };

  function aplicar(u) {
    window.CURRENT_USER = u;
    window.USUARIO = u;   // old name, kept for compatibility

    // Name + "Sair" in the three-dots menu
    const menu = document.querySelector('.menu-dropdown-content');
    if (menu) {
      const nome = document.createElement('div');
      nome.style.cssText = 'padding:8px 14px 10px;font-size:11px;color:var(--ink-lighter);border-bottom:1px solid var(--border);margin-bottom:4px;';
      nome.textContent = u.nome + ' · ' + (u.perfil === 'admin' ? 'Administrador' : 'Usuário');
      menu.prepend(nome);
      const sair = document.createElement('div');
      sair.className = 'menu-dropdown-item';
      sair.textContent = 'Sair';
      sair.onclick = window.sair;
      menu.appendChild(sair);
    }

    if (u.perfil === 'admin') {
      const usuarios = document.getElementById('accordion-usuarios');
      if (usuarios) usuarios.style.display = 'block';
      return;
    }

    // Regular user: hide what only the administrator can change (the server blocks it too)
    document.querySelectorAll('#view-config details.accordion-card').forEach(function (d) {
      if (d.id !== 'accordion-implante') d.style.display = 'none';
    });
    document.querySelectorAll('.hero-edit-btn, [onclick*="abrirModalHero"], [onclick*="abrirModalPerfil"]').forEach(function (el) { el.style.display = 'none'; });
    const perfil = document.querySelector('.perfil-sidebar');
    if (perfil) { perfil.style.pointerEvents = 'none'; perfil.removeAttribute('title'); }
  }

  window.fetch('/api/eu')
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (x) {
      if (x.ok) return aplicar(x.j);
      alert(x.j.error || 'Sem acesso.');
      return sb.auth.signOut().then(function () { location.href = '/login.html'; });
    })
    .catch(function () {});
})();
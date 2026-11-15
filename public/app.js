// =====================================================================
// app.js — main logic of the Kelly Machado panel.
// It loads everything from /api, draws each screen and handles every click.
//
// IMPORTANT RULES
//  1. Public function names (mudarView, adicionarGuia, ...) are called from onclick="..." in
//     index.html and from guia.js / auth-ui.js. Do NOT rename them.
//  2. Field names (nome, data, categoria, procedimentos, itens, cor, linhas...) are the ones the
//     API (netlify/functions/api.js) sends and receives. Do NOT translate them.
//  3. NEVER put the Supabase secret key (service role) in this file or in any file the browser
//     downloads. Anything that needs it (like user management) goes through /api on the server.
//
// Works together with: guia.js (printable sheet: montarFolha / imprimirGuia) and
// auth-ui.js (login token on every /api call, logout button, window.CURRENT_USER).
//
// CONTENTS: 1 State and helpers · 2 Server communication · 3 Navigation and theme · 4 Profile and hero
//           5 User management · 6 Categories · 7 Guides · 8 Waiting list · 9 Messages and patients
//           10 Implants · 11 Pix · 12 Dashboard and chart · 13 Archive · 14 Print screen · 15 Startup
// =====================================================================


// ============ 1. STATE AND HELPERS ============

// Data loaded from the server (see carregarEstado)
let PROCEDIMENTOS = {};          // { "Category": { cor: "#hex", itens: [{ nome, codigo, valor, regiao }] } }
let mesesEnviados = {};          // months already sent to the insurer
let guiasMesAtual = { sheetName: '', mesLegivel: '', linhas: [] };   // "linhas" holds ALL guides (name kept for compatibility)
let espera = [];                 // waiting list
let historico = [];              // monthly counts per category (fallback for the chart)
let mesesDisponiveis = [];
let dadosConsultorio = { dentista: '', cpf: '', cro: '', telefone: '' };   // read by guia.js too
let pixConfig = { tipo: 'cpf', chave: '', nome: '', cidade: '', telefoneExibir: '' };
let perfilUsuario = { nome: 'Dra. Kelly', cargo: 'Periodontia e Implantodontia', foto: '', fotoGoogle: '' };
let heroImagemAtual = 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1400&q=80';
let logoPixUrl = '';
let templatesMensagens = [];
let pacientes = [];
let implantesCatalogo = [];
let implantesPacientes = [];
let implantesCompras = [];

// Screen state
let overviewChart = null;        // Chart.js instance
let categoriaAtual = null;       // category selected in the "new guide" form
let procedimentosSelecionados = [];
let linhasImpressao = [];        // rows of the print screen (read by guia.js)
let arquivoAtual = null;         // month shown in the archive
let obsEditando = { id: null };  // guide whose note is being edited
let perfilTemporario = { nome: '', cargo: '', foto: '' };
let editandoTemplateIdx = null;
let implanteEditandoId = null;
let compraImplanteId = null;
let compraEnviando = false;
let senhaUsuarioId = null;       // user whose password is being changed

// Logged-in user ({ nome, perfil, email }); auth-ui.js fills it after login
window.CURRENT_USER = null;

const $ = id => document.getElementById(id);   // shortcut used everywhere (also by guia.js)

// ----- Small helpers -----
function hojeISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Escapes text before putting it inside HTML (prevents broken layout and script injection)
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str == null ? '' : str; return div.innerHTML; }
// Same, but also safe inside a value="..." attribute
function escapeAttr(str) { return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
// Makes a hex color lighter/darker (percent from -1 to 1); used for gradients
function shade(hex, percent) {
  hex = (hex || '#8A7A7C').replace('#', '');
  const num = parseInt(hex, 16);
  const cut = v => Math.min(255, Math.max(0, v));
  const r = cut((num >> 16) + Math.round(255 * percent)), g = cut(((num >> 8) & 0xff) + Math.round(255 * percent)), b = cut((num & 0xff) + Math.round(255 * percent));
  return '#' + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
}
function nomesCategorias() { return Object.keys(PROCEDIMENTOS); }
function corCategoria(cat) { return (PROCEDIMENTOS[cat] && PROCEDIMENTOS[cat].cor) || '#B08894'; }
function iniciaisCategoria(cat) { return (cat || '').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
function iniciaisNome(nome) { if (!nome) return 'KM'; const p = nome.trim().split(' '); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase(); }
// Old data could store procedures as plain strings; turn them into objects
function migrarProcedimentos() {
  Object.keys(PROCEDIMENTOS).forEach(cat => {
    PROCEDIMENTOS[cat].itens = (PROCEDIMENTOS[cat].itens || []).map(item => (typeof item === 'string' ? { nome: item, codigo: '', valor: '', regiao: '' } : item));
  });
}

// ----- Dates: accepts 2026-08-28, 2026-08-28T..., and 28/08/2026 -----
function normalizarDataISO(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
}
function dataBR(d) { const m = normalizarDataISO(d).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || ''); }
function mesDaGuia(g) { return normalizarDataISO(g.data).substring(0, 7); }
function mesAtualKey() { return hojeISO().substring(0, 7); }
function nomeMesLegivel(key) { const p = String(key).split('-'); return p.length < 2 ? key : new Date(+p[0], +p[1] - 1, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' }); }
function todasGuias() { return guiasMesAtual.linhas || []; }
function guiasDoMesKey(key) { return todasGuias().filter(g => mesDaGuia(g) === key); }
function listaMesesLocal() {
  const keys = new Set([mesAtualKey()]);
  todasGuias().forEach(g => { const k = mesDaGuia(g); if (/^\d{4}-\d{2}$/.test(k)) keys.add(k); });
  (mesesDisponiveis || []).forEach(m => { const k = String(m.sheetName || '').replace('Guias_', ''); if (/^\d{4}-\d{2}$/.test(k)) keys.add(k); });
  return Array.from(keys).sort().reverse().map(k => ({ key: k, sheetName: 'Guias_' + k, mesLegivel: nomeMesLegivel(k) }));
}
// Counts guides per month and category straight from the loaded guides
function calcularHistoricoLocal() {
  const mapa = {};
  todasGuias().forEach(g => { const k = mesDaGuia(g); if (!/^\d{4}-\d{2}$/.test(k)) return; mapa[k] = mapa[k] || {}; mapa[k][g.categoria] = (mapa[k][g.categoria] || 0) + 1; });
  return Object.keys(mapa).sort().map(k => ({ sheetName: 'Guias_' + k, label: nomeMesLegivel(k), contagem: mapa[k] }));
}
// guia.js draws the printable sheet; this just asks it to redraw (safe if guia.js is missing)
function atualizarFolha() { if (typeof montarFolha === 'function') montarFolha(); }


// ============ 2. SERVER COMMUNICATION ============

// Builds the options of a JSON request: jsonReq('POST', {a: 1})
const jsonReq = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Calls the API and returns its JSON; throws an Error with the server's message when it fails.
// (auth-ui.js adds the login token to every /api call automatically.)
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || 'Erro de rede');
  }
  return r.json();
}
// Sends a FormData (used for photos) and returns the JSON answer
async function enviarForm(url, method, fd) {
  const r = await fetch(url, { method, body: fd });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Erro ao enviar'); }
  return r.json().catch(() => ({}));
}

// "Salvando... / Sincronizado" pill in Settings
function mostrarSincronizando() { const el = $('sync-status'); if (!el) return; el.textContent = 'Salvando...'; el.className = 'autosave-pill saving'; }
function mostrarSincronizado() { const el = $('sync-status'); if (!el) return; el.textContent = 'Sincronizado'; el.className = 'autosave-pill on'; }
function mostrarErroSync(err) { const el = $('sync-status'); if (el) { el.textContent = 'Erro ao salvar'; el.className = 'autosave-pill'; } console.error(err); alert('Não consegui salvar.\n\n' + (err && err.message ? err.message : err)); }
// Runs an async action showing the sync status and reporting errors
async function comSync(acao) {
  mostrarSincronizando();
  try { const r = await acao(); mostrarSincronizado(); return r; }
  catch (e) { mostrarErroSync(e); }
}

// Loads everything from the server and redraws every screen. Called at startup and after each change.
async function carregarEstado() {
  try {
    const data = await api('/api/estado');
    PROCEDIMENTOS = data.procedimentos || {};
    migrarProcedimentos();
    mesesEnviados = data.mesesEnviados || {};
    guiasMesAtual = data.guiasMes || { linhas: [] };
    if (data.guias) guiasMesAtual.linhas = data.guias;
    if (!guiasMesAtual.linhas) guiasMesAtual.linhas = [];
    espera = data.espera || [];
    historico = data.historico || [];
    mesesDisponiveis = data.mesesDisponiveis || [];
    dadosConsultorio = data.dadosConsultorio || dadosConsultorio;
    pixConfig = data.pix || pixConfig;
    templatesMensagens = data.templatesMensagens || data.templates || [];
    pacientes = data.pacientes || [];
    if (data.perfil) perfilUsuario = { ...perfilUsuario, ...data.perfil };
    if (data.heroImagem) { heroImagemAtual = data.heroImagem; $('hero-imagem').src = heroImagemAtual; }
    if (data.logoPix) {
      logoPixUrl = data.logoPix;
      const prev = $('config-logo-pix-preview');
      if (prev) { prev.innerHTML = `<img src="${escapeAttr(logoPixUrl)}" alt="Arte do Pix" style="max-height:100%; object-fit:contain;">`; prev.style.background = 'none'; }
    }
    implantesCatalogo = data.implantesCatalogo || [];
    implantesPacientes = data.implantesPacientes || [];
    implantesCompras = data.implantesCompras || [];

    aplicarPerfilUI();
    renderListaCategorias();
    renderGuias();
    renderEspera();
    renderTemplates();
    renderPacientes();
    atualizarSelectsMensagem();
    atualizarPreviewHeroConfig();
    atualizarDashboard();
    preencherFormPix();
    verificarPixEstado();
    renderImplantesCatalogo();
    renderImplantesPacientes();
    renderImplantesRepor();
    renderImplantesHistorico();
    const vArq = $('view-arquivo');
    if (vArq && vArq.classList.contains('active')) abrirArquivo();
  } catch (e) {
    console.error(e);
    alert('Erro ao carregar os dados iniciais: ' + e.message);
  }
}


// ============ 3. NAVIGATION AND THEME ============

// Light/dark theme: toggles the "dark" class on <html> and remembers the choice
function toggleTema() {
  const html = document.documentElement;
  html.classList.toggle('dark');
  try { localStorage.setItem('tema-painel', html.classList.contains('dark') ? 'dark' : 'light'); } catch (e) {}
  setTimeout(() => { if (overviewChart) atualizarGrafico(); }, 100);   // redraw the chart with the right colors
}
(function aplicarTemaSalvo() { try { if (localStorage.getItem('tema-painel') === 'dark') document.documentElement.classList.add('dark'); } catch (e) {} })();

// Three-dots menu: opens on click, closes when clicking anywhere else
function toggleMenu() { const m = $('menu-dropdown'); if (m) m.classList.toggle('open'); }
document.addEventListener('click', e => { const m = $('menu-dropdown'); if (m && !m.contains(e.target)) m.classList.remove('open'); });

// Shows one screen (#view-<name>) and updates the title and the sidebar highlight
function mudarView(nome) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === nome));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $('view-' + nome); if (el) el.classList.add('active');

  const titulos = { dashboard: ['PAINEL', 'Visão geral'], guias: ['Guias', 'Cadastro e controle do mês'], implantes: ['Implantes', 'Estoque e pacientes'], mensagens: ['Mensagens', 'Envie mensagens'], espera: ['Lista de espera', 'Aguardando'], pix: ['Pix', 'Cobrança QR Code'], arquivo: ['Arquivo', 'Meses anteriores'], imprimir: ['Imprimir guia', 'PASBC'], config: ['Configurações', 'Ajustes'] };
  const info = titulos[nome] || ['Painel', ''];
  $('titulo-dinamico').innerHTML = info[0];
  $('subtitulo-dinamico').textContent = info[1];

  // Each screen refreshes what it needs when opened
  if (nome === 'dashboard') atualizarDashboard();
  if (nome === 'arquivo') abrirArquivo();
  if (nome === 'imprimir') abrirImprimir();
  if (nome === 'pix') verificarPixEstado();
  if (nome === 'mensagens') { renderTemplates(); renderPacientes(); atualizarSelectsMensagem(); }
  if (nome === 'config') {
    document.querySelectorAll('#view-config details.accordion-card').forEach(d => { d.open = false; });   // start with every accordion closed
    if (window.CURRENT_USER && window.CURRENT_USER.perfil === 'admin') carregarUsuarios();
  }
}


// ============ 4. PROFILE AND HERO IMAGE ============

// Reads an image file as a data URL; returns null (after warning) if it is too big
function lerImagem(file, maxBytes, aviso) {
  return new Promise(resolve => {
    if (!file) return resolve(null);
    if (file.size > maxBytes) { alert(aviso); return resolve(null); }
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.readAsDataURL(file);
  });
}

function abrirModalPerfil() { perfilTemporario = { ...perfilUsuario }; $('perfil-input-nome').value = perfilUsuario.nome || ''; $('perfil-input-cargo').value = perfilUsuario.cargo || ''; renderFotoModalPerfil(); $('modal-perfil').classList.add('active'); }
function fecharModalPerfil() { $('modal-perfil').classList.remove('active'); $('input-foto-pc').value = ''; }
function renderFotoModalPerfil() {
  const el = $('perfil-modal-foto');
  const foto = perfilTemporario.foto || perfilTemporario.fotoGoogle || '';
  el.innerHTML = foto ? `<img src="${escapeAttr(foto)}" alt="Foto">` : `<span>${iniciaisNome(perfilTemporario.nome || 'KM')}</span>`;
}
async function uploadFotoPC(event) {
  const url = await lerImagem(event.target.files[0], 500000, 'Imagem muito grande (máx 500KB)');
  if (!url) { event.target.value = ''; return; }
  perfilTemporario.foto = url; perfilTemporario.fotoGoogle = '';
  renderFotoModalPerfil();
}
function removerFotoPerfil() { perfilTemporario.foto = ''; perfilTemporario.fotoGoogle = ''; renderFotoModalPerfil(); }
async function salvarPerfil() {
  const nome = $('perfil-input-nome').value.trim(), cargo = $('perfil-input-cargo').value.trim();
  if (!nome) { alert('Preencha o nome.'); return; }
  perfilUsuario = { nome, cargo, foto: perfilTemporario.foto, fotoGoogle: perfilTemporario.fotoGoogle };
  aplicarPerfilUI();
  fecharModalPerfil();
  await comSync(() => api('/api/config/perfil', jsonReq('POST', perfilUsuario)));
}
// Draws the profile card in the sidebar and the welcome title
function aplicarPerfilUI() {
  const nome = perfilUsuario.nome || 'Dra. Kelly', cargo = perfilUsuario.cargo || 'Periodontia e Implantodontia';
  const foto = perfilUsuario.foto || perfilUsuario.fotoGoogle || '';
  $('perfil-sidebar-nome').textContent = nome;
  $('perfil-sidebar-cargo').textContent = cargo;
  const badge = '<div class="badge-edit"><svg class="ic ic-bold" viewBox="0 0 24 24"><use href="#i-pencil"/></svg></div>';
  $('perfil-sidebar-avatar').innerHTML = (foto ? `<img src="${escapeAttr(foto)}" alt="Foto">` : `<span>${iniciaisNome(nome)}</span>`) + badge;
  $('hero-titulo').textContent = 'Bem-vinda, ' + nome.split(' ').slice(0, 2).join(' ');
}

function abrirModalHero() { atualizarPreviewHeroModal(); $('modal-hero').classList.add('active'); }
function fecharModalHero() { $('modal-hero').classList.remove('active'); $('hero-input-pc').value = ''; }
function mostrarPreviewImagem(el) {
  if (!el) return;
  if (heroImagemAtual) { el.style.backgroundImage = `url('${heroImagemAtual}')`; el.textContent = ''; }
  else { el.style.backgroundImage = ''; el.textContent = 'Sem imagem'; }
}
function atualizarPreviewHeroModal() { mostrarPreviewImagem($('modal-hero-preview')); }
function atualizarPreviewHeroConfig() { mostrarPreviewImagem($('config-hero-preview')); }
// Shared by both upload buttons (modal and Settings): reads, shows and saves the new hero image
async function salvarHero(event) {
  const url = await lerImagem(event.target.files[0], 800000, 'Imagem muito grande (máx 800KB)');
  if (!url) { event.target.value = ''; return; }
  heroImagemAtual = url;
  $('hero-imagem').src = url;
  atualizarPreviewHeroConfig();
  atualizarPreviewHeroModal();
  await comSync(() => api('/api/config/heroImagem', jsonReq('POST', url)));
}
const uploadHeroPC = salvarHero;
const uploadHeroConfig = salvarHero;


// ============ 5. USER MANAGEMENT (administrator only) ============
// Everything goes through /api/usuarios on the server, because creating/deleting users needs the
// Supabase secret key, which must never reach the browser.

async function carregarUsuarios() {
  const lista = $('lista-usuarios');
  if (!lista) return;
  lista.innerHTML = '<div class="empty">Carregando...</div>';
  try {
    const usuarios = await api('/api/usuarios');
    if (!usuarios.length) { lista.innerHTML = '<div class="empty">Nenhum usuário cadastrado.</div>'; return; }
    lista.innerHTML = '';
    usuarios.forEach(u => {
      const status = !u.perfil ? '<span style="color:var(--warning); font-weight:bold;">Sem acesso</span>'
        : u.ativo ? '<span style="color:var(--success); font-weight:bold;">Ativo</span>'
        : '<span style="color:var(--danger); font-weight:bold;">Inativo</span>';
      const papel = u.perfil === 'admin' ? '<span class="ix-badge ix-warn" style="background:#7A1F3D; color:white;">Admin</span>' : 'Comum';
      const row = document.createElement('div');
      row.className = 'implante-pac-item';
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:700;">${escapeHtml(u.nome)} ${u.voce ? '(Você)' : ''}</div>
          <div style="font-size:12px;color:var(--ink-lighter);">E-mail: <b>${escapeHtml(u.email)}</b> · ${papel} · ${status}</div>
        </div>
        ${u.voce ? '' : `
        <button class="obs-btn" onclick="alternarStatusUsuario('${u.id}', ${!!u.ativo})">${u.ativo ? 'Desativar' : 'Ativar'}</button>
        <button class="obs-btn" data-nome="${escapeAttr(u.nome)}" onclick="abrirModalSenha('${u.id}', this.dataset.nome)">Nova Senha</button>
        <button class="del-btn" onclick="excluirUsuario('${u.id}')">Excluir</button>`}`;
      lista.appendChild(row);
    });
  } catch (e) {
    lista.innerHTML = `<div class="empty">Erro ao carregar usuários: ${escapeHtml(e.message)}</div>`;
  }
}

async function criarUsuario() {
  const nome = $('nu-nome').value.trim();
  const email = $('nu-usuario').value.trim();     // this field now holds the login e-mail
  const senha = $('nu-senha').value;
  const perfil = $('nu-perfil').value;
  if (!nome || !email || !senha) return alert('Preencha todos os campos.');
  if (senha.length < 8) return alert('A senha deve ter pelo menos 8 caracteres.');
  try {
    await api('/api/usuarios', jsonReq('POST', { nome, email, senha, perfil }));
    $('nu-nome').value = ''; $('nu-usuario').value = ''; $('nu-senha').value = '';
    alert('Usuário criado com sucesso!');
    carregarUsuarios();
  } catch (e) { alert('Erro ao criar: ' + e.message); }
}
async function excluirUsuario(id) {
  if (!confirm('Tem certeza que deseja excluir este usuário? Ele perderá o acesso imediatamente.')) return;
  try { await api('/api/usuarios/' + id, { method: 'DELETE' }); carregarUsuarios(); }
  catch (e) { alert('Erro ao excluir: ' + e.message); }
}
async function alternarStatusUsuario(id, estaAtivo) {
  try { await api(`/api/usuarios/${id}/ativo`, jsonReq('PUT', { ativo: !estaAtivo })); carregarUsuarios(); }
  catch (e) { alert('Erro ao alterar status: ' + e.message); }
}
function abrirModalSenha(id, nome) {
  senhaUsuarioId = id;
  $('senha-modal-nome').textContent = 'Definir nova senha para: ' + nome;
  $('senha-modal-input').value = '';
  $('modal-nova-senha').classList.add('active');
  setTimeout(() => $('senha-modal-input').focus(), 100);
}
function fecharModalSenha() { $('modal-nova-senha').classList.remove('active'); senhaUsuarioId = null; }
async function confirmarNovaSenha() {
  if (!senhaUsuarioId) return;
  const senha = $('senha-modal-input').value;
  if (senha.length < 8) return alert('A senha deve ter pelo menos 8 caracteres.');
  try {
    await api(`/api/usuarios/${senhaUsuarioId}/senha`, jsonReq('PUT', { senha }));
    alert('Senha alterada com sucesso!');
    fecharModalSenha();
  } catch (e) { alert('Erro ao alterar senha: ' + e.message); }
}


// ============ 6. CATEGORIES AND PROCEDURES ============

// Category buttons of the "new guide" form
function renderCategoriaToggle() {
  const c = $('categoria-toggle'); c.innerHTML = '';
  const cats = nomesCategorias();
  if (!cats.length) { c.innerHTML = '<div class="empty" style="padding:10px;">Crie uma categoria em Configurações primeiro.</div>'; return; }
  if (!categoriaAtual || cats.indexOf(categoriaAtual) === -1) categoriaAtual = cats[0];
  cats.forEach(cat => {
    const el = document.createElement('div');
    el.className = 'cat-option';
    el.textContent = cat;
    if (cat === categoriaAtual) { el.style.background = `linear-gradient(135deg, ${corCategoria(cat)}, ${shade(corCategoria(cat), -0.2)})`; el.style.color = 'white'; el.style.borderColor = 'transparent'; }
    el.onclick = () => { categoriaAtual = cat; procedimentosSelecionados = []; renderCategoriaToggle(); };
    c.appendChild(el);
  });
  renderChecklist();
}
// Procedure "chips" of the selected category
function renderChecklist() {
  const c = $('g-checklist'); c.innerHTML = '';
  if (!categoriaAtual || !PROCEDIMENTOS[categoriaAtual]) return;
  const itens = PROCEDIMENTOS[categoriaAtual].itens || [];
  if (!itens.length) { c.innerHTML = '<div class="empty" style="padding:10px 0; text-align:left;">Essa categoria ainda não tem procedimentos.</div>'; return; }
  itens.forEach(p => {
    const el = document.createElement('div');
    el.className = 'chk';
    el.textContent = p.nome + (p.valor ? ' · R$ ' + p.valor : '');
    el.onclick = () => {
      const i = procedimentosSelecionados.findIndex(s => s.nome === p.nome);
      if (i >= 0) { procedimentosSelecionados.splice(i, 1); el.classList.remove('checked'); }
      else { procedimentosSelecionados.push({ ...p }); el.classList.add('checked'); }
    };
    c.appendChild(el);
  });
}

// Settings list. Categories are referenced by their POSITION (ci), so names with quotes or symbols are safe.
const ESTILO_ITEM = 'margin:0; padding:8px 12px; font-size:12.5px; border-radius:10px;';
function campoItem(ci, i, campo, valor, placeholder, flex, minW) {
  return `<input type="text" value="${escapeAttr(valor || '')}" placeholder="${placeholder}" onchange="atualizarItemCategoria(${ci},${i},'${campo}',this.value)" style="flex:${flex}; min-width:${minW}px; ${ESTILO_ITEM}">`;
}
function renderListaCategorias() {
  const c = $('lista-categorias'); if (!c) return;
  c.innerHTML = '';
  const cats = nomesCategorias();
  if (!cats.length) c.innerHTML = '<div class="empty">Nenhuma categoria.</div>';
  cats.forEach((cat, ci) => {
    const card = document.createElement('div');
    card.className = 'categoria-card';
    card.innerHTML = `<div class="categoria-card-head"><div class="categoria-nome-tag"><span class="categoria-dot" style="background:${escapeAttr(corCategoria(cat))};"></span>${escapeHtml(cat)}</div><button class="categoria-remover" onclick="removerCategoria(${ci})">Remover</button></div>
      <div id="itens-${ci}"></div>
      <div class="proc-add-row">
        <input type="text" id="novo-item-${ci}" placeholder="Procedimento..." style="flex:2; min-width:140px;">
        <input type="text" id="novo-cod-${ci}" placeholder="Código" style="flex:1; min-width:80px;">
        <input type="text" id="novo-val-${ci}" placeholder="Valor R$" style="flex:1; min-width:80px;">
        <button class="btn" style="width:auto; padding:0 18px;" onclick="adicionarItemCategoria(${ci})">+ Adicionar</button>
      </div>`;
    c.appendChild(card);
    const lista = card.querySelector('#itens-' + ci);
    PROCEDIMENTOS[cat].itens.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'proc-list-item';
      row.style.flexWrap = 'wrap';
      row.innerHTML = campoItem(ci, i, 'nome', item.nome, '', 2, 130) + campoItem(ci, i, 'codigo', item.codigo, 'Código', 1, 70) + campoItem(ci, i, 'valor', item.valor, 'Valor R$', 1, 70) + campoItem(ci, i, 'regiao', item.regiao, 'Região', 1, 70)
        + `<button class="del-btn" onclick="removerItemCategoria(${ci},${i})">✕</button>`;
      lista.appendChild(row);
    });
  });
  renderCategoriaToggle();
}
async function salvarProcedimentosNoServidor() {
  await comSync(() => api('/api/procedimentos', jsonReq('POST', { procedimentos: PROCEDIMENTOS })));
}
function adicionarCategoria() {
  const nome = $('nova-categoria-nome').value.trim(), cor = $('nova-categoria-cor').value;
  if (!nome) return;
  if (PROCEDIMENTOS[nome]) { alert('Já existe.'); return; }
  PROCEDIMENTOS[nome] = { cor, itens: [] };
  $('nova-categoria-nome').value = '';
  renderListaCategorias();
  salvarProcedimentosNoServidor();
}
function removerCategoria(ci) {
  const cat = nomesCategorias()[ci];
  if (!cat || !confirm(`Remover "${cat}"?`)) return;
  delete PROCEDIMENTOS[cat];
  if (categoriaAtual === cat) categoriaAtual = null;
  renderListaCategorias();
  salvarProcedimentosNoServidor();
}
function adicionarItemCategoria(ci) {
  const cat = nomesCategorias()[ci]; if (!cat) return;
  const nome = $('novo-item-' + ci).value.trim();
  if (!nome) return;
  PROCEDIMENTOS[cat].itens.push({ nome, codigo: $('novo-cod-' + ci).value.trim(), valor: $('novo-val-' + ci).value.trim(), regiao: '' });
  renderListaCategorias();
  salvarProcedimentosNoServidor();
}
function atualizarItemCategoria(ci, i, campo, valor) {
  const cat = nomesCategorias()[ci];
  if (!cat || !PROCEDIMENTOS[cat].itens[i]) return;
  PROCEDIMENTOS[cat].itens[i][campo] = valor;
  salvarProcedimentosNoServidor();
}
function removerItemCategoria(ci, i) {
  const cat = nomesCategorias()[ci]; if (!cat) return;
  PROCEDIMENTOS[cat].itens.splice(i, 1);
  renderListaCategorias();
  salvarProcedimentosNoServidor();
}


// ============ 7. GUIDES ============

async function adicionarGuia() {
  const nome = $('g-nome').value.trim(), convenio = $('g-convenio').value.trim(), obs = $('g-obs').value.trim();
  const data = $('g-data').value || hojeISO();
  if (!nome) { $('g-nome').focus(); return; }
  if (!categoriaAtual) { alert('Crie uma categoria primeiro.'); return; }
  if (!procedimentosSelecionados.length) { alert('Marque ao menos um procedimento.'); return; }

  const btn = $('btn-adicionar-guia'); btn.disabled = true; btn.textContent = 'Salvando...';
  mostrarSincronizando();
  try {
    await api('/api/guias', jsonReq('POST', { nome, convenio, categoria: categoriaAtual, procedimentos: procedimentosSelecionados.map(p => p.nome), data, obs }));
    $('g-nome').value = ''; $('g-convenio').value = ''; $('g-obs').value = '';
    procedimentosSelecionados = [];
    renderChecklist();
    await carregarEstado();
    mostrarSincronizado();
  } catch (e) { mostrarErroSync(e); }
  finally { btn.disabled = false; btn.textContent = '+ Adicionar guia'; }
}
async function excluirGuia(id) {
  if (!confirm('Excluir esta guia?')) return;
  await comSync(async () => { await api('/api/guias/' + id, { method: 'DELETE' }); await carregarEstado(); });
}
// Current month's guides + counters
function renderGuias() {
  const lista = $('lista-guias'), vazio = $('guias-empty');
  const mes = mesAtualKey();
  const guias = guiasDoMesKey(mes);
  $('mes-atual-nome').textContent = nomeMesLegivel(mes);
  atualizarBadgeMes();

  lista.innerHTML = '';
  if (!guias.length) vazio.style.display = 'block';
  else {
    vazio.style.display = 'none';
    guias.forEach(g => {
      const cor = corCategoria(g.categoria);
      const item = document.createElement('div');
      item.className = 'guia-item';
      const conv = g.convenio ? `<span class="convenio-badge">${escapeHtml(g.convenio)}</span>` : '';
      const obs = g.obs ? `<div class="guia-obs"><span class="guia-obs-icon">✎</span><span class="guia-obs-texto">${escapeHtml(g.obs)}</span></div>` : '';
      item.innerHTML = `<div class="guia-icon" style="background:linear-gradient(135deg, ${cor}, ${shade(cor, -0.2)});">${iniciaisCategoria(g.categoria)}</div>
        <div class="guia-info"><div class="guia-nome">${escapeHtml(g.nome)}${conv}</div><div class="guia-proc">${escapeHtml(g.categoria)} · ${escapeHtml(g.procedimentos)}</div>${obs}</div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;"><div class="guia-data">${dataBR(g.data)}</div>
          <button class="obs-btn ${g.obs ? 'tem-obs' : ''}" onclick="abrirModalObs(${g.id})">${g.obs ? 'Editar' : 'Anotar'}</button>
          <button class="del-btn" onclick="excluirGuia(${g.id})">Excluir</button></div>`;
      lista.appendChild(item);
    });
  }
  const stats = $('stat-row-guias');
  stats.innerHTML = `<div class="stat-card"><div class="stat-label">Total no mês</div><div class="stat-value">${guias.length}</div></div>`;
  nomesCategorias().forEach(cat => {
    stats.innerHTML += `<div class="stat-card"><div class="stat-label">${escapeHtml(cat)}</div><div class="stat-value" style="color:${escapeAttr(corCategoria(cat))};">${guias.filter(g => g.categoria === cat).length}</div></div>`;
  });
}

// Note ("Anotar") of a guide
function abrirModalObs(id) {
  const g = todasGuias().find(x => x.id === id);
  obsEditando = { id };
  $('modal-obs-paciente').textContent = g ? g.nome : '';
  $('modal-obs-texto').value = g ? (g.obs || '') : '';
  $('modal-obs').classList.add('active');
  setTimeout(() => $('modal-obs-texto').focus(), 100);
}
function fecharModalObs() { $('modal-obs').classList.remove('active'); obsEditando = { id: null }; }
async function salvarObsGuia() {
  if (!obsEditando.id) return;
  const texto = $('modal-obs-texto').value.trim();
  await comSync(async () => { await api('/api/guias/' + obsEditando.id, jsonReq('PUT', { obs: texto })); await carregarEstado(); fecharModalObs(); });
}

// "Confirm sent": marks the month as sent to the insurer
function atualizarBadgeMes() {
  const info = sentMonthInfo();
  const btn = $('btn-confirmar'), badge = $('badge-enviado'), txt = $('badge-enviado-texto');
  if (info && info.enviado) { btn.style.display = 'none'; badge.style.display = 'flex'; txt.textContent = 'Enviado em ' + info.quando; }
  else { btn.style.display = 'inline-block'; badge.style.display = 'none'; }
}
function sentMonthInfo() { return mesesEnviados[mesAtualKey()]; }
async function confirmarEnvio() {
  const mes = mesAtualKey();
  if (!confirm('Confirma envio de ' + nomeMesLegivel(mes) + '?')) return;
  await comSync(async () => { mesesEnviados = await api('/api/config/mesesEnviados', jsonReq('POST', { mes, quando: new Date().toLocaleString('pt-BR') })); atualizarBadgeMes(); });
}

// Excel export (SheetJS) and backup
function exportarExcelMes() {
  const linhas = guiasDoMesKey(mesAtualKey());
  if (!linhas.length) { alert('Nada para exportar.'); return; }
  exportarLinhasExcel(linhas, mesAtualKey());
}
function exportarLinhasExcel(linhas, sufixo) {
  const dados = linhas.map(g => ({ 'Nome': g.nome, 'Convênio': g.convenio || '', 'Categoria': g.categoria, 'Procedimentos': g.procedimentos, 'Data': dataBR(g.data), 'Anotações': g.obs || '' }));
  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 42 }, { wch: 14 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Guias');
  XLSX.writeFile(wb, `guias_${sufixo}.xlsx`);
}
async function baixarCopiaSeguranca() {
  await comSync(async () => {
    const dados = await api('/api/backup');
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `backup_${hojeISO()}.json`; a.click();
    URL.revokeObjectURL(url);
  });
}
function importarBackupAntigo(event) {
  const f = event.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = async e => {
    if (!confirm('Deseja importar os dados deste backup? Isso não apagará o que já existe.')) { event.target.value = ''; return; }
    mostrarSincronizando();
    try {
      const res = await api('/api/importar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: e.target.result });
      await carregarEstado();
      mostrarSincronizado();
      alert(`Importação concluída! ${res.guiasImportadas} guias foram importadas.`);
    } catch (err) { mostrarErroSync(err); }
    event.target.value = '';
  };
  r.readAsText(f);
}


// ============ 8. WAITING LIST ============

function alternarFormEspera() { $('espera-form').classList.toggle('open'); }
async function adicionarEspera() {
  const nome = $('e-nome').value.trim();
  if (!nome) { $('e-nome').focus(); return; }
  await comSync(async () => {
    await api('/api/espera', jsonReq('POST', { nome, tipo: $('e-tipo').value, convenio: $('e-convenio').value.trim(), obs: $('e-obs').value.trim() }));
    $('e-nome').value = ''; $('e-convenio').value = ''; $('e-obs').value = '';
    await carregarEstado();
  });
}
async function excluirEspera(id) {
  if (!confirm('Remover?')) return;
  await comSync(async () => { await api('/api/espera/' + id, { method: 'DELETE' }); await carregarEstado(); });
}
function renderEspera() {
  const lista = $('lista-espera'), vazio = $('espera-empty');
  lista.innerHTML = '';
  if (!espera.length) { vazio.style.display = 'block'; return; }
  vazio.style.display = 'none';
  espera.forEach(p => {
    const row = document.createElement('div');
    row.className = 'espera-row';
    const tag = p.tipo === 'Convênio' ? 'convenio' : 'particular';
    const info = [p.convenio, p.obs].filter(Boolean).join(' · ') || '—';
    row.innerHTML = `<span style="font-weight:700; color:var(--ink);">${escapeHtml(p.nome)}</span><span><span class="tag ${tag}">${escapeHtml(p.tipo)}</span></span><span style="font-size:12px; color:var(--ink-lighter); font-weight:600;">${dataBR(p.dataEntrada || p.data_entrada)}</span><span style="font-size:12px; color:var(--ink-soft); font-weight:500;">${escapeHtml(info)}</span><button class="del-btn" onclick="excluirEspera(${p.id})">Excluir</button>`;
    lista.appendChild(row);
  });
}


// ============ 9. MESSAGES AND PATIENTS ============

async function salvarTemplateMensagem() {
  const nome = $('msg-template-nome').value.trim(), texto = $('msg-template-texto').value.trim();
  if (!nome || !texto) { alert('Preencha nome e texto.'); return; }
  await comSync(async () => { await api('/api/templates', jsonReq('POST', { nome, texto })); $('msg-template-nome').value = ''; $('msg-template-texto').value = ''; await carregarEstado(); });
}
function renderTemplates() {
  const lista = $('lista-templates'), vazio = $('templates-empty');
  if (!lista) return;
  lista.innerHTML = '';
  if (!templatesMensagens.length) { if (vazio) vazio.style.display = 'block'; return; }
  if (vazio) vazio.style.display = 'none';
  templatesMensagens.forEach(t => {
    const div = document.createElement('div');
    div.className = 'msg-template-item';
    div.innerHTML = `<div class="msg-template-icon"><svg class="ic" viewBox="0 0 24 24"><use href="#i-chat"/></svg></div>
      <div class="msg-template-info"><div class="msg-template-nome">${escapeHtml(t.nome)}</div><div class="msg-template-texto">${escapeHtml(t.texto)}</div></div>
      <div style="display:flex; flex-direction:column; gap:6px;"><button class="obs-btn" onclick="editarTemplate(${t.id})">Editar</button><button class="del-btn" onclick="excluirTemplate(${t.id})">Excluir</button></div>`;
    lista.appendChild(div);
  });
}
function editarTemplate(id) {
  const t = templatesMensagens.find(x => x.id === id); if (!t) return;
  editandoTemplateIdx = id;
  $('edit-template-nome').value = t.nome; $('edit-template-texto').value = t.texto;
  $('modal-template').classList.add('active');
}
function fecharModalTemplate() { $('modal-template').classList.remove('active'); editandoTemplateIdx = null; }
async function confirmarEdicaoTemplate() {
  if (!editandoTemplateIdx) return;
  const nome = $('edit-template-nome').value.trim(), texto = $('edit-template-texto').value.trim();
  if (!nome || !texto) { alert('Preencha tudo.'); return; }
  await comSync(async () => { await api('/api/templates/' + editandoTemplateIdx, jsonReq('PUT', { nome, texto })); fecharModalTemplate(); await carregarEstado(); });
}
async function excluirTemplate(id) {
  if (!confirm('Excluir este modelo?')) return;
  await comSync(async () => { await api('/api/templates/' + id, { method: 'DELETE' }); await carregarEstado(); });
}

async function salvarPaciente() {
  const nome = $('pac-nome').value.trim(), telefone = $('pac-tel').value.trim();
  if (!nome || !telefone) { alert('Preencha tudo.'); return; }
  await comSync(async () => { await api('/api/pacientes', jsonReq('POST', { nome, telefone })); $('pac-nome').value = ''; $('pac-tel').value = ''; $('paciente-form').style.display = 'none'; await carregarEstado(); });
}
function renderPacientes() {
  const lista = $('lista-pacientes'), vazio = $('pacientes-empty');
  if (!lista) return;
  lista.innerHTML = '';
  if (!pacientes.length) { if (vazio) vazio.style.display = 'block'; return; }
  if (vazio) vazio.style.display = 'none';
  pacientes.forEach(p => {
    const div = document.createElement('div');
    div.className = 'paciente-item';
    div.innerHTML = `<div class="paciente-avatar">${iniciaisNome(p.nome)}</div><div class="paciente-info"><div class="paciente-nome">${escapeHtml(p.nome)}</div><div class="paciente-tel">${escapeHtml(p.telefone)}</div></div><div class="paciente-actions"><button class="obs-btn" onclick="selecionarPacienteParaMsg(${p.id})" title="Enviar">➤</button><button class="del-btn" onclick="excluirPaciente(${p.id})">Excluir</button></div>`;
    lista.appendChild(div);
  });
}
async function excluirPaciente(id) {
  if (!confirm('Excluir este paciente?')) return;
  await comSync(async () => { await api('/api/pacientes/' + id, { method: 'DELETE' }); await carregarEstado(); });
}
// Fills the two dropdowns of "Enviar mensagem"
function atualizarSelectsMensagem() {
  const sp = $('msg-paciente-select'), st = $('msg-template-select');
  if (!sp || !st) return;
  sp.innerHTML = '<option value="">— Escolha um paciente —</option>';
  pacientes.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.nome} (${p.telefone})`; sp.appendChild(o); });
  st.innerHTML = '<option value="">— Escolha um modelo —</option>';
  templatesMensagens.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.nome; st.appendChild(o); });
}
function selecionarPacienteParaMsg(id) { mudarView('mensagens'); $('msg-paciente-select').value = id; atualizarPreviewMsg(); }
// Builds the final text: the template with {nome} replaced by the patient's first name
function atualizarPreviewMsg() {
  const pac = pacientes.find(x => x.id == $('msg-paciente-select').value);
  const tpl = templatesMensagens.find(x => x.id == $('msg-template-select').value);
  let texto = tpl ? tpl.texto : '';
  if (pac && texto) texto = texto.replace(/\{nome\}/gi, pac.nome.split(' ')[0]);
  $('msg-final-texto').value = texto;
}
function aplicarTemplateMsg() { atualizarPreviewMsg(); }
function enviarWhatsApp() {
  const id = $('msg-paciente-select').value;
  if (!id) { alert('Escolha um paciente.'); return; }
  const p = pacientes.find(x => x.id == id);
  if (!p) { alert('Paciente não encontrado.'); return; }
  let n = p.telefone.replace(/\D/g, '');
  if (n.indexOf('55') !== 0) n = '55' + n;   // Brazil country code
  window.open(`https://wa.me/${n}?text=${encodeURIComponent($('msg-final-texto').value.trim())}`, '_blank');
}


// ============ 10. IMPLANTS ============

function previewImplanteFoto(event) {
  const file = event.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = e => { const img = $('impl-foto-preview'); img.src = e.target.result; img.style.display = 'block'; };
  r.readAsDataURL(file);
}

// Creates or edits an implant in the stock catalog (photo goes to the server as multipart form)
async function salvarImplanteCatalogo() {
  const nome = $('impl-nome').value.trim();
  if (!nome) return alert('Informe o nome do implante');
  const fd = new FormData();
  fd.append('nome', nome);
  fd.append('marca', $('impl-marca').value);
  fd.append('modelo', $('impl-diametro').value);     // the "size" field is stored in "modelo"
  fd.append('diametro', '');
  fd.append('comprimento', '');
  fd.append('quantidade', $('impl-quantidade').value || 0);
  fd.append('minimo', $('impl-minimo').value || 0);
  fd.append('obs', $('impl-obs').value);
  const file = $('impl-foto').files[0];
  if (file) fd.append('foto', file);

  const editando = !!implanteEditandoId;
  try {
    await enviarForm(editando ? `/api/implantes/catalogo/${implanteEditandoId}` : '/api/implantes/catalogo', editando ? 'PUT' : 'POST', fd);
    cancelarEdicaoImplante();
    await carregarEstado();
    if (editando) {
      alert('Implante atualizado!');
      const ac = $('accordion-implante'); if (ac) ac.open = false;
      mudarView('implantes');
    } else alert('Implante cadastrado! Pode cadastrar o próximo ou voltar para a aba Implantes.');
  } catch (e) { alert('Erro ao salvar implante: ' + e.message); }
}
// "+ Novo implante" button: opens Settings with the implant form expanded
function abrirCadastroImplante() {
  mudarView('config');
  const ac = $('accordion-implante'); if (!ac) return;
  ac.open = true;
  setTimeout(() => ac.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}
function cancelarEdicaoImplante() {
  implanteEditandoId = null;
  ['impl-nome', 'impl-marca', 'impl-diametro', 'impl-obs', 'impl-foto'].forEach(id => { $(id).value = ''; });
  $('impl-quantidade').value = 1; $('impl-minimo').value = 1;
  $('impl-foto-preview').style.display = 'none';
  $('btn-salvar-implante').textContent = '+ Adicionar ao Estoque';
  $('btn-cancelar-implante').style.display = 'none';
}
const FOTO_VAZIA = 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22140%22><rect fill=%22%23f0e6ec%22 width=%22200%22 height=%22140%22/><text x=%22100%22 y=%2275%22 font-size=%2214%22 text-anchor=%22middle%22 fill=%22%23a0959a%22>Sem foto</text></svg>';
function renderImplantesCatalogo() {
  const total = implantesCatalogo.reduce((s, i) => s + (i.quantidade || 0), 0);
  if ($('total-implantes-estoque')) $('total-implantes-estoque').textContent = total;
  if ($('card-implantes')) $('card-implantes').textContent = total;

  const grid = $('lista-implantes-catalogo'), vazio = $('implantes-empty');
  if (!grid) return;
  grid.innerHTML = '';
  if (!implantesCatalogo.length) { if (vazio) vazio.style.display = 'block'; return; }
  if (vazio) vazio.style.display = 'none';

  implantesCatalogo.forEach(i => {
    const st = statusEstoque(i), prev = previsaoImplante(i);
    const aviso = st === 'zerado' ? '<span class="ix-badge ix-bad" style="margin-left:8px;">sem estoque</span>' : st === 'baixo' ? '<span class="ix-badge ix-warn" style="margin-left:8px;">⚠ repor</span>' : '';
    const dura = (prev && (i.quantidade || 0) > 0) ? `<div class="ix-sub" style="margin-top:6px;">uso ~${ixFmt1(prev.porMes)}/mês · dura ~${ixFmt1(prev.meses)} ${prev.meses >= 1.95 ? 'meses' : 'mês'}</div>` : '';
    const card = document.createElement('div');
    card.className = 'implante-card';
    card.innerHTML = `<img src="${escapeAttr(i.foto) || FOTO_VAZIA}" alt="">
      <div class="implante-card-body">
        <div class="implante-card-nome">${escapeHtml(i.nome)}</div>
        <div class="implante-card-sub">${escapeHtml([i.marca, i.modelo].filter(Boolean).join(' · ') || '—')}</div>
        <div class="implante-card-qtd">
          <button class="qtd-btn" title="Ajuste manual (−1)" onclick="alterarQtd(${i.id}, -1)">−</button>
          <span>${i.quantidade} un</span>
          <button class="qtd-btn" title="Ajuste manual (+1)" onclick="alterarQtd(${i.id}, 1)">+</button>
          ${aviso}
        </div>
        ${dura}
        <div class="implante-card-actions">
          <button class="obs-btn" onclick="abrirModalCompra(${i.id})">Comprei</button>
          <button class="obs-btn" onclick="editarImplante(${i.id})">Editar</button>
          <button class="del-btn" onclick="excluirImplante(${i.id})">Excluir</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });

  // Dropdown of the "Registrar Cirurgia" form
  const sel = $('ip-implante-select');
  if (sel) {
    const valor = sel.value;
    sel.innerHTML = '<option value="">— Escolher —</option>' + implantesCatalogo.map(i => `<option value="${i.id}">${escapeHtml(i.nome)}${i.modelo ? ' · ' + escapeHtml(i.modelo) : ''} (${i.quantidade} un)</option>`).join('');
    if (valor) sel.value = valor;
  }
}
async function alterarQtd(id, delta) {
  try { await api(`/api/implantes/catalogo/${id}/quantidade`, jsonReq('POST', { delta })); await carregarEstado(); }
  catch (e) { alert(e.message); }
}
function editarImplante(id) {
  const i = implantesCatalogo.find(x => x.id === id); if (!i) return;
  implanteEditandoId = id;
  $('impl-nome').value = i.nome; $('impl-marca').value = i.marca || ''; $('impl-diametro').value = i.modelo || '';
  $('impl-quantidade').value = i.quantidade; $('impl-minimo').value = i.minimo; $('impl-obs').value = i.obs || '';
  $('btn-salvar-implante').textContent = '💾 Salvar alterações';
  $('btn-cancelar-implante').style.display = 'inline-block';
  abrirCadastroImplante();
}
async function excluirImplante(id) {
  if (!confirm('Excluir do catálogo?')) return;
  try { await api('/api/implantes/catalogo/' + id, { method: 'DELETE' }); await carregarEstado(); } catch (e) { alert(e.message); }
}

// Registers a surgery: takes one unit out of stock
async function salvarImplantePaciente() {
  const paciente = $('ip-paciente').value.trim();
  if (!paciente) return alert('Informe o paciente');
  const implanteId = $('ip-implante-select').value || '';
  if (!implanteId) return alert('Selecione qual implante foi usado');
  const impl = implantesCatalogo.find(i => i.id == implanteId);
  if (impl && (impl.quantidade || 0) <= 0 && !confirm('Esse implante está com o estoque zerado. Registrar a cirurgia mesmo assim?')) return;

  const fd = new FormData();
  fd.append('paciente', paciente);
  fd.append('implante_id', implanteId);
  fd.append('implante_nome', impl ? impl.nome : '');
  fd.append('dente', $('ip-dente').value);
  fd.append('data_cirurgia', $('ip-data').value || hojeISO());
  fd.append('observacoes', $('ip-obs').value);
  try {
    await enviarForm('/api/implantes/pacientes', 'POST', fd);
    $('ip-paciente').value = ''; $('ip-dente').value = ''; $('ip-obs').value = ''; $('ip-data').value = hojeISO();
    await carregarEstado();
    const depois = implantesCatalogo.find(i => i.id == implanteId);
    let msg = 'Cirurgia registrada e estoque atualizado!';
    if (depois && statusEstoque(depois) !== 'ok') msg += `\n\n⚠ "${depois.nome}" ficou com ${depois.quantidade} un (mínimo ${depois.minimo || 0}). Hora de repor!`;
    alert(msg);
  } catch (e) { alert('Erro: ' + e.message); }
}
function renderImplantesPacientes() {
  const lista = $('lista-implantes-pacientes'), vazio = $('implantes-pac-empty');
  if (!lista) return;
  lista.innerHTML = '';
  if (!implantesPacientes.length) { if (vazio) vazio.style.display = 'block'; return; }
  if (vazio) vazio.style.display = 'none';
  implantesPacientes.forEach(p => {
    const row = document.createElement('div');
    row.className = 'implante-pac-item';
    row.innerHTML = `<div style="flex:1;">
        <div style="font-weight:700;">${escapeHtml(p.paciente)}</div>
        <div style="font-size:12px;color:var(--ink-lighter);">${escapeHtml(p.implante_nome || 'Implante não especificado')} · Dente ${escapeHtml(p.dente || '—')} · ${dataBR(dataCirurgiaISO(p))}</div>
        ${p.observacoes ? `<div style="font-size:11.5px;color:var(--ink-soft);margin-top:2px;">${escapeHtml(p.observacoes)}</div>` : ''}
      </div><button class="del-btn" onclick="excluirImplantePaciente(${p.id})">Excluir</button>`;
    lista.appendChild(row);
  });
}
async function excluirImplantePaciente(id) {
  if (!confirm('Excluir este registro? O implante volta para o estoque.')) return;
  try { await api('/api/implantes/pacientes/' + id, { method: 'DELETE' }); await carregarEstado(); } catch (e) { alert(e.message); }
}

// ----- Stock control: status, usage forecast, purchase cycles, monthly summary -----
function ixFmt1(n) { return (Math.round(n * 10) / 10).toString().replace('.', ','); }   // 1 decimal with comma
function statusEstoque(i) { const q = i.quantidade || 0, min = i.minimo || 0; return q <= 0 ? 'zerado' : q <= min ? 'baixo' : 'ok'; }
function dataCirurgiaISO(p) { return normalizarDataISO(p.data_cirurgia) || normalizarDataISO(p.registrado_em); }
function nomeCompra(c) {
  const i = implantesCatalogo.find(x => x.id == c.implante_id);
  return i ? [i.nome, i.modelo].filter(Boolean).join(' · ') : (c.implante_nome || 'Implante removido');
}
// Average use per month over the last 3 months, and how long the current stock lasts at that pace
function previsaoImplante(i) {
  const cirs = implantesPacientes.filter(p => p.implante_id == i.id).map(dataCirurgiaISO).filter(Boolean).sort();
  if (!cirs.length) return null;
  const h = new Date(), lim = new Date(h.getFullYear(), h.getMonth(), h.getDate() - 90);
  const limISO = lim.getFullYear() + '-' + String(lim.getMonth() + 1).padStart(2, '0') + '-' + String(lim.getDate()).padStart(2, '0');
  const usados = cirs.filter(d => d >= limISO).length;
  if (!usados) return null;
  const compras = implantesCompras.filter(c => c.implante_id == i.id).map(c => normalizarDataISO(c.data)).filter(Boolean);
  const inicio = [cirs[0]].concat(compras).sort()[0];
  const dias = Math.round((new Date(hojeISO()) - new Date(inicio)) / 86400000);
  const janela = Math.min(3, Math.max(1, dias / 30));
  const porMes = usados / janela;
  return { porMes, meses: (i.quantidade || 0) / porMes };
}
// For each purchase: how many were used and how many days the batch lasted
function ciclosCompra() {
  const porImpl = {};
  implantesCompras.forEach(c => { (porImpl[c.implante_id] = porImpl[c.implante_id] || []).push(c); });
  const out = [];
  Object.keys(porImpl).forEach(id => {
    const cs = porImpl[id].slice().sort((a, b) => normalizarDataISO(a.data).localeCompare(normalizarDataISO(b.data)) || a.id - b.id);
    const cirs = implantesPacientes.filter(p => p.implante_id == id).map(dataCirurgiaISO).sort();
    cs.forEach((c, idx) => {
      const ini = normalizarDataISO(c.data), prox = cs[idx + 1] ? normalizarDataISO(cs[idx + 1].data) : null;
      const usados = cirs.filter(d => (idx > 0 ? d >= ini : true) && (!prox || d < prox)).length;
      const dias = Math.max(0, Math.round((new Date(prox || hojeISO()) - new Date(ini)) / 86400000));
      out.push({ compra: c, usados, dias, emAndamento: !prox });
    });
  });
  return out.sort((a, b) => normalizarDataISO(b.compra.data).localeCompare(normalizarDataISO(a.compra.data)) || b.compra.id - a.compra.id);
}
function historicoMensalImplantes() {
  const mapa = {};
  const pega = k => (mapa[k] = mapa[k] || { usados: 0, comprados: 0, porImplante: {} });
  implantesPacientes.forEach(p => {
    const k = dataCirurgiaISO(p).substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    const m = pega(k); m.usados++;
    const n = p.implante_nome || 'Não especificado';
    m.porImplante[n] = (m.porImplante[n] || 0) + 1;
  });
  implantesCompras.forEach(c => {
    const k = normalizarDataISO(c.data).substring(0, 7);
    if (/^\d{4}-\d{2}$/.test(k)) pega(k).comprados += Number(c.quantidade) || 0;
  });
  return Object.keys(mapa).sort().reverse().map(k => ({ key: k, ...mapa[k] }));
}
// "Needs restocking" card + the counters of the Implants screen
function renderImplantesRepor() {
  const nRepor = implantesCatalogo.filter(i => statusEstoque(i) !== 'ok').length;
  const nMes = implantesPacientes.filter(p => dataCirurgiaISO(p).substring(0, 7) === mesAtualKey()).length;
  if ($('stat-implantes-repor')) { $('stat-implantes-repor').textContent = nRepor; $('stat-implantes-repor').style.color = nRepor ? '#D98686' : ''; }
  if ($('stat-implantes-mes')) $('stat-implantes-mes').textContent = nMes;
  const el = $('implantes-repor-wrap'); if (!el) return;
  const lista = implantesCatalogo.filter(i => statusEstoque(i) !== 'ok').sort((a, b) => (a.quantidade || 0) - (b.quantidade || 0));
  let h = '<div class="card"><div class="card-title ix-title">🛒 Precisa comprar de novo</div>';
  if (!implantesCatalogo.length) h += '<div class="ix-sub">Nenhum implante cadastrado ainda.</div>';
  else if (!lista.length) h += '<div class="ix-sub">✓ Todos os implantes estão acima do estoque mínimo.</div>';
  else lista.forEach(i => {
    const st = statusEstoque(i);
    h += `<div class="ix-row">
      <div style="flex:1;min-width:180px;"><div style="font-weight:700;">${escapeHtml(i.nome)}</div><div class="ix-sub">${escapeHtml([i.marca, i.modelo].filter(Boolean).join(' · ') || '—')}</div></div>
      <div><span class="ix-badge ${st === 'zerado' ? 'ix-bad' : 'ix-warn'}">${i.quantidade || 0} un${st === 'zerado' ? ' · acabou' : ''}</span><div class="ix-sub" style="margin-top:4px;">mínimo: ${i.minimo || 0}</div></div>
      <button class="btn" style="width:auto;padding:0 18px;" onclick="abrirModalCompra(${i.id})">Comprei</button>
    </div>`;
  });
  el.innerHTML = h + '</div>';
}
// Purchase history + monthly summary cards
function renderImplantesHistorico() {
  const el = $('implantes-hist-wrap'); if (!el) return;
  const ciclos = ciclosCompra(), meses = historicoMensalImplantes();
  let h = '<div class="card"><div class="card-title ix-title">📦 Histórico de compras</div>';
  if (!ciclos.length) h += '<div class="ix-sub">Nenhuma compra registrada ainda. Use o botão "Comprei" quando chegar uma nova leva.</div>';
  ciclos.forEach(c => {
    const cp = c.compra, dur = c.emAndamento ? `leva atual · ${c.dias} dia(s)` : `durou ${c.dias} dia(s)`;
    h += `<div class="ix-row">
      <div style="flex:1;min-width:180px;"><div style="font-weight:700;">${escapeHtml(nomeCompra(cp))}</div><div class="ix-sub">${dataBR(cp.data)}${cp.obs ? ' · ' + escapeHtml(cp.obs) : ''}</div></div>
      <div style="text-align:right;"><div style="font-weight:700;">+${cp.quantidade} un</div><div class="ix-sub">${c.usados} usado(s) · ${dur}</div></div>
      <button class="del-btn" title="Excluir compra" onclick="excluirCompraImplante(${cp.id})">✕</button>
    </div>`;
  });
  h += '</div><div class="card"><div class="card-title ix-title">📅 Resumo por mês</div>';
  if (!meses.length) h += '<div class="ix-sub">Sem movimentação ainda.</div>';
  meses.forEach(m => {
    const det = Object.keys(m.porImplante).map(n => `${escapeHtml(n)}: ${m.porImplante[n]}`).join(' · ');
    h += `<div class="ix-row">
      <div style="flex:1;min-width:140px;font-weight:700;">${nomeMesLegivel(m.key)}</div>
      <div class="ix-sub" style="flex:2;min-width:200px;">${det || 'Nenhuma cirurgia'}</div>
      <div style="text-align:right;"><div style="font-weight:700;">${m.usados} usado(s)</div>${m.comprados ? `<div class="ix-sub">+${m.comprados} comprado(s)</div>` : ''}</div>
    </div>`;
  });
  el.innerHTML = h + '</div>';
}

// ----- "Comprei de novo": adds a purchase and increases the stock -----
function abrirModalCompra(id) {
  const i = implantesCatalogo.find(x => x.id == id); if (!i) return;
  compraImplanteId = i.id;
  $('compra-impl-nome').textContent = `${[i.nome, i.marca, i.modelo].filter(Boolean).join(' · ')} — estoque atual: ${i.quantidade || 0} un`;
  $('compra-impl-qtd').value = ''; $('compra-impl-data').value = hojeISO(); $('compra-impl-obs').value = '';
  $('modal-compra-impl').classList.add('active');
  setTimeout(() => $('compra-impl-qtd').focus(), 80);
}
function fecharModalCompra() { const m = $('modal-compra-impl'); if (m) m.classList.remove('active'); compraImplanteId = null; }
async function confirmarCompraImplante() {
  if (compraEnviando || !compraImplanteId) return;   // avoids double clicks
  const quantidade = parseInt($('compra-impl-qtd').value, 10);
  if (!quantidade || quantidade <= 0) { alert('Informe a quantidade comprada.'); return; }
  compraEnviando = true;
  try {
    await api(`/api/implantes/catalogo/${compraImplanteId}/compra`, jsonReq('POST', { quantidade, data: $('compra-impl-data').value || hojeISO(), obs: $('compra-impl-obs').value.trim() }));
    fecharModalCompra();
    await carregarEstado();
  } catch (e) { alert('Não consegui registrar a compra: ' + e.message); }
  finally { compraEnviando = false; }
}
async function excluirCompraImplante(id) {
  if (!confirm('Excluir esta compra? A quantidade dela será tirada do estoque.')) return;
  try { await api('/api/implantes/compras/' + id, { method: 'DELETE' }); await carregarEstado(); } catch (e) { alert(e.message); }
}


// ============ 11. PIX ============

function preencherFormPix() {
  const p = pixConfig || {};
  $('cfg-pix-tipo').value = p.tipo || 'cpf'; $('cfg-pix-chave').value = p.chave || ''; $('cfg-pix-nome').value = p.nome || '';
  $('cfg-pix-cidade').value = p.cidade || ''; $('cfg-pix-telefone-exibir').value = p.telefoneExibir || '';
}
// Shows either the saved-key summary or the form, and the "no key yet" warning
function verificarPixEstado() {
  const tem = pixConfig && pixConfig.chave && pixConfig.nome;
  const semCfg = $('pix-sem-config'); if (semCfg) semCfg.style.display = tem ? 'none' : 'block';
  const resumo = $('pix-resumo-config'), form = $('pix-form-config'), txt = $('pix-resumo-txt');
  if (!resumo || !form || !txt) return;
  if (tem) {
    resumo.style.display = 'block'; form.style.display = 'none';
    const tipos = { cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Aleatória' };
    const ch = pixConfig.chave;
    txt.textContent = `${tipos[pixConfig.tipo] || pixConfig.tipo} · ${ch.length > 6 ? ch.substring(0, 3) + '••••' + ch.substring(ch.length - 4) : '••••••'}`;   // key is partly hidden
  } else { resumo.style.display = 'none'; form.style.display = 'block'; }
}
function editarPixConfig() { $('pix-resumo-config').style.display = 'none'; $('pix-form-config').style.display = 'block'; $('btn-cancelar-pix').style.display = 'inline-block'; preencherFormPix(); }
function cancelarEdicaoPix() { verificarPixEstado(); $('btn-cancelar-pix').style.display = 'none'; }
function atualizarPlaceholderPix() {
  const ph = { cpf: 'Ex: 123.456.789-00', cnpj: 'Ex: 12.345.678/0001-90', email: 'Ex: nome@email.com', telefone: 'Ex: +5561981126796', aleatoria: 'Ex: 123e4567-...' };
  $('cfg-pix-chave').placeholder = ph[$('cfg-pix-tipo').value] || '';
}
// Cleans the key the way banks expect: digits only for CPF/CNPJ, +55... for phones, lowercase e-mail
function normalizarChavePix(tipo, chave) {
  const c = String(chave || '').trim(); if (!c) return '';
  if (tipo === 'telefone') { let d = c.replace(/\D/g, ''); if (d.indexOf('55') !== 0) d = '55' + d; return '+' + d; }
  if (tipo === 'cpf' || tipo === 'cnpj') return c.replace(/\D/g, '');
  if (tipo === 'email') return c.toLowerCase();
  return c;
}
async function salvarConfigPix() {
  const tipo = $('cfg-pix-tipo').value, bruta = $('cfg-pix-chave').value.trim(), nome = $('cfg-pix-nome').value.trim();
  const cidade = $('cfg-pix-cidade').value.trim().toUpperCase(), tel = $('cfg-pix-telefone-exibir').value.trim();
  if (!bruta || !nome) { alert('Preencha tudo.'); return; }
  pixConfig = { tipo, chave: normalizarChavePix(tipo, bruta), nome, cidade: cidade || 'BRASIL', telefoneExibir: tel };
  await comSync(async () => {
    await api('/api/config/pixConfig', jsonReq('POST', pixConfig));
    const st = $('pix-cfg-status'); st.style.display = 'block'; setTimeout(() => { st.style.display = 'none'; }, 2500);
    verificarPixEstado();
    $('btn-cancelar-pix').style.display = 'none';
  });
}
async function uploadLogoPix(event) {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 500000) { alert('A imagem é muito grande. Use uma imagem de até 500KB.'); return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    const j = await enviarForm('/api/upload', 'POST', fd);
    logoPixUrl = j.url;
    await api('/api/config/logoPix', jsonReq('POST', logoPixUrl));
    gerarPix();
  } catch (e) { alert('Erro ao fazer upload da logo: ' + e.message); }
}

// Builds the Pix "copia e cola" code (EMV standard used by Brazilian banks), ending with a CRC16 check
function montarPayloadPix(valor, descricao) {
  const cfg = pixConfig;
  if (!cfg.chave || !cfg.nome) return '';
  const num = parseFloat(String(valor).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num) || num <= 0) return '';
  const campo = (id, val) => id + String(val).length.toString().padStart(2, '0') + val;   // ID + length + value
  const conta = campo('00', 'BR.GOV.BCB.PIX') + campo('01', cfg.chave) + (descricao ? campo('02', descricao.substring(0, 40)) : '');
  const semCRC = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986') + campo('54', num.toFixed(2)) + campo('58', 'BR')
    + campo('59', cfg.nome.substring(0, 25)) + campo('60', (cfg.cidade || 'BRASIL').substring(0, 15)) + campo('62', campo('05', '***')) + '6304';
  return semCRC + calcularCRC16(semCRC);
}
function calcularCRC16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) { crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1; crc &= 0xFFFF; }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function formatarTelefoneExibir(ch) {
  if (!ch) return '—';
  let d = String(ch).replace(/\D/g, '');
  if (d.indexOf('55') === 0 && d.length >= 12) d = d.substring(2);
  if (d.length === 11) return `(${d.substring(0, 2)}) ${d.substring(2, 7)}-${d.substring(7)}`;
  if (d.length === 10) return `(${d.substring(0, 2)}) ${d.substring(2, 6)}-${d.substring(6)}`;
  return ch;
}
// HTML of the printable plaque (1000x1414 proportion). Uses your uploaded art as background when there is one.
function htmlArtePix(valorFmt, descricao, nomeExibir, telExibir) {
  const fundo = logoPixUrl
    ? `background-image: url('${String(logoPixUrl).replace(/'/g, '%27')}'); background-size: cover; background-position: center; background-repeat: no-repeat;`
    : 'background: linear-gradient(160deg, #FDF3EE 0%, #FBF1EC 40%, #FAEDE7 100%);';
  const flor = '<svg viewBox="0 0 200 200" fill="none" stroke="#C9A8A8" stroke-width="1.2" stroke-linecap="round" style="width:100%; height:100%; display:block; opacity:0.55; pointer-events:none;"><path d="M40 160 Q50 100 90 70" stroke-opacity="0.7"/><path d="M90 70 Q100 50 120 40 Q135 55 130 80 Q115 95 90 70 Z"/><path d="M90 70 Q70 55 60 40 Q75 25 95 40 Q105 55 90 70 Z"/><path d="M90 70 Q80 90 65 100 Q55 85 65 70 Q80 65 90 70 Z"/><path d="M90 70 Q110 65 130 70 Q130 85 115 90 Q95 85 90 70 Z"/><path d="M40 160 Q20 130 25 100 Q45 110 50 130"/><path d="M40 160 Q60 175 80 170" stroke-opacity="0.6"/><path d="M50 130 Q35 120 25 100" stroke-opacity="0.5"/><circle cx="95" cy="70" r="5" fill="#C9A8A8" fill-opacity="0.5"/></svg>';
  // Flower corners only when there is no custom art
  const cantos = logoPixUrl ? '' : [['top:-6%; left:-6%;', ''], ['top:-6%; right:-6%;', 'transform:scaleX(-1);'], ['bottom:-6%; left:-6%;', 'transform:scaleY(-1);'], ['bottom:-6%; right:-6%;', 'transform:scale(-1,-1);']]
    .map(([pos, tr]) => `<div style="position:absolute; ${pos} width:40%; height:40%; ${tr}">${flor}</div>`).join('');
  const topo = logoPixUrl ? '<div style="height: 120px;"></div>' : `
    <div style="font-size: 84px; font-weight: 800; color: #7A1F3D; letter-spacing: -8px; line-height: 0.9; margin-bottom: 18px; display: inline-block; font-family: Georgia, serif; font-style: italic;">K<span style="display: inline-block; transform: scaleX(-1); margin-left: -10px;">M</span></div>
    <div style="font-size: 15px; letter-spacing: 7px; font-weight: 500; color: #4A2E2E; margin-bottom: 6px; text-transform: uppercase;">Kelly Machado</div>
    <div style="font-size: 8.5px; letter-spacing: 3.5px; color: #8A6A6A; font-weight: 500; text-transform: uppercase; margin-bottom: 12px;">Periodontia e Implantodontia</div>
    <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 5px;"><span style="width: 60px; height: 1px; background: linear-gradient(90deg, transparent, #7A1F3D, transparent);"></span><span style="width: 6px; height: 6px; background: #7A1F3D; transform: rotate(45deg);"></span><span style="width: 60px; height: 1px; background: linear-gradient(90deg, transparent, #7A1F3D, transparent);"></span></div>`;
  const nome = descricao ? `<div style="position: absolute; top: 72%; left: 50%; transform: translateX(-50%); z-index: 4; width: 80%; text-align: center; font-size: 13px; font-weight: 600; color: #4A2E2E; letter-spacing: 1.5px; text-transform: uppercase; word-wrap: break-word;">${escapeHtml(nomeExibir)}</div>` : '';
  return `<div class="pix-arte" style="position:relative; overflow:hidden; border-radius:20px; box-shadow:0 30px 60px -25px rgba(122,31,61,0.35); ${fundo}">
    ${cantos}
    <div style="position: absolute; top: 6%; left: 50%; transform: translateX(-50%); width: 80%; text-align: center; z-index: 3;">${topo}</div>
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 48%; z-index: 3; display: flex; align-items: center; justify-content: center;">
      <div style="width: 100%; aspect-ratio: 1 / 1; background: #FFFFFF; border-radius: 32px; padding: 20px; box-shadow: 0 15px 35px -15px rgba(122,31,61,0.25); display: flex; align-items: center; justify-content: center;"><div id="modal-qrcode" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;"></div></div>
    </div>
    ${nome}
    <div style="position: absolute; top: 85%; left: 50%; transform: translate(-50%, -50%); z-index: 4; width: 62%; background: #FFFFFF; border-radius: 60px; padding: 16px 24px; text-align: center; box-shadow: 0 10px 25px -12px rgba(122,31,61,0.2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;">
      <div style="font-size: 22px; font-weight: 700; color: #7A1F3D; letter-spacing: -0.02em; line-height: 1.1;"><span style="display: block; font-size: 8px; font-weight: 600; letter-spacing: 2.5px; color: #8A6A6A; text-transform: uppercase; margin-bottom: 2px;">Valor</span>R$ ${valorFmt}</div>
      <div style="display: inline-flex; align-items: center; gap: 8px; white-space: nowrap;">
        <div style="width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; color: #7A1F3D;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>
        <div style="font-size: 14px; font-weight: 600; color: #4A2E2E; letter-spacing: 0.5px; text-decoration: underline; text-decoration-color: rgba(122,31,61,0.4); text-underline-offset: 3px;">${escapeHtml(telExibir)}</div>
      </div>
    </div>
    <div style="position: absolute; bottom: 4%; left: 50%; transform: translateX(-50%); z-index: 3; text-align: center; font-family: Georgia, serif; font-style: italic; font-size: 26px; font-weight: 400; color: #7A1F3D; letter-spacing: 0.5px;">Chave Celular</div>
  </div>`;
}
// "Gerar QR Code": validates, builds the code, opens the plaque modal and draws the QR
function gerarPix() {
  if (!pixConfig.chave || !pixConfig.nome) { alert('Cadastre sua chave Pix primeiro em Configurações.'); mudarView('config'); return; }
  const valor = $('pix-valor').value.trim();
  if (!valor) { alert('Informe o valor.'); return; }
  const descricao = $('pix-descricao').value.trim();
  const payload = montarPayloadPix(valor, descricao);
  if (!payload) { alert('Valor inválido. Use 150,00'); return; }
  const num = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  const valorFmt = isNaN(num) ? '0,00' : num.toFixed(2).replace('.', ',');
  const telExibir = pixConfig.telefoneExibir || formatarTelefoneExibir(pixConfig.chave);
  const nomeExibir = (descricao || pixConfig.nome || '').toUpperCase();

  $('pix-modal-arte-wrap').innerHTML = htmlArtePix(valorFmt, descricao, nomeExibir, telExibir);
  $('pix-modal-overlay').classList.add('active');
  setTimeout(() => {   // the QR needs the element to exist in the page first
    const qm = $('modal-qrcode');
    if (qm) { qm.innerHTML = ''; new QRCode(qm, { text: payload, width: 240, height: 240, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
  }, 50);
  $('pix-codigo').value = payload;
  $('pix-codigo-card').style.display = 'block';
}
function fecharModalPix() { $('pix-modal-overlay').classList.remove('active'); }
function copiarCodigoPix() {
  const t = $('pix-codigo');
  navigator.clipboard.writeText(t.value).then(() => alert('Copiado!')).catch(() => { t.select(); document.execCommand('copy'); alert('Copiado!'); });
}


// ============ 12. DASHBOARD AND CHART ============

function atualizarDashboard() {
  const mes = guiasDoMesKey(mesAtualKey()), hoje = hojeISO();
  $('card-hoje').textContent = mes.filter(g => normalizarDataISO(g.data) === hoje).length;
  $('card-espera').textContent = espera.length;
  $('card-implantes').textContent = implantesCatalogo.reduce((s, i) => s + (i.quantidade || 0), 0);

  const cats = nomesCategorias();
  const st = $('overview-stats');
  st.innerHTML = `<div class="overview-stat"><div class="num">${mes.length}</div><div class="lbl">Total no mês</div></div>`;
  cats.forEach(cat => { st.innerHTML += `<div class="overview-stat"><div class="num">${mes.filter(g => g.categoria === cat).length}</div><div class="lbl">${escapeHtml(cat)}</div></div>`; });

  const res = $('resumo-categorias'); res.innerHTML = '';
  if (!cats.length) res.innerHTML = '<div class="empty" style="padding:14px 0;">Crie categorias em Configurações.</div>';
  else cats.forEach(cat => { res.innerHTML += `<div class="resumo-cat-item"><div class="resumo-cat-nome"><span class="categoria-dot" style="background:${escapeAttr(corCategoria(cat))};"></span>${escapeHtml(cat)}</div><div class="resumo-cat-num">${mes.filter(g => g.categoria === cat).length}</div></div>`; });

  // Latest 4 guides of the month
  const at = $('lista-atividade'); at.innerHTML = '';
  if (!mes.length) at.innerHTML = '<div class="empty" style="padding:14px 0;">Nenhuma guia ainda.</div>';
  else mes.slice().sort((a, b) => normalizarDataISO(a.data).localeCompare(normalizarDataISO(b.data))).slice(-4).reverse().forEach(g => {
    const cor = corCategoria(g.categoria);
    const div = document.createElement('div'); div.className = 'list-item';
    div.innerHTML = `<div class="mini-avatar" style="background:linear-gradient(135deg, ${cor}, ${shade(cor, -0.2)})">${iniciaisNome(g.nome)}</div><div class="list-info"><div class="list-name">${escapeHtml(g.nome)}</div><div class="list-sub">${escapeHtml(g.categoria)}</div></div><div class="list-time">${dataBR(g.data).split('/').slice(0, 2).join('/')}</div>`;
    at.appendChild(div);
  });

  // First 4 people in the waiting list
  const fp = $('lista-fila-preview'); fp.innerHTML = '';
  if (!espera.length) fp.innerHTML = '<div class="empty" style="padding:14px 0;">Sem ninguém na fila.</div>';
  else espera.slice(0, 4).forEach(p => {
    const conv = p.tipo === 'Convênio';
    const div = document.createElement('div'); div.className = 'list-item';
    div.innerHTML = `<div class="mini-avatar" style="background:${conv ? 'linear-gradient(135deg,#7FA890,#5D8A72)' : 'linear-gradient(135deg,#E8B87C,#B88448)'}">${iniciaisNome(p.nome)}</div><div class="list-info"><div class="list-name">${escapeHtml(p.nome)}</div><div class="list-sub">${escapeHtml(p.convenio || p.tipo)}</div></div><span class="tag ${conv ? 'convenio' : 'particular'}">${escapeHtml(p.tipo)}</span>`;
    fp.appendChild(div);
  });
  atualizarGrafico();
}
// Line chart of guides per month, one line per category (Chart.js)
function atualizarGrafico() {
  const canvas = $('chart-overview'); if (!canvas || typeof Chart === 'undefined') return;
  const qtd = $('periodo-select') ? parseInt($('periodo-select').value, 10) : 6;
  let base = calcularHistoricoLocal();
  if (!base.length) base = historico || [];
  const dp = base.slice(-qtd);
  const labels = dp.map(h => String(h.label || '').split(' de ')[0].slice(0, 3));
  const cats = nomesCategorias();
  if (overviewChart) overviewChart.destroy();
  if (!cats.length) return;

  const escuro = document.documentElement.classList.contains('dark');
  const tc = escuro ? 'rgba(240,230,236,0.7)' : 'rgba(58,46,54,0.55)';
  const gc = escuro ? 'rgba(240,217,228,0.06)' : 'rgba(74,63,75,0.06)';
  const lc = escuro ? 'rgba(240,230,236,0.9)' : 'rgba(58,46,54,0.8)';
  const paleta = ['#B08894', '#8E6A78', '#7FA890', '#E8B87C', '#9A8FB8', '#B8846B'];
  const datasets = cats.map((cat, i) => {
    const cor = paleta[i % paleta.length];
    return { label: cat, data: dp.map(h => (h.contagem && h.contagem[cat]) || 0), borderColor: cor, backgroundColor: cor + '18', fill: i === 0, tension: 0.4, pointRadius: 3, pointBackgroundColor: cor, borderWidth: 2.5 };
  });
  const eixo = { ticks: { color: tc, font: { family: 'Inter', size: 10, weight: '600' } }, grid: { color: gc, drawBorder: false } };
  overviewChart = new Chart(canvas.getContext('2d'), {
    type: 'line', data: { labels, datasets },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: lc, font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' } } }, scales: { x: eixo, y: eixo } }
  });
}


// ============ 13. ARCHIVE (past months) ============

function abrirArquivo() {
  const sel = $('select-mes-arquivo'), anterior = sel.value;
  sel.innerHTML = '';
  const meses = listaMesesLocal(), atual = mesAtualKey();
  meses.forEach(m => { const o = document.createElement('option'); o.value = m.key; o.textContent = m.mesLegivel + (m.key === atual ? ' (mês atual)' : ''); sel.appendChild(o); });
  const vals = meses.map(m => m.key);
  sel.value = (anterior && vals.indexOf(anterior) > -1) ? anterior : (vals[0] || '');
  renderArquivo();
}
async function renderArquivo() {
  const key = $('select-mes-arquivo').value; if (!key) return;
  let res = { sheetName: 'Guias_' + key, mesLegivel: nomeMesLegivel(key), linhas: guiasDoMesKey(key) };
  // If nothing is loaded locally for an old month, ask the server
  if (!res.linhas.length && key !== mesAtualKey()) {
    try {
      const r = await api('/api/guias/mes/Guias_' + key);
      if (r && r.linhas && r.linhas.length) res = { sheetName: 'Guias_' + key, mesLegivel: r.mesLegivel || res.mesLegivel, linhas: r.linhas };
    } catch (e) { console.warn('Could not load month', key, e); }
  }
  res.linhas = res.linhas.slice().sort((a, b) => normalizarDataISO(b.data).localeCompare(normalizarDataISO(a.data)));   // newest first
  exibirArquivo(res);
}
function exibirArquivo(res) {
  const lista = $('lista-arquivo'), vazio = $('arquivo-empty');
  lista.innerHTML = '';
  $('arquivo-mes-nome').textContent = res.mesLegivel || 'Mês desconhecido';
  const info = mesesEnviados[res.sheetName ? res.sheetName.replace('Guias_', '') : ''];
  $('arquivo-badge-area').innerHTML = (info && info.enviado)
    ? `<div class="autosave-pill on">✓ Enviado em ${escapeHtml(info.quando)}</div>`
    : '<div class="autosave-pill" style="background:rgba(232,184,124,0.15); color:#8A6A2E;">Ainda não enviado</div>';
  arquivoAtual = res;
  if (!res.linhas || !res.linhas.length) { vazio.style.display = 'block'; return; }
  vazio.style.display = 'none';
  res.linhas.forEach(g => {
    const cor = corCategoria(g.categoria);
    const item = document.createElement('div'); item.className = 'guia-item';
    item.innerHTML = `<div class="guia-icon" style="background:linear-gradient(135deg, ${cor}, ${shade(cor, -0.2)});">${iniciaisCategoria(g.categoria)}</div><div class="guia-info"><div class="guia-nome">${escapeHtml(g.nome)}</div><div class="guia-proc">${escapeHtml(g.categoria)} · ${escapeHtml(g.procedimentos)}</div></div><div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;"><div class="guia-data">${dataBR(g.data)}</div></div>`;
    lista.appendChild(item);
  });
}
function exportarExcelArquivo() {
  if (!arquivoAtual || !arquivoAtual.linhas || !arquivoAtual.linhas.length) { alert('Nada para exportar.'); return; }
  exportarLinhasExcel(arquivoAtual.linhas, arquivoAtual.sheetName ? arquivoAtual.sheetName.replace('Guias_', '') : 'arquivo');
}


// ============ 14. PRINT SCREEN (PASBC sheet form) ============
// The sheet itself is drawn by guia.js (montarFolha) and printed by imprimirGuia().

function abrirImprimir() {
  const sel = $('imprimir-select-guia');
  sel.innerHTML = '<option value="">— Preencher manualmente —</option>';
  (guiasMesAtual.linhas || []).forEach((g, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${g.nome} — ${g.categoria} (${dataBR(g.data)})`; sel.appendChild(o); });
  if (!$('imp-data').value) $('imp-data').value = hojeISO();
  $('imp-dentista').value = dadosConsultorio.dentista || '';
  $('imp-cpf').value = dadosConsultorio.cpf || '';
  $('imp-cro').value = dadosConsultorio.cro || '';
  $('imp-tel-dentista').value = dadosConsultorio.telefone || '';
  popularSelectProcedimentos();
  if (!linhasImpressao.length) adicionarLinhaImpressao();
  renderLinhasImpressao();
  atualizarFolha();
}
// Dropdown "+ Adicionar procedimento": adds a ready-made row (code, region and value come from Settings)
function popularSelectProcedimentos() {
  const sel = $('select-procedimento-pronto'); if (!sel) return;
  sel.innerHTML = '<option value="">+ Adicionar procedimento...</option>';
  Object.keys(PROCEDIMENTOS).forEach(cat => {
    const itens = PROCEDIMENTOS[cat].itens || [];
    if (!itens.length) return;
    const grp = document.createElement('optgroup'); grp.label = cat;
    itens.forEach(item => { const o = document.createElement('option'); o.value = item.nome; o.textContent = item.nome + (item.valor ? ' — R$ ' + item.valor : ''); grp.appendChild(o); });
    sel.appendChild(grp);
  });
  sel.onchange = function () {
    if (!this.value) return;
    const p = buscarDadosProcedimento(this.value);
    linhasImpressao.push({ qte: 1, procedimento: p.nome, codigo: p.codigo || '', dente: p.regiao || '', valor: p.valor || '' });
    renderLinhasImpressao();
    this.value = '';
  };
}
function buscarDadosProcedimento(nome) {
  for (const cat of Object.keys(PROCEDIMENTOS)) {
    const item = (PROCEDIMENTOS[cat].itens || []).find(i => i.nome === nome);
    if (item) return item;
  }
  return { nome, codigo: '', valor: '', regiao: '' };
}
// "Choose an existing guide": copies name, date and procedures into the form
function preencherDaGuia() {
  const idx = $('imprimir-select-guia').value; if (idx === '') return;
  const g = guiasMesAtual.linhas[idx]; if (!g) return;
  $('imp-beneficiario').value = g.nome;
  const iso = normalizarDataISO(g.data);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) $('imp-data').value = iso;
  linhasImpressao = String(g.procedimentos || '').split(',').map(p => p.trim()).filter(Boolean).map(np => {
    const d = buscarDadosProcedimento(np);
    return { qte: 1, procedimento: np, codigo: d.codigo || '', dente: d.regiao || '', valor: d.valor || '' };
  });
  if (!linhasImpressao.length) linhasImpressao = [{ qte: 1, procedimento: '', codigo: '', dente: '', valor: '' }];
  renderLinhasImpressao();
  atualizarFolha();
}
function adicionarLinhaImpressao() { linhasImpressao.push({ qte: 1, procedimento: '', codigo: '', dente: '', valor: '' }); renderLinhasImpressao(); }
function removerLinhaImpressao(i) { linhasImpressao.splice(i, 1); renderLinhasImpressao(); }
function atualizarLinhaImpressao(i, campo, valor) {
  linhasImpressao[i][campo] = valor;
  if (campo === 'valor') calcularTotalImpressao();
  atualizarFolha();
}
function renderLinhasImpressao() {
  const corpo = $('corpo-imprimir-edit');
  corpo.innerHTML = '';
  const celula = (i, campo, valor) => `<td style="padding:6px 4px;"><input type="text" style="margin:0; padding:8px 10px; font-size:12.5px; border-radius:8px;" value="${escapeAttr(String(valor))}" oninput="atualizarLinhaImpressao(${i},'${campo}',this.value)"></td>`;
  linhasImpressao.forEach((l, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = celula(i, 'qte', l.qte) + celula(i, 'procedimento', l.procedimento) + celula(i, 'codigo', l.codigo) + celula(i, 'dente', l.dente) + celula(i, 'valor', l.valor)
      + `<td style="padding:6px 4px; text-align:center;"><button class="del-btn" onclick="removerLinhaImpressao(${i})">✕</button></td>`;
    corpo.appendChild(tr);
  });
  calcularTotalImpressao();
}
function calcularTotalImpressao() {
  const total = linhasImpressao.reduce((s, l) => s + (parseFloat(String(l.valor).replace(',', '.')) || 0), 0);
  $('imp-total').textContent = total.toFixed(2).replace('.', ',');
  atualizarFolha();
}
// Saves the dentist data (used on every printed sheet)
async function salvarDadosConsultorioPadrao() {
  const d = { dentista: $('imp-dentista').value.trim(), cpf: $('imp-cpf').value.trim(), cro: $('imp-cro').value.trim(), telefone: $('imp-tel-dentista').value.trim() };
  await comSync(async () => { await api('/api/config/dadosConsultorio', jsonReq('POST', d)); dadosConsultorio = d; });
}


// ============ 15. STARTUP ============
document.addEventListener('DOMContentLoaded', () => {
  $('g-data').value = hojeISO();
  if ($('ip-data')) $('ip-data').value = hojeISO();
  carregarEstado();
});
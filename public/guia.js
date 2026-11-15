// guia.js — monta a folha PASBC (preview e impressão).
// Carregar DEPOIS do app.js: ele substitui montarFolha() e imprimirGuia() antigas.

const GUIA_LOGO = "data:image/png;base64,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";

function gComb(v, n, w, seps) {
  const c = String(v || '').replace(/\s/g, '').split('').slice(0, n);
  while (c.length < n) c.push('');
  const largura = w === 'full' ? 'width:100%' : `width:${n * w}mm`;
  return `<div class="g-comb" style="${largura}">` + c.map((x, i) => `<i${(seps || []).includes(i) ? ' class="sep"' : ''}>${escapeHtml(x)}</i>`).join('') + '</div>';
}
function gCampo(rotulo, valor) { return `<span class="g-lbl">${rotulo}</span><div class="g-val">${escapeHtml(valor || '')}</div>`; }
function gGrupo(nums, lado) {
  const n = `<div class="g-nums">${nums.map(x => `<span>${x}</span>`).join('')}</div>`;
  const f = `<div class="g-teeth">${nums.map(() => '<svg class="g-tooth"><use href="#g-t"/></svg>').join('')}</div>`;
  return `<div class="g-grp">${n}${f}${f}${n}<span class="g-side ${lado === 'D' ? 'l' : 'r'}">${lado}</span></div>`;
}

function montarFolha() {
  const el = $('folha-impressao'); if (!el) return;
  const v = id => ($(id) ? $(id).value : '');
  const dmy = iso => iso ? iso.split('-').reverse().join('') : '';
  const prov = [5, 4, 3, 2, 1], perm = [8, 7, 6, 5, 4, 3, 2, 1];
  const rev = a => a.slice().reverse();

  const linhas = linhasImpressao.map(l => `<div class="g-tr"><span>${escapeHtml(String(l.qte || ''))}</span><span>${escapeHtml(l.procedimento || '')}</span><span>${escapeHtml(l.codigo || '')}</span><span>${escapeHtml(l.dente || '')}</span><span class="r">${l.valor ? 'R$ ' + escapeHtml(String(l.valor)) : ''}</span></div>`);
  while (linhas.length < 20) linhas.push('<div class="g-tr"><span></span><span></span><span></span><span></span><span></span></div>');

  const total = linhasImpressao.some(l => l.valor) ? 'R$ ' + $('imp-total').textContent : '';
  const dentista = v('imp-dentista') + (v('imp-cpf') ? ' — ' + v('imp-cpf') : '');
  const uni = v('imp-unica');

  el.innerHTML = `<div class="gp">
  <svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="g-t" viewBox="0 0 20 20"><rect x=".5" y=".5" width="19" height="19" fill="#fff" stroke="#555"/><rect x="5.5" y="5.5" width="9" height="9" fill="none" stroke="#555"/><path d="M.5 .5L5.5 5.5M19.5 .5L14.5 5.5M.5 19.5L5.5 14.5M19.5 19.5L14.5 14.5" stroke="#555"/></symbol></svg>

  <div class="g-top">
    <div class="g-logo"><img src="${GUIA_LOGO}" alt=""><b>BANCO CENTRAL DO BRASIL</b></div>
    <div class="g-local">${gCampo('Local', v('imp-local'))}</div>
    <div class="g-data"><span class="g-lbl">Data</span>${gComb(dmy(v('imp-data')), 8, 'full', [2, 4])}</div>
  </div>
  <div class="g-title">PASBC – Guia/Orçamento Odontológico</div>

  <div class="g-row thick">
    <div class="g-cell nb grow b">${gCampo('Beneficiário', v('imp-beneficiario'))}</div>
    <div class="g-cell nb" style="width:50mm"><span class="g-lbl">Data de nascimento</span>${gComb(dmy(v('imp-nascimento')), 8, 'full', [2, 4])}</div>
  </div>
  <div class="g-row">
    <div class="g-cell nb"><span class="g-lbl">Matrícula PASBC</span>${gComb(v('imp-matricula'), 8, 6.4)}</div>
    <div class="g-cell nb"><span class="g-lbl">Nº de ordem</span>${gComb(v('imp-ordem'), 2, 6.4)}</div>
    <div class="g-cell grow b">${gCampo('Endereço', v('imp-endereco'))}</div>
  </div>
  <div class="g-row line">
    <div class="g-cell nb grow" style="min-height:9mm">${gCampo('Titular', v('imp-titular'))}</div>
    <div class="g-cell" style="width:92mm;min-height:9mm">${gCampo('Telefone do benef ciário', v('imp-telefone-benef'))}</div>
  </div>
  <div class="g-row line gap">
    <div class="g-cell nb grow">${gCampo('Dentista e CPF/CGC', dentista)}</div>
    <div class="g-cell" style="width:30mm">${gCampo('CRO', v('imp-cro'))}</div>
    <div class="g-cell" style="width:36mm">${gCampo('Telefone', v('imp-tel-dentista'))}</div>
    <div class="g-cell" style="width:56mm">${gCampo('Tratamento (prev. dias)', v('imp-prev-dias'))}</div>
  </div>

  <div class="g-odonto">
    <h4>Dentição provisória</h4>
    <div class="g-arc g-prov">${gGrupo(prov, 'D')}${gGrupo(rev(prov), 'E')}</div>
    <h4 class="p2">Dentição permanente</h4>
    <div class="g-arc g-perm">${gGrupo(perm, 'D')}${gGrupo(rev(perm), 'E')}</div>
  </div>

  <div class="g-tb">
    <div class="g-tr h"><span>Qte.</span><span>Procedimentos</span><span>Código</span><span>Dente/Região</span><span>R$</span></div>
    ${linhas.join('')}
  </div>
  <div class="g-total">
    <svg width="30" height="27" viewBox="0 0 52 46" aria-hidden="true"><path d="M2 2l48 21L2 44z" fill="#d9d9d9" stroke="#333" stroke-width="1.5"/></svg>
    <div class="t"><span class="g-lbl">Total</span><div class="g-val">${escapeHtml(total)}</div></div>
  </div>

  <div class="g-foot">
    <div class="l">
      <p>Tratamento realizado em uma única</p>
      <div class="g-chk"><span>Sim</span><i>${uni === 'Sim' ? '✕' : ''}</i></div>
      <div class="g-chk"><span>Não</span><i>${uni === 'Não' ? '✕' : ''}</i></div>
      <div class="g-sig">Assinatura do beneficiário</div>
    </div>
    <div class="r">Assinatura do prestador</div>
  </div>
  <div class="g-legal"><span>2ª via – Prestador de serviços</span><small>018056-4</small></div>
</div>`;
}

// Imprime só a folha, num iframe invisível (não depende das regras de impressão do resto do sistema)
function imprimirGuia() {
  montarFolha();
  const html = $('folha-impressao').innerHTML;
  const css = new URL('guia.css', document.baseURI).href;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Guia PASBC</title>
    <link rel="stylesheet" href="${css}">
    <style>@page{size:A4;margin:0} html,body{margin:0;background:#fff} .gp{min-height:0} *{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>
    </head><body>${html}</body></html>`);
  d.close();
  const imprimir = () => {
    const p = d.querySelector('.gp');
    const max = 1118; // altura útil de uma A4 em px; se passar, encolhe para caber em 1 página
    if (p && p.scrollHeight > max) p.style.zoom = max / p.scrollHeight;
    f.contentWindow.onafterprint = () => f.remove();
    f.contentWindow.focus();
    f.contentWindow.print();
  };
  d.querySelector('link').onload = () => setTimeout(imprimir, 150);
}

// ===== Dados do dentista agora ficam em Configurações =====
// Preenche os campos do accordion sempre que abrir Configurações
const _mudarViewOriginal = mudarView;
mudarView = function (nome) {
  _mudarViewOriginal(nome);
  if (nome === 'config') {
    $('imp-dentista').value = dadosConsultorio.dentista || '';
    $('imp-cpf').value = dadosConsultorio.cpf || '';
    $('imp-cro').value = dadosConsultorio.cro || '';
    $('imp-tel-dentista').value = dadosConsultorio.telefone || '';
  }
};

// A folha atualiza enquanto você digita nos campos da aba Imprimir guia
document.addEventListener('input', e => {
  if (e.target.id && e.target.id.indexOf('imp-') === 0) montarFolha();
});
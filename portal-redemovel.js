const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzD855AIX6BOudkvhvF3vI11dcmcaf2j5fWWKrTUUWGbHERSY-oqu8w4qCyuo-sYk_uKw/exec';

// 2026-09-12: simplificado — uma declaração `var` no topo do ficheiro já é,
// por si só, uma propriedade de `window` (não é um módulo), por isso não há
// necessidade de duplicar com `window.X = null` à parte.
// 2026-09-12 (2ª ronda): a verificação do visibilitychange usava
// `window.SESSION` enquanto o resto do ficheiro usa sempre `SESSION`
// directamente — hoje são a mesma coisa, mas é frágil (se este ficheiro
// alguma vez passar a `<script type="module">`, deixam de o ser, e o guard
// falha em silêncio). Unificado: usar sempre `SESSION`, nunca `window.SESSION`.
var SESSION = null;
var modalResetTarget = null;

// ═══════════════════════════════════════
//  INICIALIZAÇÃO
// ═══════════════════════════════════════
async function init() {
  setMsg('A verificar localização...');
  try {
    let ipPublico = 'desconhecido';
    try {
      // 2026-09-12: timeout — sem isto, um api.ipify.org lento/em baixo
      // (serviço externo, fora do nosso controlo) podia deixar o ecrã de
      // login preso indefinidamente à espera, antes mesmo de chegarmos à
      // Apps Script. 4s chega de sobra para um pedido tão pequeno; falhando,
      // seguimos com 'desconhecido' como já acontecia antes.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const ipRes = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
      clearTimeout(t);
      if (ipRes.ok) {
        const ipData = await ipRes.json();
        ipPublico = ipData.ip;
      }
    } catch(_) {}
    const res = await api({ acao: 'verificarIP', ip: ipPublico });
    if (res.ok) {
      // Tentar restaurar sessão anterior (sobrevive a F5)
      try {
        const saved = sessionStorage.getItem('rmSession');
        if (saved) {
          const s = JSON.parse(saved);
          if (s && s.username && s.password) {
            SESSION = { ...s, ip: res.ip || 'auto', local: res.local };
            // Revalidar credenciais silenciosamente
            const rv = await api({ acao:'autenticar', ip:SESSION.ip, username:SESSION.username, password:SESSION.password });
            if (rv.ok) {
              SESSION = { ...SESSION, nome:rv.nome, role:rv.role };
              hideLoading();
              await enterDashboard();
              return;
            }
          }
        }
      } catch(_) {}
      SESSION = { ip: res.ip || 'auto', local: res.local };
      hideLoading();
      showLogin();
    } else {
      hideLoading();
      showBlocked(res.ip || '—');
    }
  } catch (err) {
    hideLoading();
    showBlocked('Erro de ligação');
  }
}

function setMsg(msg) { document.getElementById('loading-msg').textContent = msg; }
function hideLoading() { const el=document.getElementById('loading-screen'); el.style.opacity='0'; setTimeout(()=>el.style.display='none',500); }
function showLogin() { document.getElementById('login-page').style.display='flex'; }
function showBlocked(ip) { document.getElementById('blocked-screen').style.display='flex'; document.getElementById('blocked-ip-display').textContent='IP: '+ip; }

// 2026-09-12 (2ª ronda de auditoria): helper único para persistir SESSION —
// doLogin já gravava depois de autenticar, mas alterarPassword() só
// actualizava SESSION.password em memória, sem gravar. Resultado: mudar a
// password e dar F5 fazia o init() restaurar a password ANTIGA do
// sessionStorage, a revalidação falhava e o colaborador caía de volta no
// ecrã de login sem perceber porquê. Qualquer mutação de SESSION que deva
// sobreviver a F5 passa a chamar isto.
function guardarSessao() {
  try { sessionStorage.setItem('rmSession', JSON.stringify(SESSION)); } catch(_) {}
}

// ═══════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════
async function doLogin() {
  const username = document.getElementById('inp-user').value.trim().toLowerCase();
  const password = document.getElementById('inp-pass').value;
  const btn = document.getElementById('btn-login');
  const err = document.getElementById('login-error');
  if (!username || !password) { showAlert(err,'Preencha todos os campos.'); return; }
  btn.disabled=true; btn.textContent='A autenticar...'; err.style.display='none';
  try {
    const res = await api({ acao:'autenticar', ip:SESSION.ip, username, password });
    if (res.ok) { SESSION={...SESSION, username:res.username, nome:res.nome, role:res.role, password}; guardarSessao(); enterDashboard(); }
    else showAlert(err, res.erro||'Erro de autenticação.');
  } catch(e) { showAlert(err,'Erro de ligação. Tente novamente.'); }
  btn.disabled=false; btn.textContent='Entrar no Portal';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('inp-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('inp-user').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('inp-pass').focus(); });
  init();

  // Auto-refresh quando o utilizador volta ao separador — só o essencial:
  // o contador de aprovações pendentes (para master/coordenador). Já não
  // volta a carregar dados inteiros da Assiduidade/Gestão a cada troca de
  // separador — isso era um consumo desnecessário para o que era pedido.
  let ultimoRefresh = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !SESSION) return;
    if (Date.now() - ultimoRefresh < 10000) return;
    ultimoRefresh = Date.now();
    if (SESSION.role==='master'||SESSION.role==='coordenador_lojas') carregarAprovacoesBadge();
  });
});


// ═══════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════
async function enterDashboard() {
  document.getElementById('login-page').style.display='none';
  document.getElementById('dashboard-page').style.display='flex';
  const initials = SESSION.nome.split(' ').map(w=>w[0]).slice(0,2).join('');
  document.getElementById('user-avatar').textContent=initials;
  document.getElementById('user-display').textContent=SESSION.nome;
  document.getElementById('user-role-display').textContent=roleLabel(SESSION.role);
  document.getElementById('perfil-avatar').textContent=initials;
  document.getElementById('perfil-nome').textContent=SESSION.nome;
  document.getElementById('perfil-role').textContent=roleLabel(SESSION.role);
  document.getElementById('perfil-local').textContent='📍 '+(SESSION.local||'—');
  buildChart(); setPageDate();

  if (SESSION.role==='master'||SESSION.role==='coordenador_lojas') {
    document.getElementById('nav-gestao').style.display='';
  }

  // Regras e RGPD (2026-09-10): confirmação de leitura obrigatória antes de
  // aceder ao resto do portal. Se ainda não confirmou a versão actual do
  // texto, verificarRegrasGate() já mostra a vista "Regras" e bloqueia a
  // navegação (ver .topbar-nav.regras-gate no CSS) — só avançamos para
  // mostrarVistaInicial() depois de confirmado (aqui, ou a partir de
  // confirmarLeituraRegras() quando o próprio colaborador confirma).
  //
  // 2026-09-12: sincronizarHoraServidor() e verificarRegrasGate() não
  // dependem uma da outra — eram 2 idas-e-voltas sequenciais ao exec da
  // Apps Script, agora em paralelo (Promise.all), o que corta a espera
  // desta parte do arranque a cerca de metade. startClock() só é chamado
  // depois de ambas resolverem, porque precisa do desvio horário que
  // sincronizarHoraServidor() calcula.
  const [, okRegras] = await Promise.all([sincronizarHoraServidor(), verificarRegrasGate()]);
  startClock();
  if (!okRegras) return;
  await mostrarVistaInicial();
}

// Vista inicial: a última vista guardada (F5) ou Assiduidade por defeito.
// IPs/Utilizadores/aprovações (gestaoActivar) só são pedidos quando a vista
// "Gestão" é mesmo a que vai ser mostrada — nunca adiantados "por via das
// dúvidas" para master/coordenador, porque isso disparava 2 pedidos extra
// em TODOS os logins (mesmo quando o destino era Assiduidade), logo no
// momento de maior concorrência pela quota partilhada de execuções
// simultâneas do Apps Script (ex.: várias lojas a abrir o portal à mesma
// hora) — ver 12º seguimento, 2026-09-10. Nota: havia aqui um bug antigo
// de precedência (um "if" solto a seguir a outro "if", sem "else"), que
// fazia este pré-carregamento disparar sempre que a role era
// master/coordenador e, nesses casos, "engolia" o "else if" seguinte —
// pelo que reabrir a app numa vista Gestão/Ocupação/Férias guardada (F5)
// nunca chegava a activar essa vista para essas roles. Corrigido ao mesmo
// tempo.
async function mostrarVistaInicial() {
  const savedView = sessionStorage.getItem('rmView');
  const viewInicial = (savedView && savedView !== 'regras') ? savedView : 'assiduidade';
  const navBtn = document.querySelector(`.nav-item[onclick*="'${viewInicial}'"]`);
  showView(viewInicial, navBtn);
  if (viewInicial === 'assiduidade') await assActivar();
  else if (viewInicial === 'gestao') gestaoActivar();
  else if (viewInicial === 'ocupacao') initOcupacaoDiaria();
  else if (viewInicial === 'ferias') feriasColabActivar();
}

function doLogout() {
  SESSION = SESSION ? { ip: SESSION.ip, local: SESSION.local } : null;
  ASS_ATRIB_CACHE = null; ASS_HORARIOS_CACHE = null; ASS_TURNOS_CACHE = null;
  try { sessionStorage.removeItem('rmSession'); sessionStorage.removeItem('rmView'); } catch(_) {}
  document.getElementById('dashboard-page').style.display='none';
  document.getElementById('inp-user').value='';
  document.getElementById('inp-pass').value='';
  showLogin();
}

function showView(id, btn) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+id).classList.add('active');
  if (btn) { document.querySelectorAll('.nav-item:not(.soon)').forEach(n=>n.classList.remove('active')); btn.classList.add('active'); }
  try { sessionStorage.setItem('rmView', id); } catch(_) {}
}

// ═══════════════════════════════════════
//  GESTÃO — IPs
// ═══════════════════════════════════════

function renderIPs(ips) {
  document.getElementById('ip-atual-gestao').textContent=SESSION.ip;
  const lista=document.getElementById('lista-ips'); lista.innerHTML='';
  ips.forEach(item=>{
    const div=document.createElement('div'); div.className='ip-item';
    const isAtual=item.ip===SESSION.ip;
    const localAttr = String(item.local ?? '').replace(/'/g,"\\'"), ipAttr = String(item.ip ?? '').replace(/'/g,"\\'");
    div.innerHTML=`<div class="ip-info"><div class="ip-local">${esc(item.local)}</div><div class="ip-addr">${esc(item.ip)}</div></div>${item.fixo?'<span class="ip-badge fixo">Fixo</span>':''}${isAtual?'<span class="ip-badge atual">Este PC</span>':''}${!item.fixo&&item.ativo?`<button class="btn-sm danger" onclick="desativarIP('${ipAttr}','${localAttr}')">Desativar</button>`:''}${!item.ativo?'<span style="font-size:0.7rem;color:var(--danger);font-weight:600;">Inativo</span>':''}`;
    lista.appendChild(div);
  });
}

async function carregarIPs() {
  const res=await api({acao:'listarIPs',ip:SESSION.ip,username:SESSION.username,password:SESSION.password});
  if (!res.ok) return;
  renderIPs(res.ips);
}

async function adicionarIP() {
  const local=document.getElementById('novo-ip-local').value.trim(), ip=document.getElementById('novo-ip-addr').value.trim(), fixo=document.getElementById('novo-ip-fixo').value==='true';
  const err=document.getElementById('ip-error'), suc=document.getElementById('ip-success');
  err.style.display='none'; suc.style.display='none';
  if (!local||!ip) { showAlert(err,'Preencha o local e o IP.'); return; }
  const res=await api({acao:'adicionarIP',ip:SESSION.ip,username:SESSION.username,password:SESSION.password,local,novoIP:ip,fixo});
  if (res.ok) { showAlert(suc,res.mensagem); document.getElementById('novo-ip-local').value=''; document.getElementById('novo-ip-addr').value=''; await carregarIPs(); }
  else showAlert(err,res.erro);
}

async function desativarIP(ipAlvo, local) {
  if (!confirm(`Desativar o IP de "${local}" (${ipAlvo})?`)) return;
  const err=document.getElementById('ip-error'), suc=document.getElementById('ip-success');
  err.style.display='none'; suc.style.display='none';
  const res=await api({acao:'desativarIP',ip:SESSION.ip,username:SESSION.username,password:SESSION.password,ipAlvo});
  if (res.ok) { showAlert(suc,res.mensagem); await carregarIPs(); } else showAlert(err,res.erro);
}

// ═══════════════════════════════════════
//  GESTÃO — UTILIZADORES
// ═══════════════════════════════════════
function renderUtilizadores(utilizadores) {
  const lista=document.getElementById('lista-users'); lista.innerHTML='';
  utilizadores.forEach(u=>{
    const div=document.createElement('div'); div.className='user-item';
    const userAttr = String(u.username ?? '').replace(/'/g,"\\'");
    div.innerHTML=`<div class="user-info"><div class="user-name-g">${esc(u.nome)}</div><div class="user-meta">@${esc(u.username)}</div></div><span class="role-badge ${esc(u.role)}">${roleLabel(u.role)}</span>${u.ativo?`<button class="btn-sm teal" onclick="abrirResetPass('${userAttr}')">🔑 Reset</button>${u.username!==SESSION.username?`<button class="btn-sm danger" onclick="desativarUser('${userAttr}')">Desativar</button>`:'`'}`:'<span style="font-size:0.7rem;color:var(--danger);font-weight:600;">Inativo</span>'}`;
    lista.appendChild(div);
  });
}

async function carregarUtilizadores() {
  const res=await api({acao:'listarUtilizadores',ip:SESSION.ip,username:SESSION.username,password:SESSION.password});
  if (!res.ok) return;
  renderUtilizadores(res.utilizadores);
}

async function criarUtilizador() {
  const username=document.getElementById('nu-username').value.trim().toLowerCase(), nome=document.getElementById('nu-nome').value.trim(), password=document.getElementById('nu-pass').value, role=document.getElementById('nu-role').value;
  const err=document.getElementById('user-error'), suc=document.getElementById('user-success');
  err.style.display='none'; suc.style.display='none';
  if (!username||!nome||!password) { showAlert(err,'Preencha todos os campos.'); return; }
  const res=await api({acao:'criarUtilizador',ip:SESSION.ip,username:SESSION.username,password:SESSION.password,novoUser:{username,nome,password,role}});
  if (res.ok) { showAlert(suc,res.mensagem); document.getElementById('nu-username').value=''; document.getElementById('nu-nome').value=''; document.getElementById('nu-pass').value=''; await carregarUtilizadores(); }
  else showAlert(err,res.erro);
}

async function desativarUser(usernameAlvo) {
  if (!confirm(`Desativar o utilizador "${usernameAlvo}"?`)) return;
  const err=document.getElementById('user-error'), suc=document.getElementById('user-success');
  err.style.display='none'; suc.style.display='none';
  const res=await api({acao:'desativarUtilizador',ip:SESSION.ip,username:SESSION.username,password:SESSION.password,usernameAlvo});
  if (res.ok) { showAlert(suc,res.mensagem); await carregarUtilizadores(); } else showAlert(err,res.erro);
}

function abrirResetPass(username) {
  modalResetTarget=username; document.getElementById('modal-reset-user').textContent=username;
  document.getElementById('modal-nova-pass').value=''; document.getElementById('modal-pass-error').style.display='none';
  document.getElementById('modal-reset-pass').classList.add('open');
}

async function confirmarResetPass() {
  const passwordNova=document.getElementById('modal-nova-pass').value, err=document.getElementById('modal-pass-error');
  err.style.display='none';
  if (!passwordNova||passwordNova.length<6) { showAlert(err,'Mínimo 6 caracteres.'); return; }
  const res=await api({acao:'redefinirPassword',ip:SESSION.ip,master:SESSION.username,passwordMaster:SESSION.password,username:modalResetTarget,passwordNova});
  if (res.ok) { closeModal('modal-reset-pass'); alert('Password redefinida com sucesso.'); } else showAlert(err,res.erro);
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ═══════════════════════════════════════
//  PERFIL
// ═══════════════════════════════════════
async function alterarPassword() {
  const passAtual=document.getElementById('pass-atual').value, passNova=document.getElementById('pass-nova').value, passConfirm=document.getElementById('pass-confirm').value;
  const err=document.getElementById('pass-error'), suc=document.getElementById('pass-success');
  err.style.display='none'; suc.style.display='none';
  if (!passAtual||!passNova||!passConfirm) { showAlert(err,'Preencha todos os campos.'); return; }
  if (passNova!==passConfirm) { showAlert(err,'As passwords não coincidem.'); return; }
  if (passNova.length<6) { showAlert(err,'Mínimo 6 caracteres.'); return; }
  const res=await api({acao:'alterarPassword',ip:SESSION.ip,username:SESSION.username,passwordAtual:passAtual,passwordNova:passNova});
  if (res.ok) { SESSION.password=passNova; guardarSessao(); showAlert(suc,'Password alterada com sucesso!'); document.getElementById('pass-atual').value=''; document.getElementById('pass-nova').value=''; document.getElementById('pass-confirm').value=''; }
  else showAlert(err,res.erro);
}

// ═══════════════════════════════════════
//  UTILITÁRIOS GERAIS
// ═══════════════════════════════════════
let _loadingCount = 0;
function showGlobalLoading(msg) {
  _loadingCount++;
  document.getElementById('global-loading-text').textContent = msg || 'A processar…';
  document.getElementById('global-loading').classList.add('active');
  document.body.classList.add('is-loading');
}
function hideGlobalLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    document.getElementById('global-loading').classList.remove('active');
    document.body.classList.remove('is-loading');
  }
}
// Envolve o fetch com repetições automáticas e silenciosas — cobre pedidos que
// falham na rede, voltam com status de erro, ou vêm com corpo inválido (não-JSON).
// Não resolve a causa (limite de execuções simultâneas do Apps Script — mais
// apertado em contas Google pessoais do que em contas Workspace), mas evita que
// o colaborador veja um erro por causa de uma falha pontual e transitória.
// 2026-09-11, investigação de erros CORS/ERR_FAILED reportados pelo Ricardo:
// confirmado no registo de Execuções da Apps Script que o servidor está sempre
// a concluir sem erro nenhum — o pedido falhado nem chega a aparecer lá, porque
// é rejeitado na própria rede quando várias lojas/pessoas pedem ao mesmo tempo
// (visto no registo: várias chamadas doPost no mesmo segundo exacto). Subido de
// 2 para 3 tentativas, com um espaçamento maior e crescente entre elas (em vez
// de um valor fixo), para dar mais hipótese de apanhar uma janela livre quando
// o portal está a ser usado por várias lojas em simultâneo.
// 2026-09-12 (2ª ronda de auditoria, REVERTIDO no mesmo dia): tinha sido
// acrescentado aqui um timeout por tentativa (AbortController), a sugestão da
// auditoria para o caso de uma tentativa ficar pendurada para sempre sem
// resposta nenhuma. Com dados reais de produção do Ricardo (2 incidentes no
// mesmo dia, o 2º depois de já ter subido o valor de 15s para 40s a tentar
// corrigir o 1º), ficou claro que essa premissa não correspondia à realidade
// desta Apps Script: não há tentativas presas para sempre, há respostas
// legítimas e lentas — 8s, 14s, até 30s sob a mesma saturação de execuções
// simultâneas já documentada — que o timeout interrompia mesmo antes de
// chegarem. E abortar do lado do browser NÃO cancela a execução do lado da
// Apps Script — essa continua a correr e a ocupar a mesma quota partilhada —
// pelo que cada aborto seguido de nova tentativa só somava mais um pedido a
// competir pela mesma quota, piorando precisamente o problema que já
// vínhamos a combater há semanas. Revertido para esperar sem limite de tempo,
// como sempre foi antes desta ronda de auditoria — o backoff exponencial
// entre tentativas (abaixo) mantém-se, é inofensivo e ajuda a espaçar
// tentativas sucessivas. Para a lentidão em si, a única correcção que ajuda
// de facto é do lado da quota (ver 26º seguimento — conta Google Workspace
// vs pessoal), não um timeout no cliente.
async function fetchComRetry(url, payload, tentativas) {
  tentativas = tentativas || 3;
  let ultimoErro = 'Sem resposta do servidor.';
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, {method:'POST', body: JSON.stringify(payload)});
      if (!res.ok) { ultimoErro = 'Erro do servidor (HTTP '+res.status+').'; }
      else {
        const texto = await res.text();
        try { return JSON.parse(texto); }
        catch(_) { ultimoErro = 'Resposta inválida do servidor.'; }
      }
    } catch(e) {
      ultimoErro = 'Falha de ligação.';
    }
    if (i < tentativas - 1) {
      const base = 800 * Math.pow(2, i); // 800, 1600, 3200…
      await new Promise(r => setTimeout(r, base + Math.random()*400));
    }
  }
  return {ok:false, erro: ultimoErro + ' Tenta novamente.'};
}

async function api(payload) {
  showGlobalLoading();
  try {
    return await fetchComRetry(SCRIPT_URL, payload, 3);
  } finally {
    hideGlobalLoading();
  }
}
function roleLabel(role) { return {master:'Master',coordenador_lojas:'Coordenador Lojas',assistente_loja:'Assistente de Loja'}[role]||role; }
function showAlert(el,msg) { el.textContent=msg; el.style.display='block'; }
// 2026-09-12 (2ª ronda de auditoria) — item crítico de segurança: o ficheiro
// injecta em várias tabelas/cartões (innerHTML) valores que vêm do
// backend/Sheets e, nalguns casos, foram escritos directamente por um
// colaborador (ex.: motivo/justificativa ao registar fora de baliza ou ao
// pedir hora extra — texto livre que aparece depois no cartão de Aprovações,
// visto pelo master/coordenador). Sem escape, um nome ou motivo com
// "<img src=x onerror=...>" corre no browser de quem o vir a seguir — um
// vector de XSS armazenado trivial. esc() escapa os 5 caracteres que
// importam para innerHTML; usar sempre que se interpola texto vindo do
// servidor (nome, local, motivo, username, etc.) dentro de innerHTML.
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
let _GLOBAL_OFFSET = 0;
async function sincronizarHoraServidor() {
  try {
    const r = await assApi({acao:'obterHoraServidor'});
    if (r.ok) _GLOBAL_OFFSET = r.timestamp - Date.now();
  } catch(_) {}
}
function startClock() {
  const tick = () => {
    const now = new Date(Date.now() + _GLOBAL_OFFSET);
    document.getElementById('clock').textContent = now.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  };
  tick();
  setInterval(tick, 1000);
}
function setPageDate() { document.getElementById('page-date').textContent=new Date().toLocaleDateString('pt-PT',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }
function buildChart() {
  const data=[{day:'Seg',val:9800},{day:'Ter',val:11200},{day:'Qua',val:15800},{day:'Qui',val:8400},{day:'Sex',val:13200},{day:'Sáb',val:10600},{day:'Hj',val:12480}];
  const max=Math.max(...data.map(d=>d.val));
  const container=document.getElementById('chart-bars'); container.innerHTML='';
  data.forEach((d,i)=>{ const pct=Math.round((d.val/max)*80); const wrap=document.createElement('div'); wrap.className='chart-bar-wrap'; const bar=document.createElement('div'); bar.className='chart-bar'+(i===data.length-1?' active':''); bar.style.height=pct+'%'; bar.title=`€ ${d.val.toLocaleString('pt-PT')}`; const label=document.createElement('span'); label.className='chart-label'; label.textContent=d.day; bar.appendChild(label); wrap.appendChild(bar); container.appendChild(wrap); });
}

// ═══════════════════════════════════════
//  ASSIDUIDADE
// ═══════════════════════════════════════
// 2026-09-12: era o mesmo URL escrito 2ª vez neste ficheiro (mantido como
// nome à parte por legibilidade — usado nas chamadas de Assiduidade/Gestão
// — mas apontando sempre para o mesmo SCRIPT_URL, para só haver 1 sítio a
// actualizar se a implantação da Apps Script alguma vez mudar de URL).
const ASS_URL = SCRIPT_URL;
let ASS_REGISTO_HOJE = null;
let ASS_COLEGAS_CACHE = [];
let ASS_LOCAL_ID = null;
let ASS_TURNO_ID = null;
let ASS_CLOCK_OK = false;
let ASS_ATRIB_CACHE = null;    // todas as atribuições do próprio utilizador (todas as semanas) — evita repetir o pedido em assCarregarProximosDias
let ASS_HORARIOS_CACHE = null; // todos os horários tipo semanais
let ASS_TURNOS_CACHE = null;   // todos os turnos tipo

async function assApi(payload) {
  const msgs = {
    registarEntrada:'A registar entrada…', registarSaida:'A registar saída…',
    registarPausa:'A registar pausa…', gantSemanal:'A carregar Gantt…',
    listarHorariosTipoSemanal:'A carregar horários…', atribuirSemana:'A atribuir semana…',
    listarFerias:'A carregar férias…', mapaMenusal:'A carregar mapa…',
    listarAprovacoes:'A carregar aprovações…'
  };
  showGlobalLoading(msgs[payload.acao] || 'A processar…');
  try {
    return await fetchComRetry(ASS_URL, {...payload,username:SESSION.username,password:SESSION.password}, 3);
  } finally {
    hideGlobalLoading();
  }
}

async function assIniciar() {
  // Iniciar relógio imediatamente — não bloqueia
  document.getElementById('ass-data').textContent=new Date().toLocaleDateString('pt-PT',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if (!ASS_CLOCK_OK) {
    ASS_CLOCK_OK = true;
    let _offset = _GLOBAL_OFFSET;
    const tick = () => {
      const now = new Date(Date.now() + _offset);
      document.getElementById('ass-relogio').textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      document.getElementById('ass-data2').textContent = now.toLocaleDateString('pt-PT',{weekday:'long',day:'numeric',month:'long'});
    };
    tick();
    setInterval(tick, 1000);
  }

  // Calcular segunda-feira da semana de hoje
  const dt = new Date();
  const dow = dt.getDay();
  const segDt = new Date(dt);
  segDt.setDate(segDt.getDate() - ((dow + 6) % 7));
  const semanaInicio = segDt.getFullYear()+'-'+String(segDt.getMonth()+1).padStart(2,'0')+'-'+String(segDt.getDate()).padStart(2,'0');
  const CAMPOS_DIA = ['turnoDom','turnoSeg','turnoTer','turnoQua','turnoQui','turnoSex','turnoSab'];
  const campoDia = CAMPOS_DIA[dt.getDay()];

  // FASE 1 — tudo o que é crítico para o botão de ponto, numa ÚNICA chamada agregada ao
  // backend (em vez de 5 pedidos HTTP separados). Reduz o pico de pedidos simultâneos no
  // arranque — era a causa principal da lentidão sentida no login e troca de vista.
  const rArranque = await assApi({acao:'carregarArranqueAssiduidade', semanaInicio});
  const rAtrib   = {ok: rArranque.ok, atribuicoes: rArranque.atribuicoes || []};
  const rHorTipo = {ok: rArranque.ok, horarios: rArranque.horarios || []};
  const rTurnos  = {ok: rArranque.ok, turnos: rArranque.turnos || []};
  const rLoc     = {ok: rArranque.ok, locais: rArranque.locais || []};
  const rMeu     = {ok: rArranque.ok, registo: rArranque.registoHoje || null};

  // Guardar em cache para reutilização (assCarregarProximosDias, assCarregarMaisDias)
  if (rAtrib.ok)   ASS_ATRIB_CACHE = rAtrib.atribuicoes;
  if (rHorTipo.ok) ASS_HORARIOS_CACHE = rHorTipo.horarios;
  if (rTurnos.ok)  ASS_TURNOS_CACHE = rTurnos.turnos;

  // Resolver turno e local de HOJE a partir das atribuições
  ASS_LOCAL_ID = null;
  ASS_TURNO_ID = null;
  if (rAtrib.ok && rAtrib.atribuicoes.length) {
    const atribHoje = rAtrib.atribuicoes.find(a => String(a.semanaInicio).slice(0,10) === semanaInicio);
    if (atribHoje) {
    ASS_LOCAL_ID = atribHoje.localId;
    if (rHorTipo.ok) {
      const horario = rHorTipo.horarios.find(h => h.id === atribHoje.horarioTipoId);
      if (horario) {
        const turnoIdHoje = horario[campoDia];
        if (turnoIdHoje) ASS_TURNO_ID = turnoIdHoje;
      }
    }
    // O local do turno do dia tem prioridade sobre o local da atribuição semanal
    if (ASS_TURNO_ID && rTurnos.ok) {
      const turnoHoje = rTurnos.turnos.find(t => t.id === ASS_TURNO_ID);
      if (turnoHoje && turnoHoje.localId) ASS_LOCAL_ID = turnoHoje.localId;
    }
    }
  }

  // Fallback: se não houver atribuição, usar 1º local
  if (!ASS_LOCAL_ID && rLoc.ok && rLoc.locais.length) ASS_LOCAL_ID = rLoc.locais[0].id;

  // Se já existe registo de hoje noutro local (ex: entrada manual), esse local prevalece
  const meuRegistoHoje = (rMeu.ok && rMeu.registo) ? rMeu.registo : null;
  if (meuRegistoHoje && meuRegistoHoje.localId) ASS_LOCAL_ID = meuRegistoHoje.localId;
  ASS_REGISTO_HOJE = meuRegistoHoje;

  // Cache de locais e mostrar nome
  if (rLoc.ok) {
    LOCAIS_CACHE = rLoc.locais;
    const local = rLoc.locais.find(l=>l.id===ASS_LOCAL_ID);
    document.getElementById('ass-local-nome').textContent = local?.nome || '—';
  }

  // Mostrar nome do turno previsto (sem nova chamada API — usa rTurnos)
  if (ASS_TURNO_ID && rTurnos.ok) {
    const turno = rTurnos.turnos.find(t => t.id === ASS_TURNO_ID);
    if (turno) {
      const pausas = [turno.pausa1Label, turno.pausa2Label, turno.pausa3Label].filter(Boolean);
      document.getElementById('ass-turno').textContent = `${turno.nome}: ${minParaHora(turno.inicioMin)}–${minParaHora(turno.fimMin)}${pausas.length?' · '+pausas.join(', '):''}`;
    } else {
      document.getElementById('ass-turno').textContent = 'Sem turno atribuído';
    }
  } else {
    document.getElementById('ass-turno').textContent = 'Sem turno atribuído';
  }

  // Botão de ponto disponível JÁ — não espera pela lista de colegas (era o gargalo antigo)
  assAtualizarUI();

  // FASE 2 — em segundo plano, não bloqueia o botão: colegas + os meus últimos registos
  assApi({acao:'registosColegas', localId: ASS_LOCAL_ID}).then(rRegistos => {
    if (rRegistos.ok) {
      ASS_COLEGAS_CACHE = rRegistos.registos;
      assMostrarMeusRegistos();
      assPopularFiltroColegas();
      assFiltraColegas();
    } else {
      const msgErro = `<div style="text-align:center;padding:1rem;color:var(--danger);font-size:.82rem">Erro ao carregar. <a onclick="assIniciar()" style="cursor:pointer;text-decoration:underline">Tentar novamente</a></div>`;
      document.getElementById('ass-meus-registos').innerHTML = msgErro;
      document.getElementById('ass-colegas-lista').innerHTML = msgErro;
    }
  });

  // FASE 3 — Próximos turnos (não bloqueia UI). Já temos rAtrib, rHorTipo, rTurnos em cache.
  ASS_DIAS_MOSTRADOS = 7;
  assCarregarProximosDias();
}

// 2026-09-12 (2ª ronda de auditoria): assMinParaHora era idêntica a
// minParaHora (definida mais abaixo) — mesma lógica, só a sintaxe (template
// string vs concatenação) diferia. Removida; usar sempre minParaHora().
// assMinParaHoraH, apesar do nome parecido, NÃO é duplicada de
// minParaHoraH — arredonda ao número de horas inteiro (com tolerância de 5
// min) e mostra só "Xh", enquanto minParaHoraH mostra minutos exactos
// ("Xh30m"). São usadas em sítios diferentes de propósito; mantidas as duas.
function assMinParaHoraH(min) {
  const m = Number(min);
  const h = Math.floor(m/60);
  const restoMin = m - h*60;
  return ((60 - restoMin) <= 5 ? h + 1 : h) + 'h';
}
function assDataHoje() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function assFormatarData(str) { if(!str) return '—'; let s=(str instanceof Date)?str.toISOString():String(str); s=s.slice(0,10); const [a,m,d]=s.split('-'); if(!a||!m||!d) return String(str); return `${d}/${m}/${a}`; }function assIniciais(nome) { if(!nome) return '?'; return nome.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }

async function assCarregarPonto() {
  // Rápido: só o meu próprio registo de hoje, para os botões reagirem já
  const r=await assApi({acao:'meuRegistoHoje'});
  if (r.ok) ASS_REGISTO_HOJE = r.registo || null;
  assAtualizarUI();

  // Em segundo plano — não atrasa a confirmação do ponto
  assApi({acao:'registosColegas',localId:ASS_LOCAL_ID}).then(rColegas => {
    if (rColegas.ok) {
      ASS_COLEGAS_CACHE = rColegas.registos;
      assMostrarMeusRegistos();
      assPopularFiltroColegas();
      assFiltraColegas();
    } else {
      const msgErro = `<div style="text-align:center;padding:1rem;color:var(--danger);font-size:.82rem">Erro ao carregar. <a onclick="assCarregarPonto()" style="cursor:pointer;text-decoration:underline">Tentar novamente</a></div>`;
      document.getElementById('ass-meus-registos').innerHTML = msgErro;
      document.getElementById('ass-colegas-lista').innerHTML = msgErro;
    }
  });
}

// assConfirmarSaida — modal de confirmação antes de registar saída
function assConfirmarSaida() {
  return new Promise(resolve => {
    // Criar overlay
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    overlay.innerHTML=`
      <div style="background:var(--card-bg);border-radius:14px;padding:1.5rem;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3);text-align:center">
        <div style="font-size:2rem;margin-bottom:.5rem">⏹</div>
        <div style="font-weight:700;font-size:1rem;margin-bottom:.4rem;color:var(--text-main)">Registar Saída?</div>
        <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:1.25rem">Esta acção é irreversível.<br>Confirmas que terminaste o teu turno?</div>
        <div style="display:flex;gap:.75rem;justify-content:center">
          <button id="conf-saida-nao" style="flex:1;padding:.55rem;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text-main);font-weight:600;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Cancelar</button>
          <button id="conf-saida-sim" style="flex:1;padding:.55rem;border-radius:8px;border:none;background:#E8000D;color:white;font-weight:700;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Confirmar Saída</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('conf-saida-sim').onclick = () => { document.body.removeChild(overlay); resolve(true); };
    document.getElementById('conf-saida-nao').onclick = () => { document.body.removeChild(overlay); resolve(false); };
    overlay.onclick = (e) => { if(e.target===overlay){ document.body.removeChild(overlay); resolve(false); } };
  });
}

// Perguntado só quando a saída acontece mais de 30 min depois da hora prevista.
// Devolve {pedir:boolean, justificacao:string}.
function assPerguntarHoraExtra() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    overlay.innerHTML=`
      <div style="background:var(--card-bg);border-radius:14px;padding:1.5rem;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3)">
        <div style="text-align:center;font-size:2rem;margin-bottom:.5rem">⏰</div>
        <div style="font-weight:700;font-size:1rem;margin-bottom:.4rem;color:var(--text-main);text-align:center">Estás a sair mais tarde do que o previsto</div>
        <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:1rem;text-align:center">Queres pedir ao coordenador o reconhecimento deste tempo extra?</div>
        <textarea id="extra-justif" class="form-input" rows="2" placeholder="Justificação (obrigatória para pedir)" style="width:100%;box-sizing:border-box;margin-bottom:.5rem;resize:vertical"></textarea>
        <div id="extra-err" style="display:none;color:var(--danger);font-size:.75rem;margin-bottom:.75rem;text-align:center">Justificação obrigatória para pedir hora extra.</div>
        <div style="display:flex;gap:.75rem;justify-content:center">
          <button id="extra-nao" style="flex:1;padding:.55rem;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text-main);font-weight:600;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Não pedir</button>
          <button id="extra-sim" style="flex:1;padding:.55rem;border-radius:8px;border:none;background:var(--teal);color:white;font-weight:700;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Pedir hora extra</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const fechar = (resultado) => { document.body.removeChild(overlay); resolve(resultado); };
    document.getElementById('extra-sim').onclick = () => {
      const justif = document.getElementById('extra-justif').value.trim();
      if (!justif) { document.getElementById('extra-err').style.display='block'; return; }
      fechar({pedir:true, justificacao:justif});
    };
    document.getElementById('extra-nao').onclick = () => fechar({pedir:false, justificacao:''});
    overlay.onclick = (e) => { if(e.target===overlay) fechar({pedir:false, justificacao:''}); };
  });
}

// assPerguntarEntradaAntecipada — espelho de assPerguntarHoraExtra, mas para chegada
// com 30+ min de antecedência em vez de saída tardia
function assPerguntarEntradaAntecipada(minutosAntecedencia) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
    overlay.innerHTML=`
      <div style="background:var(--card-bg);border-radius:14px;padding:1.5rem;max-width:340px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3)">
        <div style="text-align:center;font-size:2rem;margin-bottom:.5rem">⏰</div>
        <div style="font-weight:700;font-size:1rem;margin-bottom:.4rem;color:var(--text-main);text-align:center">Estás a entrar ${minutosAntecedencia} min antes do previsto</div>
        <div style="font-size:.85rem;color:var(--text-muted);margin-bottom:1rem;text-align:center">Queres pedir ao coordenador o reconhecimento deste tempo extra? Se não pedires, fica registada a hora do horário.</div>
        <textarea id="extra-entrada-justif" class="form-input" rows="2" placeholder="Justificação (obrigatória para pedir)" style="width:100%;box-sizing:border-box;margin-bottom:.5rem;resize:vertical"></textarea>
        <div id="extra-entrada-err" style="display:none;color:var(--danger);font-size:.75rem;margin-bottom:.75rem;text-align:center">Justificação obrigatória para pedir tempo extra.</div>
        <div style="display:flex;gap:.75rem;justify-content:center">
          <button id="extra-entrada-nao" style="flex:1;padding:.55rem;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text-main);font-weight:600;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Não pedir</button>
          <button id="extra-entrada-sim" style="flex:1;padding:.55rem;border-radius:8px;border:none;background:var(--teal);color:white;font-weight:700;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Pedir tempo extra</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const fechar = (resultado) => { document.body.removeChild(overlay); resolve(resultado); };
    document.getElementById('extra-entrada-sim').onclick = () => {
      const justif = document.getElementById('extra-entrada-justif').value.trim();
      if (!justif) { document.getElementById('extra-entrada-err').style.display='block'; return; }
      fechar({pedir:true, justificacao:justif});
    };
    document.getElementById('extra-entrada-nao').onclick = () => fechar({pedir:false, justificacao:''});
    overlay.onclick = (e) => { if(e.target===overlay) fechar({pedir:false, justificacao:''}); };
  });
}

// assAbrirModalLocalManual — modal para registar entrada num local diferente do habitual
function assAbrirModalLocalManual() {
  const overlay = document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  const opcoesLocais = LOCAIS_CACHE.map(l=>`<option value="${l.id}">${esc(l.nome)}</option>`).join('');
  overlay.innerHTML=`
    <div style="background:var(--card-bg);border-radius:14px;padding:1.5rem;max-width:360px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.3)">
      <div style="font-size:1.5rem;margin-bottom:.5rem;text-align:center">📍</div>
      <div style="font-weight:700;font-size:1rem;margin-bottom:.75rem;color:var(--text-main);text-align:center">Registar entrada noutro local</div>
      <label style="font-size:.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:.3rem">Local</label>
      <select id="local-manual-select" style="width:100%;padding:.5rem;border-radius:8px;border:1px solid var(--gray-light);font-family:'Outfit',sans-serif;margin-bottom:.75rem">
        <option value="">Selecionar local…</option>
        ${opcoesLocais}
      </select>
      <label style="font-size:.78rem;font-weight:600;color:var(--text-muted);display:block;margin-bottom:.3rem">Justificação (obrigatória)</label>
      <textarea id="local-manual-justif" rows="3" style="width:100%;padding:.5rem;border-radius:8px;border:1px solid var(--gray-light);font-family:'Outfit',sans-serif;resize:vertical;margin-bottom:.5rem" placeholder="Ex: Deslocação de emergência à loja de Ovar"></textarea>
      <div id="local-manual-err" style="display:none;color:var(--danger);font-size:.78rem;margin-bottom:.5rem"></div>
      <div style="display:flex;gap:.75rem;justify-content:center;margin-top:.5rem">
        <button id="local-manual-cancelar" style="flex:1;padding:.55rem;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text-main);font-weight:600;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Cancelar</button>
        <button id="local-manual-confirmar" style="flex:1;padding:.55rem;border-radius:8px;border:none;background:#00a878;color:white;font-weight:700;font-size:.85rem;cursor:pointer;font-family:'Outfit',sans-serif">Confirmar Entrada</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('local-manual-cancelar').onclick = () => document.body.removeChild(overlay);
  overlay.onclick = (e) => { if(e.target===overlay) document.body.removeChild(overlay); };
  document.getElementById('local-manual-confirmar').onclick = async () => {
    const localId = document.getElementById('local-manual-select').value;
    const justificativa = document.getElementById('local-manual-justif').value.trim();
    const err = document.getElementById('local-manual-err');
    err.style.display='none';
    if (!localId) { err.textContent='Selecione um local.'; err.style.display='block'; return; }
    if (!justificativa) { err.textContent='A justificação é obrigatória.'; err.style.display='block'; return; }
    document.body.removeChild(overlay);
    await assRegistarEntradaLocalManual(localId, justificativa);
  };
}

// assRegistarEntradaLocalManual — regista entrada com localId escolhido manualmente
async function assRegistarEntradaLocalManual(localId, justificativa) {
  document.getElementById('ass-err').style.display='none';
  document.getElementById('ass-warn').style.display='none';
  document.getElementById('ass-ok').style.display='none';
  let r;
  try {
    r = await assApi({acao:'registarEntrada', localId, localManual:true, justificativa});
    if (r && r.ok) ASS_LOCAL_ID = localId;
  } catch(e) { r={ok:false,erro:'Erro de ligação. Tente novamente.'}; }
  if (!r) { await assCarregarPonto(); return; }
  if (!r.ok) {
    const el=document.getElementById('ass-err'); el.textContent=r.erro; el.style.display='block';
  } else {
    if (r.aviso) { const el=document.getElementById('ass-warn'); el.textContent=r.aviso; el.style.display='block'; }
    else { const el=document.getElementById('ass-ok'); el.textContent='✅ Registo efectuado com sucesso.'; el.style.display='block'; setTimeout(()=>{el.style.display='none';},4000); }
  }
  try { await assCarregarPonto(); } catch(e) { console.error('Erro a recarregar:', e); }
}

// assAcao — versão única com feedback visual e protecção anti-duplo-clique
async function assAcao(tipo) {
  let pedirHoraExtra = false, justificativaExtra = '';
  let pedirTempoExtra = false, justificativaTempoExtra = '';

  // Confirmação antes de saída
  if (tipo==='saida') {
    const confirmado = await assConfirmarSaida();
    if (!confirmado) return;

    // Só pergunta sobre hora extra se já passaram 30 min da hora prevista de saída
    const turno = (ASS_TURNO_ID && ASS_TURNOS_CACHE) ? ASS_TURNOS_CACHE.find(t=>t.id===ASS_TURNO_ID) : null;
    if (turno && turno.fimMin!=null && turno.fimMin!=='') {
      const agora = new Date();
      const agoraMin = agora.getHours()*60 + agora.getMinutes();
      if (agoraMin > Number(turno.fimMin) + 30) {
        const resposta = await assPerguntarHoraExtra();
        pedirHoraExtra = resposta.pedir;
        justificativaExtra = resposta.justificacao;
      }
    }
  }

  // Só pergunta sobre entrada antecipada se faltam 30+ min para a hora prevista
  if (tipo==='entrada') {
    const turno = (ASS_TURNO_ID && ASS_TURNOS_CACHE) ? ASS_TURNOS_CACHE.find(t=>t.id===ASS_TURNO_ID) : null;
    if (turno && turno.inicioMin!=null && turno.inicioMin!=='') {
      const agora = new Date();
      const agoraMin = agora.getHours()*60 + agora.getMinutes();
      const antecedencia = Number(turno.inicioMin) - agoraMin;
      if (antecedencia >= 30) {
        const resposta = await assPerguntarEntradaAntecipada(antecedencia);
        pedirTempoExtra = resposta.pedir;
        justificativaTempoExtra = resposta.justificacao;
      }
    }
  }
  const botoes=['ass-btn-entrada','ass-btn-pausa','ass-btn-retorno','ass-btn-saida'];
  botoes.forEach(id=>{ const btn=document.getElementById(id); if(btn){btn.disabled=true;btn.style.opacity='0.6';btn.style.cursor='not-allowed';} });
  const btnClicado=document.getElementById(`ass-btn-${tipo==='retorno'?'retorno':tipo==='pausa'?'pausa':tipo}`);
  const textoOriginal=btnClicado?btnClicado.textContent:'';
  if (btnClicado) btnClicado.textContent='⏳ A processar…';
  document.getElementById('ass-err').style.display='none';
  document.getElementById('ass-warn').style.display='none';
  document.getElementById('ass-ok').style.display='none';
  let r;
  try {
    if (tipo==='entrada') { r=await assApi({acao:'registarEntrada',localId:ASS_LOCAL_ID,pedirTempoExtra,justificativaTempoExtra}); }
    else if (tipo==='saida') { r=await assApi({acao:'registarSaida',localId:ASS_LOCAL_ID,pedirHoraExtra,justificativaExtra}); }
    else if (tipo==='pausa') {
      const reg=ASS_REGISTO_HOJE; let num=1;
      if (reg&&reg.pausa1InicioMin!=='') num=2;
      if (reg&&reg.pausa2InicioMin!=='') num=3;
      r=await assApi({acao:'registarPausa',numeroPausa:num,tipo:'inicio'});
    } else if (tipo==='retorno') {
      const reg=ASS_REGISTO_HOJE; let num=1;
      if (reg&&reg.pausa1InicioMin!==''&&reg.pausa1FimMin==='') num=1;
      else if (reg&&reg.pausa2InicioMin!==''&&reg.pausa2FimMin==='') num=2;
      else if (reg&&reg.pausa3InicioMin!==''&&reg.pausa3FimMin==='') num=3;
      r=await assApi({acao:'registarPausa',numeroPausa:num,tipo:'fim'});
    }
  } catch(e) { r={ok:false,erro:'Erro de ligação. Tente novamente.'}; }
  if (btnClicado) btnClicado.textContent=textoOriginal;
  if (!r) { await assCarregarPonto(); return; }
  if (!r.ok) {
    const el=document.getElementById('ass-err'); el.textContent=r.erro; el.style.display='block';
  } else {
    if (r.aviso) { const el=document.getElementById('ass-warn'); el.textContent=r.aviso; el.style.display='block'; }
    else { const el=document.getElementById('ass-ok'); el.textContent='✅ Registo efectuado com sucesso.'; el.style.display='block'; setTimeout(()=>{el.style.display='none';},4000); }
  }
  // Recarregar SEMPRE, independentemente de ok/erro — garante UI sincronizada
  try { await assCarregarPonto(); } catch(e) { console.error('Erro a recarregar:', e); }
}

function assAtualizarUI() {
  const reg=ASS_REGISTO_HOJE;
  const btnE=document.getElementById('ass-btn-entrada'), btnP=document.getElementById('ass-btn-pausa');
  const btnR=document.getElementById('ass-btn-retorno'), btnS=document.getElementById('ass-btn-saida');
  const status=document.getElementById('ass-status');
  const linkLocalManual=document.getElementById('ass-link-local-manual');
  if (linkLocalManual) linkLocalManual.style.display = reg ? 'none' : 'block';

  // Cores originais por estado activo
  const COR_ENTRADA = '#00a878';
  const COR_PAUSA = '#f59e0b';
  const COR_RETORNO = '#2563eb';
  const COR_SAIDA = '#E8000D';
  const COR_DISABLED = '#cbd5e1';

  // Helper: aplicar estado visual ao botão
  const setBtn = (btn, enabled, corActiva) => {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.background = enabled ? corActiva : COR_DISABLED;
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    btn.style.opacity = '';
  };

  if (!reg) {
    setBtn(btnE, true, COR_ENTRADA);
    setBtn(btnP, false, COR_PAUSA);
    setBtn(btnR, false, COR_RETORNO);
    setBtn(btnS, false, COR_SAIDA);
    btnP.style.display='block'; btnR.style.display='none';
    status.style.display='none';
    document.getElementById('ass-estado-pill').innerHTML='<span style="background:rgba(255,255,255,.15);color:white;border-radius:20px;padding:.2rem .8rem;font-size:.75rem;font-weight:600">Sem registo</span>';
    return;
  }
  const temEntrada=reg.entradaRealMin!=='' && reg.entradaRealMin!==null && reg.entradaRealMin!==undefined;
  const temSaida=reg.saidaRealMin!=='' && reg.saidaRealMin!==null && reg.saidaRealMin!==undefined;
  const pausaAberta=(reg.pausa1InicioMin!==''&&reg.pausa1FimMin==='')||(reg.pausa2InicioMin!==''&&reg.pausa2FimMin==='')||(reg.pausa3InicioMin!==''&&reg.pausa3FimMin==='');

  if (temSaida) {
    // Dia completo — todos os botões desabilitados
    setBtn(btnE, false, COR_ENTRADA);
    setBtn(btnP, false, COR_PAUSA);
    setBtn(btnR, false, COR_RETORNO);
    setBtn(btnS, false, COR_SAIDA);
    btnP.style.display='block'; btnR.style.display='none';
  } else {
    // Entrada já feita — desabilitar entrada
    setBtn(btnE, false, COR_ENTRADA);
    if (pausaAberta) {
      btnP.style.display='none'; btnR.style.display='block';
      setBtn(btnR, true, COR_RETORNO);
      setBtn(btnS, false, COR_SAIDA);
    } else {
      btnP.style.display='block'; btnR.style.display='none';
      setBtn(btnP, temEntrada, COR_PAUSA);
      setBtn(btnS, temEntrada, COR_SAIDA);
    }
  }

  status.style.display=temEntrada?'block':'none';
  if (temEntrada) {
    document.getElementById('ass-ts-entrada').textContent=minParaHora(reg.entradaRealMin);
    document.getElementById('ass-ts-saida').textContent=temSaida?minParaHora(reg.saidaRealMin):'—';
    document.getElementById('ass-ts-total').textContent=reg.totalTrabalhadoMin?assMinParaHoraH(reg.totalTrabalhadoMin):'—';
  }
  const estado={normal:'A trabalhar',pendente_aprovacao:'Aguarda aprovação',completo:'Completo'}[reg.estado]||reg.estado;
  const cor=reg.estado==='completo'?'#2563eb':reg.estado==='pendente_aprovacao'?'#f59e0b':'#00a878';
  document.getElementById('ass-estado-pill').innerHTML=`<span style="background:${cor};color:white;border-radius:20px;padding:.2rem .8rem;font-size:.75rem;font-weight:600">${estado}</span>`;
}

function assPopularFiltroColegas() {
  const dias=[...new Set(ASS_COLEGAS_CACHE.map(x=>x.data))].sort().reverse();
  const sel=document.getElementById('ass-colegas-filtro');
  sel.innerHTML='<option value="">Todos os dias</option>';
  dias.forEach(d=>sel.innerHTML+=`<option value="${d}">${assFormatarData(d)}</option>`);
}
function assFiltraColegas() {
  const dia=document.getElementById('ass-colegas-filtro').value;
  const lista=dia?ASS_COLEGAS_CACHE.filter(r=>r.data===dia):ASS_COLEGAS_CACHE;
  const container=document.getElementById('ass-colegas-lista');
  const outros=lista.filter(r=>r.username!==SESSION.username);
  if (!outros.length) { container.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem registos para mostrar.</div>'; return; }
  const porData={};
  outros.forEach(r=>{ if(!porData[r.data]) porData[r.data]=[]; porData[r.data].push(r); });
  container.innerHTML=Object.entries(porData).sort(([a],[b])=>b.localeCompare(a)).map(([data,regs])=>`
    <div style="margin-bottom:1rem">
      <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.5rem">${assFormatarData(data)}</div>
      ${regs.map(r=>{
        const nomeAttr = String(r.nome ?? '').replace(/'/g,"\\'"), userAttr = String(r.username ?? '').replace(/'/g,"\\'");
        return `<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;border-radius:10px;border:1px solid var(--gray-light);background:var(--off-white);margin-bottom:.4rem">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--teal-pale);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;color:var(--teal);flex-shrink:0">${esc(assIniciais(r.nome))}</div>
        <div style="flex:1"><div style="font-weight:600;font-size:.85rem">${esc(r.nome)}</div><div style="font-size:.72rem;color:var(--text-muted);display:flex;gap:.75rem;margin-top:.1rem"><span>▶ ${r.entradaRealMin!==''?minParaHora(r.entradaRealMin):'—'}</span><span>⏹ ${r.saidaRealMin!==''?minParaHora(r.saidaRealMin):'—'}</span>${r.totalTrabalhadoMin?`<span>⏱ ${assMinParaHoraH(r.totalTrabalhadoMin)}</span>`:''}</div></div>
        <button onclick="assSinalizar('${userAttr}','${nomeAttr}','${data}')" style="font-size:.72rem;font-weight:600;background:#fff3e0;color:#d97706;border:none;border-radius:6px;padding:.25rem .6rem;cursor:pointer;font-family:'Outfit',sans-serif">⚑ Sinalizar</button>
      </div>`;}).join('')}
    </div>`).join('');
}

function assSinalizar(username, nome, data) {
  const nota=prompt(`Sinalizar anomalia de ${nome} em ${assFormatarData(data)}.\n\nDescreva a anomalia:`);
  if (!nota) return;
  assApi({acao:'criarSinalizacao',sinalizacao:{usernameAlvo:username,localId:ASS_LOCAL_ID,data,nota}}).then(r=>alert(r.ok?'Sinalização enviada ao coordenador.':r.erro));
}

// ═══════════════════════════════════════
//  ASSIDUIDADE — Próximos turnos / Últimos registos
// ═══════════════════════════════════════
let ASS_DIAS_MOSTRADOS = 7;

async function assCarregarProximosDias() {
  const container = document.getElementById('ass-proximos-dias');
  const btnMais = document.getElementById('ass-btn-mais-dias');
  const N_DIAS = ASS_DIAS_MOSTRADOS;
  const DIAS_PT = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const CAMPOS_DIA = ['turnoDom','turnoSeg','turnoTer','turnoQua','turnoQui','turnoSex','turnoSab'];

  // Calcular semanas necessárias
  const hoje = new Date();
  const fimPeriodo = new Date(hoje); fimPeriodo.setDate(hoje.getDate() + N_DIAS - 1);
  const segundaInicio = new Date(hoje);
  const dow = segundaInicio.getDay();
  segundaInicio.setDate(segundaInicio.getDate() - ((dow + 6) % 7));
  const segundas = [];
  let s = new Date(segundaInicio);
  while (s <= fimPeriodo) {
    segundas.push(s.getFullYear() + '-' + String(s.getMonth()+1).padStart(2,'0') + '-' + String(s.getDate()).padStart(2,'0'));
    s.setDate(s.getDate() + 7);
  }

  // Reutilizar os dados já carregados por assIniciar (evita repetir 3 pedidos ao backend
  // de cada vez que esta função corre — incluindo em cada clique de "Mais 7 dias").
  // Fallback: se por algum motivo ainda não houver cache, busca uma vez.
  let rAtrib, rHorTipo, rTurnos;
  if (ASS_ATRIB_CACHE && ASS_HORARIOS_CACHE && ASS_TURNOS_CACHE) {
    rAtrib   = {ok:true, atribuicoes: ASS_ATRIB_CACHE};
    rHorTipo = {ok:true, horarios: ASS_HORARIOS_CACHE};
    rTurnos  = {ok:true, turnos: ASS_TURNOS_CACHE};
  } else {
    const segundaInicioStr = segundaInicio.getFullYear()+'-'+String(segundaInicio.getMonth()+1).padStart(2,'0')+'-'+String(segundaInicio.getDate()).padStart(2,'0');
    [rAtrib, rHorTipo, rTurnos] = await Promise.all([
      assApi({acao:'listarAtribuicoesSemana', filtros:{username: SESSION.username, semanaDesde:segundaInicioStr}}),
      assApi({acao:'listarHorariosTipoSemanal'}),
      assApi({acao:'listarTurnosTipo'})
    ]);
    if (rAtrib.ok)   ASS_ATRIB_CACHE = rAtrib.atribuicoes;
    if (rHorTipo.ok) ASS_HORARIOS_CACHE = rHorTipo.horarios;
    if (rTurnos.ok)  ASS_TURNOS_CACHE = rTurnos.turnos;
  }

  if (!rAtrib.ok || !rHorTipo.ok || !rTurnos.ok) {
    container.innerHTML = '<div style="color:var(--danger);padding:1rem">Erro ao carregar. <a onclick="assIniciar()" style="cursor:pointer;text-decoration:underline">Tentar novamente</a></div>';
    return;
  }

  const horarios = rHorTipo.horarios || [];
  const turnos = rTurnos.turnos || [];

  // Construir mapa: semana -> {localId, horarioTipoId}
  const atribsPorSemana = {};
  for (const a of rAtrib.atribuicoes) {
    atribsPorSemana[String(a.semanaInicio).slice(0,10)] = a;
  }

  // Construir lista
  const linhas = [];
  for (let i = 0; i < N_DIAS; i++) {
    const dt = new Date(hoje); dt.setDate(hoje.getDate() + i);
    const diaStr = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    const dataDisp = String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0');
    const diaNome = DIAS_PT[dt.getDay()];
    const ehHoje = i === 0;

    // Encontrar segunda-feira desta semana
    const segDoDia = new Date(dt);
    const dowD = segDoDia.getDay();
    segDoDia.setDate(segDoDia.getDate() - ((dowD + 6) % 7));
    const semKey = segDoDia.getFullYear() + '-' + String(segDoDia.getMonth()+1).padStart(2,'0') + '-' + String(segDoDia.getDate()).padStart(2,'0');

    let conteudoTurno = '<span style="color:var(--text-muted);font-style:italic;font-size:.78rem">Sem atribuição</span>';
    let lojaName = '—';

    const atrib = atribsPorSemana[semKey];
    if (atrib) {
      const loc = LOCAIS_CACHE.find(l => l.id === atrib.localId);
      lojaName = loc?.nome || atrib.localId;
      const horario = horarios.find(h => h.id === atrib.horarioTipoId);
      if (horario) {
        const campoTurno = CAMPOS_DIA[dt.getDay()];
        const turnoId = horario[campoTurno];
        if (turnoId) {
          const t = turnos.find(x => x.id === turnoId);
          if (t) {
            const pausas = [t.pausa1Label, t.pausa2Label, t.pausa3Label].filter(Boolean);
            const pausasInfo = [];
            for (let n = 1; n <= 3; n++) {
              if (t['pausa'+n+'InicioMin'] !== '' && t['pausa'+n+'FimMin'] !== '') {
                pausasInfo.push(minParaHora(t['pausa'+n+'InicioMin'])+'–'+minParaHora(t['pausa'+n+'FimMin']));
              }
            }
            conteudoTurno = '<span style="background:var(--teal-pale);color:var(--teal);border-radius:5px;padding:2px 8px;font-weight:600;font-size:.78rem">'+esc(t.nome)+': '+minParaHora(t.inicioMin)+'–'+minParaHora(t.fimMin)+'</span>'
              + (pausasInfo.length ? '<span style="color:var(--text-muted);font-size:.7rem;margin-left:.5rem">⏸ '+pausasInfo.join(', ')+'</span>' : '');
          }
        } else {
          conteudoTurno = '<span style="color:var(--text-muted);font-style:italic;font-size:.78rem">Folga</span>';
        }
      }
    }

    const corDia = (dt.getDay()===0||dt.getDay()===6) ? '#64748b' : 'var(--text)';
    const fundo = ehHoje ? 'background:var(--teal-pale)' : 'background:var(--off-white)';
    linhas.push('<div style="display:grid;grid-template-columns:120px 1fr 2fr;gap:.6rem;padding:.5rem .7rem;border-radius:8px;'+fundo+';margin-bottom:.35rem;align-items:center">'
      + '<div><div style="font-size:.78rem;font-weight:700;color:'+corDia+'">'+diaNome+(ehHoje?' (hoje)':'')+'</div><div style="font-size:.68rem;color:var(--text-muted)">'+dataDisp+'</div></div>'
      + '<div style="font-size:.75rem;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+lojaName+'</div>'
      + '<div style="overflow:hidden">'+conteudoTurno+'</div>'
      + '</div>');
  }
  container.innerHTML = linhas.join('');
  btnMais.style.display = 'inline-block';
}

function assCarregarMaisDias() {
  ASS_DIAS_MOSTRADOS += 7;
  assCarregarProximosDias();
}

function assMostrarMeusRegistos() {
  const container = document.getElementById('ass-meus-registos');
  if (!container) return;
  const meus = ASS_COLEGAS_CACHE.filter(x => x.username === SESSION.username).sort((a,b) => b.data.localeCompare(a.data)).slice(0,10);
  document.getElementById('ass-meus-count').textContent = meus.length;
  if (!meus.length) { container.innerHTML = '<div style="color:var(--text-muted);padding:1rem">Sem registos.</div>'; return; }
  container.innerHTML = meus.map(reg => {
    const pausas = [];
    for (let i = 1; i <= 3; i++) {
      const ini = reg['pausa'+i+'InicioMin'], fim = reg['pausa'+i+'FimMin'];
      if (ini !== '' && ini !== undefined && ini !== null) {
        const temFim = fim !== '' && fim !== undefined && fim !== null;
        // Esconder pausas com duração zero (clique acidental)
        if (temFim && Number(fim) === Number(ini)) continue;
        const txt = temFim
          ? minParaHora(ini) + '–' + minParaHora(fim)
          : minParaHora(ini) + '–em curso';
        pausas.push(txt);
      }
    }
    const entrada = reg.entradaRealMin !== '' ? minParaHora(reg.entradaRealMin) : '—';
    const saida = reg.saidaRealMin !== '' ? minParaHora(reg.saidaRealMin) : '—';
    const total = reg.totalTrabalhadoMin ? assMinParaHoraH(reg.totalTrabalhadoMin) : '—';
    return '<div style="display:grid;grid-template-columns:90px 1fr;gap:.5rem;padding:.6rem .8rem;border-radius:8px;background:var(--off-white);margin-bottom:.4rem;font-size:.78rem">'
      + '<div style="font-weight:700;color:var(--text)">'+assFormatarData(reg.data)+'</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:.75rem;color:var(--text-muted)">'
      +   '<span>▶ <strong style="color:#00a878">'+entrada+'</strong></span>'
      +   (pausas.length ? '<span>⏸ <strong style="color:#f59e0b">'+pausas.join(' · ')+'</strong></span>' : '')
      +   '<span>⏹ <strong style="color:#E8000D">'+saida+'</strong></span>'
      +   '<span>⏱ <strong style="color:var(--text)">'+total+'</strong></span>'
      + '</div>'
      + '</div>';
  }).join('');
}

function assActivar() { if (SESSION) return assIniciar(); }

// ═══════════════════════════════════════
//  GESTÃO — TABS
// ═══════════════════════════════════════
let LOCAIS_CACHE = [];
let COLABORADORES_CACHE = [];
let ATRIBUICOES_CACHE = []; // última lista devolvida por carregarAtribuicoes (ver editarAtribuicao)
let FERIAS_CACHE = [];
let MINHAS_FERIAS_CACHE = [];
let TURNOS_CACHE = [];
let HORARIOS_TIPO_CACHE = [];
let MAPA_CACHE = null;
let APROVACOES_CACHE = [];
let DECISAO_ATUAL = null;

// Acordeão — abre/fecha secções da aba Horários
function toggleSeccao(id, header) {
  const sec=document.getElementById(id);
  if (!sec) return;
  const fechado=sec.style.display==='none';
  sec.style.display=fechado?'':'none';
  const seta=header.querySelector('.acc-seta');
  if (seta) seta.style.transform=fechado?'rotate(90deg)':'';
}

function showGestaoTab(id, btn) {
  document.querySelectorAll('.gestao-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.gestao-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('gpanel-'+id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id==='turnos') carregarTurnos();
  if (id==='balizas') carregarBalizas();
  if (id==='horarios') {
    const carregarHor=()=>{ popularSelectLocal('hor-local'); popularSelectLocal('at-local'); carregarHorariosTipo(); popularFiltrosAtribuicoes(); popularFiltrosExcecoes(); };
    if (!LOCAIS_CACHE.length) carregarLocaisCache().then(carregarHor);
    else carregarHor();
    const hor=document.getElementById('hor-semana');
    if (hor&&!hor.value) hor.value=segundaFeira(new Date());
    const horMes=document.getElementById('hor-mes');
    if (horMes&&!horMes.value) { const h=new Date(); horMes.value=h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0'); }
  }
  // 2026-09-10: deixaram de carregar automaticamente ao abrir a aba (pedido
  // do Ricardo, mesmo padrão já aplicado a Atribuições/Exceções) — só
  // preenchem os dropdowns/o ano por omissão; os dados só vêm depois de
  // clicar em "Procurar"/"Actualizar".
  if (id==='ferias') {
    popularSelectLocal('fer-local'); popularColaboradoresSelect('fer-colaborador');
    const anoInp=document.getElementById('fer-filtro-ano');
    if (anoInp && !anoInp.value) anoInp.value = new Date().getFullYear();
  }
  if (id==='mapaferias') {
    const anoInp=document.getElementById('mapaferias-ano');
    if (anoInp && !anoInp.value) anoInp.value = new Date().getFullYear();
  }
  if (id==='aprovacoes') carregarAprovacoes();
  if (id==='mapa') {
    popularSelectLocal('mapa-local');
    const optTodos = document.querySelector('#mapa-local option[value=""]');
    if (optTodos) optTodos.textContent = 'Todos os locais';
  }
  if (id==='editorregistos') { popularColaboradoresSelect('editor-colaborador'); if (!LOCAIS_CACHE.length) carregarLocaisCache(); }
}
window.showGestaoTab = showGestaoTab;

// ═══════════════════════════════════════
//  OCUPAÇÃO DIÁRIA — vista de topo, visível a todos os colaboradores
// ═══════════════════════════════════════
function initOcupacaoDiaria() {
  const od=document.getElementById('ocup-data');
  if (od && !od.value) { const d=new Date(); od.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  carregarOcupacaoDiaria();
}
window.initOcupacaoDiaria = initOcupacaoDiaria;

// ═══════════════════════════════════════
//  OCUPAÇÃO DIÁRIA — todas as lojas, registos reais
// ═══════════════════════════════════════
async function carregarOcupacaoDiaria() {
  const data=document.getElementById('ocup-data').value;
  const cont=document.getElementById('ocupacao-conteudo');
  if(!data){ cont.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted);grid-column:1/-1">Selecione uma data.</div>'; return; }
  const r=await assApi({acao:'ocupacaoDiaria',data});
  if(!r.ok){ cont.innerHTML=`<div style="text-align:center;padding:2rem;color:var(--danger);grid-column:1/-1">${r.erro||'Erro ao carregar.'}</div>`; return; }
  if(!r.locais||!r.locais.length){ cont.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted);grid-column:1/-1">Sem locais activos.</div>'; return; }

  const pausaAbertaDesde = p => {
    if(p.pausa1InicioMin!=null && p.pausa1FimMin==null) return p.pausa1InicioMin;
    if(p.pausa2InicioMin!=null && p.pausa2FimMin==null) return p.pausa2InicioMin;
    if(p.pausa3InicioMin!=null && p.pausa3FimMin==null) return p.pausa3InicioMin;
    return null;
  };

  cont.innerHTML=r.locais.map(l=>{
    const semSaida = l.presentes.filter(p=>p.saidaRealMin==null);
    const emPausa  = semSaida.filter(p=>pausaAbertaDesde(p)!=null);
    const agora    = semSaida.filter(p=>pausaAbertaDesde(p)==null);
    const saidos   = l.presentes.filter(p=>p.saidaRealMin!=null);

    const linha = (nome,cor,texto) => `<div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.82rem;border-bottom:1px solid var(--gray-light)">
      <span>${esc(nome)}</span><span style="color:${cor};font-weight:600">${esc(texto)}</span>
    </div>`;

    const agoraHtml  = agora.map(p=>linha(p.nome,'var(--success)',`${minParaHora(p.entradaRealMin)} → em curso`)).join('');
    const pausaHtml   = emPausa.map(p=>linha(p.nome,'var(--warning)',`em pausa desde ${minParaHora(pausaAbertaDesde(p))}`)).join('');
    const saidosHtml  = saidos.map(p=>linha(p.nome,'var(--text-muted)',`${minParaHora(p.entradaRealMin)} → ${minParaHora(p.saidaRealMin)}`)).join('');
    const ausentesHtml = l.ausentes.map(a=>linha(a.nome,'var(--danger)',`previsto ${minParaHora(a.inicioPrevMin)}`)).join('');

    const badgeParts=[];
    if(agora.length) badgeParts.push(`${agora.length} presente(s) agora`);
    if(emPausa.length) badgeParts.push(`${emPausa.length} em pausa`);
    if(saidos.length) badgeParts.push(`${saidos.length} já saiu/saíram`);
    if(l.ausentes.length) badgeParts.push(`${l.ausentes.length} ausente(s)`);
    const badge = badgeParts.length ? badgeParts.join(' · ') : 'Sem movimento';

    const secao = (titulo,cor,html) => html
      ? `<div style="margin-top:.6rem;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${cor}">${titulo}</div>${html}`
      : '';

    const semNada = !agora.length && !emPausa.length && !saidos.length && !l.ausentes.length;

    return `<div class="panel">
      <div class="panel-header"><div class="panel-title"><div class="dot"></div>${esc(l.localNome)}</div><span class="panel-badge">${esc(badge)}</span></div>
      ${semNada ? '<div style="font-size:.78rem;color:var(--text-muted);padding:.3rem 0">Sem presenças registadas.</div>' : ''}
      ${secao('Presentes agora','var(--success)',agoraHtml)}
      ${secao('Em pausa','var(--warning)',pausaHtml)}
      ${secao('Já saíram hoje','var(--text-muted)',saidosHtml)}
      ${secao('Ausentes (escalados, sem registo)','var(--danger)',ausentesHtml)}
    </div>`;
  }).join('');
}
window.carregarOcupacaoDiaria = carregarOcupacaoDiaria;

async function gestaoActivar() {
  await Promise.all([carregarLocaisCache(),carregarColaboradoresCache()]);
  // Um único pedido em vez de 3 em paralelo (IPs + Utilizadores + badge de
  // aprovações) — cada pedido conta contra a mesma quota partilhada de
  // execuções simultâneas do Apps Script (ver 12º seguimento, 2026-09-10),
  // por isso abrir "Gestão" deixa de "gastar" 3 lugares de uma vez.
  const dadosIniciais = await api({acao:'gestaoDadosIniciais',ip:SESSION.ip,username:SESSION.username,password:SESSION.password});
  if (dadosIniciais.ok) {
    renderIPs(dadosIniciais.ips);
    renderUtilizadores(dadosIniciais.utilizadores);
    renderAprovacoesBadge(dadosIniciais.aprovacoesPendentes);
  }
  const hor=document.getElementById('hor-semana'); if (hor) hor.value=segundaFeira(new Date());
  const mes=document.getElementById('mapa-mes'); if (mes) { const h=new Date(); mes.value=h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0'); }
  const tabEditor = document.getElementById('tab-editorregistos');
  if (tabEditor) tabEditor.style.display = (SESSION.role === 'master') ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// EDITOR DE REGISTOS (só master)
// ═══════════════════════════════════════════════════════════════════════════
let EDITOR_REGISTOS_CACHE = [];

async function buscarRegistosEditor() {
  const err = document.getElementById('editor-err');
  err.style.display = 'none';
  const username = document.getElementById('editor-colaborador').value;
  if (!username) { showAlert(err, 'Escolhe um colaborador.'); return; }
  const data = document.getElementById('editor-data').value; // opcional
  const filtros = { username };
  if (data) filtros.data = data;

  const r = await assApi({ acao: 'listarRegistosEditor', filtros });
  if (!r.ok) { showAlert(err, r.erro); return; }
  EDITOR_REGISTOS_CACHE = r.registos;
  renderEditorRegistos();
}

function renderEditorRegistos() {
  const container = document.getElementById('editor-lista');
  if (!EDITOR_REGISTOS_CACHE.length) {
    container.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem registos para este colaborador (e filtro de data, se indicado).</div>';
    return;
  }
  container.innerHTML = `<table class="tbl"><thead><tr>
    <th>Data</th><th>Local</th><th>Entrada</th><th>Saída</th><th>Pausa 1</th><th>Pausa 2</th><th>Estado</th><th>Total</th><th></th>
  </tr></thead><tbody>${EDITOR_REGISTOS_CACHE.map(r => {
    const p1 = (r.pausa1InicioMin!=='' ) ? `${minParaHora(r.pausa1InicioMin)}–${r.pausa1FimMin!==''?minParaHora(r.pausa1FimMin):'…'}` : '—';
    const p2 = (r.pausa2InicioMin!=='' ) ? `${minParaHora(r.pausa2InicioMin)}–${r.pausa2FimMin!==''?minParaHora(r.pausa2FimMin):'…'}` : '—';
    const badgeManual = r.criadoManualmente ? ' <span style="font-size:.68rem;color:#d97706;font-weight:700" title="Criado manualmente por correcção">🖊 manual</span>' : '';
    const nomeLocal = (LOCAIS_CACHE.find(l => l.id === r.localId) || {}).nome || r.localId || '—';
    return `<tr>
      <td style="font-weight:600">${assFormatarData(r.data)}${badgeManual}</td>
      <td style="font-size:.78rem">${esc(nomeLocal)}</td>
      <td>${r.entradaRealMin!==''?minParaHora(r.entradaRealMin):'—'}</td>
      <td>${r.saidaRealMin!==''?minParaHora(r.saidaRealMin):'—'}</td>
      <td style="font-size:.75rem;color:var(--text-muted)">${p1}</td>
      <td style="font-size:.75rem;color:var(--text-muted)">${p2}</td>
      <td style="font-size:.78rem">${esc(r.estado)||'—'}</td>
      <td>${r.totalTrabalhadoMin?minParaHoraH(r.totalTrabalhadoMin):'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm teal" onclick="abrirEditarRegisto('${r.id}')">ed Editar</button>
        <button class="btn-sm danger" onclick="apagarRegistoEditor('${r.id}','${assFormatarData(r.data)}')">x</button>
        <button class="btn-sm" onclick="abrirHistoricoRegisto('${r.id}')" title="Ver histórico de alterações">🕘</button>
      </td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

function abrirEditarRegisto(id) {
  const r = EDITOR_REGISTOS_CACHE.find(x => x.id === id);
  if (!r) return;
  document.getElementById('editor-registo-id').value = id;
  document.getElementById('editor-registo-info').textContent = `${assFormatarData(r.data)} — ${r.username || ''}`;
  // Local (2026-09-12, pedido do Ricardo): permite corrigir a loja onde o
  // registo ficou associado, além dos horários já editáveis.
  const definirLocal = () => { popularSelectLocal('editor-registo-local'); document.getElementById('editor-registo-local').value = r.localId || ''; };
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(definirLocal); else definirLocal();
  document.getElementById('editor-entrada').value = r.entradaRealMin!==''?minParaHoraInput(r.entradaRealMin):'';
  document.getElementById('editor-saida').value = r.saidaRealMin!==''?minParaHoraInput(r.saidaRealMin):'';
  document.getElementById('editor-p1-inicio').value = r.pausa1InicioMin!==''?minParaHoraInput(r.pausa1InicioMin):'';
  document.getElementById('editor-p1-fim').value = r.pausa1FimMin!==''?minParaHoraInput(r.pausa1FimMin):'';
  document.getElementById('editor-p2-inicio').value = r.pausa2InicioMin!==''?minParaHoraInput(r.pausa2InicioMin):'';
  document.getElementById('editor-p2-fim').value = r.pausa2FimMin!==''?minParaHoraInput(r.pausa2FimMin):'';
  document.getElementById('editor-motivo').value = '';
  document.getElementById('editor-registo-err').style.display = 'none';
  document.getElementById('modal-editar-registo').classList.add('open');
}

async function guardarRegistoEditado() {
  const err = document.getElementById('editor-registo-err');
  err.style.display = 'none';
  const id = document.getElementById('editor-registo-id').value;
  const motivo = document.getElementById('editor-motivo').value;
  if (!motivo || !motivo.trim()) { showAlert(err, 'Motivo obrigatório.'); return; }
  const local = document.getElementById('editor-registo-local').value;
  if (!local) { showAlert(err, 'Escolhe o local do registo.'); return; }
  const patch = {
    localId: local,
    entradaRealMin: document.getElementById('editor-entrada').value ? horaParaMin(document.getElementById('editor-entrada').value) : '',
    saidaRealMin: document.getElementById('editor-saida').value ? horaParaMin(document.getElementById('editor-saida').value) : '',
    pausa1InicioMin: document.getElementById('editor-p1-inicio').value ? horaParaMin(document.getElementById('editor-p1-inicio').value) : '',
    pausa1FimMin: document.getElementById('editor-p1-fim').value ? horaParaMin(document.getElementById('editor-p1-fim').value) : '',
    pausa2InicioMin: document.getElementById('editor-p2-inicio').value ? horaParaMin(document.getElementById('editor-p2-inicio').value) : '',
    pausa2FimMin: document.getElementById('editor-p2-fim').value ? horaParaMin(document.getElementById('editor-p2-fim').value) : ''
  };
  const r = await assApi({ acao: 'editarRegistoManual', id, patch, motivo });
  if (!r.ok) { showAlert(err, r.erro); return; }
  closeModal('modal-editar-registo');
  buscarRegistosEditor();
}

async function apagarRegistoEditor(id, dataLabel) {
  const motivo = prompt(`Motivo para apagar definitivamente o registo de ${dataLabel} (obrigatório):`);
  if (!motivo || !motivo.trim()) return;
  const r = await assApi({ acao: 'apagarRegistoManual', id, motivo });
  if (!r.ok) { alert(r.erro || 'Erro ao apagar.'); return; }
  buscarRegistosEditor();
}

// Criar registo manual — colaborador esqueceu-se de bater o ponto.
function abrirCriarRegisto() {
  if (!COLABORADORES_CACHE.length) carregarColaboradoresCache().then(()=>popularColaboradoresSelect('criar-colaborador')); else popularColaboradoresSelect('criar-colaborador');
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(()=>popularSelectLocal('criar-local')); else popularSelectLocal('criar-local');
  ['criar-data','criar-entrada','criar-saida','criar-p1-inicio','criar-p1-fim','criar-p2-inicio','criar-p2-fim','criar-motivo'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('criar-registo-err').style.display = 'none';
  document.getElementById('modal-criar-registo').classList.add('open');
}

async function guardarRegistoCriado() {
  const err = document.getElementById('criar-registo-err');
  err.style.display = 'none';
  const motivo = document.getElementById('criar-motivo').value;
  const dados = {
    username: document.getElementById('criar-colaborador').value,
    localId: document.getElementById('criar-local').value,
    data: document.getElementById('criar-data').value,
    entradaRealMin: document.getElementById('criar-entrada').value ? horaParaMin(document.getElementById('criar-entrada').value) : '',
    saidaRealMin: document.getElementById('criar-saida').value ? horaParaMin(document.getElementById('criar-saida').value) : '',
    pausa1InicioMin: document.getElementById('criar-p1-inicio').value ? horaParaMin(document.getElementById('criar-p1-inicio').value) : '',
    pausa1FimMin: document.getElementById('criar-p1-fim').value ? horaParaMin(document.getElementById('criar-p1-fim').value) : '',
    pausa2InicioMin: document.getElementById('criar-p2-inicio').value ? horaParaMin(document.getElementById('criar-p2-inicio').value) : '',
    pausa2FimMin: document.getElementById('criar-p2-fim').value ? horaParaMin(document.getElementById('criar-p2-fim').value) : '',
    motivo
  };
  if (!dados.username || !dados.localId || !dados.data) { showAlert(err, 'Preencha colaborador, local e data.'); return; }
  if (dados.entradaRealMin === '') { showAlert(err, 'Indique pelo menos a hora de entrada.'); return; }
  if (!motivo || !motivo.trim()) { showAlert(err, 'Motivo obrigatório.'); return; }
  const r = await assApi({ acao: 'criarRegistoManual', dados });
  if (!r.ok) { showAlert(err, r.erro); return; }
  closeModal('modal-criar-registo');
  buscarRegistosEditor();
}

// Histórico de alterações a um registo (auditoria de correcções manuais).
async function abrirHistoricoRegisto(id) {
  const r = await assApi({ acao: 'historicoRegisto', registoId: id });
  const container = document.getElementById('historico-registo-conteudo');
  if (!r.ok) { container.innerHTML = `<div style="color:var(--danger)">${r.erro}</div>`; document.getElementById('modal-historico-registo').classList.add('open'); return; }
  if (!r.historico.length) {
    container.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-muted)">Sem alterações manuais registadas para este registo.</div>';
  } else {
    const tipoLabel = { criacao_manual: '➕ Criado manualmente', edicao_manual: '✎ Editado', eliminacao_manual: '🗑 Apagado' };
    container.innerHTML = r.historico.map(h => `
      <div style="border-bottom:1px solid var(--border);padding:.6rem 0">
        <div style="font-weight:600">${esc(tipoLabel[h.tipo]||h.tipo)} — ${esc(h.alteradoEm)}</div>
        <div style="color:var(--text-muted)">por ${esc(h.alteradoPor)}</div>
        <div style="margin-top:.3rem"><b>Motivo:</b> ${esc(h.motivo)||'—'}</div>
      </div>`).join('');
  }
  // Eventos do registo móvel (foto+GPS) deste registo, se algum evento tiver
  // sido feito por telemóvel (entrada/saída/pausa) — pedido de Ricardo,
  // 2026-09-09, para poder ver no mapa onde cada evento foi feito.
  const eventosMovel = r.eventosMovel || [];
  const tipoEventoLabel = { entrada: '▶ Entrada', saida: '⏹ Saída', pausa1_inicio: '☕ Pausa 1 (início)', pausa1_fim: '▶ Pausa 1 (retorno)', pausa2_inicio: '☕ Pausa 2 (início)', pausa2_fim: '▶ Pausa 2 (retorno)', pausa3_inicio: '☕ Pausa 3 (início)', pausa3_fim: '▶ Pausa 3 (retorno)' };
  const blocoMovel = document.getElementById('historico-registo-movel');
  if (blocoMovel) {
    if (!eventosMovel.length) {
      blocoMovel.innerHTML = '';
    } else {
      blocoMovel.innerHTML = `<div style="font-weight:600;margin:.8rem 0 .4rem">📱 Registo móvel (foto + localização)</div>` + eventosMovel.map(e => {
        const balizaNome = esc(e.balizaNome), fotoUrl = esc(e.fotoUrl);
        return `
        <div style="border-bottom:1px solid var(--border);padding:.6rem 0">
          <div style="font-weight:600">${esc(tipoEventoLabel[e.tipoEvento]||e.tipoEvento)} — ${esc(e.criadoEm)}</div>
          <div style="color:${e.dentroBaliza==='TRUE'?'var(--success)':'#d97706'}">${e.dentroBaliza==='TRUE'?`✓ Dentro da baliza${balizaNome?' ('+balizaNome+')':''}`:`⚠ Fora das zonas habituais${balizaNome?' — mais próxima: '+balizaNome:''}${e.distanciaMetros!==''?' ('+esc(e.distanciaMetros)+'m)':''}`}</div>
          <div style="margin-top:.3rem;display:flex;gap:.75rem;font-size:.85rem">
            ${(e.lat!==''&&e.lng!=='')?`<a href="https://www.google.com/maps?q=${encodeURIComponent(e.lat)},${encodeURIComponent(e.lng)}" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600">📍 Ver no mapa</a>`:''}
            ${e.fotoUrl?`<a href="${fotoUrl}" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600">📷 Ver foto</a>`:''}
          </div>
        </div>`;}).join('');
    }
  }
  document.getElementById('modal-historico-registo').classList.add('open');
}

async function carregarLocaisCache() {
  const r=await assApi({acao:'listarLocais'}); if (r.ok) LOCAIS_CACHE=r.locais;
  popularTodosSelects();
}

async function carregarColaboradoresCache() {
  const r=await assApi({acao:'listarColaboradores'}); if (r.ok) COLABORADORES_CACHE=r.colaboradores;
}

function popularSelectLocal(id) {
  const s=document.getElementById(id); if (!s) return;
  s.innerHTML='<option value="">Selecionar local…</option>';
  LOCAIS_CACHE.forEach(l=>s.innerHTML+=`<option value="${l.id}">${esc(l.nome)}</option>`);
}

// 2026-09-12 (2ª ronda de auditoria): a lista de ids estava hardcoded aqui
// — já tinha divergido do HTML sem ninguém notar ('hor-local-mes' já não
// existe em equipa-redemovel-v3.html; passava sempre em branco por
// popularSelectLocal ter um "if (!s) return"). Passa a descobrir os selects
// pelo atributo data-local-select no próprio HTML — acrescentar um select
// novo de "local" deixa de exigir lembrar de o adicionar aqui também.
function popularTodosSelects() {
  document.querySelectorAll('[data-local-select]').forEach(s => popularSelectLocal(s.id));
}

function popularColaboradoresSelect(id) {
  const s=document.getElementById(id); if (!s) return;
  s.innerHTML='<option value="">Selecionar…</option>';
  COLABORADORES_CACHE.forEach(c=>s.innerHTML+=`<option value="${c.username}">${esc(c.nome)}</option>`);
}

// ═══════════════════════════════════════
//  TURNOS TIPO
// ═══════════════════════════════════════
async function carregarTurnos() {
  const r=await assApi({acao:'listarTurnosTipo'}); if (!r.ok) return;
  TURNOS_CACHE=r.turnos;
  const lista=document.getElementById('lista-turnos');
  if (!r.turnos.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem turnos criados.</div>'; return; }
  lista.innerHTML=`<table class="tbl"><thead><tr><th>Nome</th><th>Local</th><th>Início</th><th>Fim</th><th>Pausas</th><th></th></tr></thead><tbody>${r.turnos.map(t=>{const loc=LOCAIS_CACHE.find(l=>l.id===t.localId);const pausas=[t.pausa1Label,t.pausa2Label,t.pausa3Label].filter(Boolean).join(', ')||'—';return `<tr><td style="font-weight:700">${esc(t.nome)}</td><td>${esc(loc?.nome)||'—'}</td><td style="color:var(--teal);font-weight:600">${minParaHora(t.inicioMin)}</td><td style="color:var(--teal);font-weight:600">${minParaHora(t.fimMin)}</td><td style="font-size:.78rem;color:var(--text-muted)">${esc(pausas)}</td><td><button class="btn-sm teal" onclick="editarTurno('${t.id}')">✎</button> <button class="btn-sm danger" onclick="apagarTurno('${t.id}')">✕</button></td></tr>`;}).join('')}</tbody></table>`;
}

function abrirModalTurno() {
  document.getElementById('modal-turno-titulo').textContent='Novo Turno Tipo';
  document.getElementById('turno-id').value='';
  ['turno-nome','turno-inicio','turno-fim','p1-label','p1-inicio','p1-fim','p2-label','p2-inicio','p2-fim','p3-label','p3-inicio','p3-fim'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('turno-err').style.display='none';
  const abrir=()=>{popularTodosSelects();document.getElementById('modal-turno').classList.add('open');};
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(abrir); else abrir();
}

function editarTurno(id) {
  const t=TURNOS_CACHE.find(x=>x.id===id); if (!t) return;
  document.getElementById('modal-turno-titulo').textContent='Editar Turno Tipo';
  document.getElementById('turno-id').value=id;
  document.getElementById('turno-nome').value=t.nome;
  document.getElementById('turno-local-sel').value=t.localId;
  document.getElementById('turno-inicio').value=minParaHoraInput(t.inicioMin);
  document.getElementById('turno-fim').value=minParaHoraInput(t.fimMin);
  ['1','2','3'].forEach(n=>{
    document.getElementById(`p${n}-label`).value=t[`pausa${n}Label`]||'';
    document.getElementById(`p${n}-inicio`).value=t[`pausa${n}InicioMin`]!==''?minParaHoraInput(t[`pausa${n}InicioMin`]):'';
    document.getElementById(`p${n}-fim`).value=t[`pausa${n}FimMin`]!==''?minParaHoraInput(t[`pausa${n}FimMin`]):'';
  });
  popularTodosSelects();
  document.getElementById('modal-turno').classList.add('open');
}

async function guardarTurno() {
  const err=document.getElementById('turno-err'); err.style.display='none';
  const id=document.getElementById('turno-id').value;
  const turno={nome:document.getElementById('turno-nome').value.trim(),localId:document.getElementById('turno-local-sel').value,inicioMin:horaParaMin(document.getElementById('turno-inicio').value),fimMin:horaParaMin(document.getElementById('turno-fim').value),pausa1Label:document.getElementById('p1-label').value,pausa1InicioMin:document.getElementById('p1-inicio').value?horaParaMin(document.getElementById('p1-inicio').value):'',pausa1FimMin:document.getElementById('p1-fim').value?horaParaMin(document.getElementById('p1-fim').value):'',pausa2Label:document.getElementById('p2-label').value,pausa2InicioMin:document.getElementById('p2-inicio').value?horaParaMin(document.getElementById('p2-inicio').value):'',pausa2FimMin:document.getElementById('p2-fim').value?horaParaMin(document.getElementById('p2-fim').value):'',pausa3Label:document.getElementById('p3-label').value,pausa3InicioMin:document.getElementById('p3-inicio').value?horaParaMin(document.getElementById('p3-inicio').value):'',pausa3FimMin:document.getElementById('p3-fim').value?horaParaMin(document.getElementById('p3-fim').value):''};
  if (!turno.nome||!turno.localId||turno.inicioMin===''||turno.fimMin==='') { err.textContent='Preencha nome, local, início e fim.'; err.style.display='block'; return; }
  const r=id?await assApi({acao:'editarTurnoTipo',id,turno}):await assApi({acao:'criarTurnoTipo',turno});
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  closeModal('modal-turno'); carregarTurnos();
}

async function apagarTurno(id) {
  if (!confirm('Desativar este turno tipo?')) return;
  await assApi({acao:'apagarTurnoTipo',id}); carregarTurnos();
}

// ═══════════════════════════════════════════════════════════════════════════
//  BALIZAS DE LOCALIZAÇÃO (registo por telemóvel — comerciais/AVAC) — 2026-09-09
// ═══════════════════════════════════════════════════════════════════════════
let BALIZAS_CACHE = [];

async function carregarBalizas() {
  const r = await assApi({acao:'listarBalizas'}); if (!r.ok) return;
  BALIZAS_CACHE = r.balizas;
  const lista = document.getElementById('lista-balizas');
  if (!r.balizas.length) { lista.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem balizas criadas — o registo por telemóvel fica sempre pendente de aprovação até criares pelo menos uma.</div>'; return; }
  lista.innerHTML = `<table class="tbl"><thead><tr><th>Nome</th><th>Latitude</th><th>Longitude</th><th>Raio</th><th></th></tr></thead><tbody>${r.balizas.map(b=>`<tr><td style="font-weight:700">${esc(b.nome)}</td><td style="font-family:monospace">${esc(b.lat)}</td><td style="font-family:monospace">${esc(b.lng)}</td><td>${esc(b.raioMetros)} m</td><td><button class="btn-sm teal" onclick="editarBaliza('${b.id}')">✎</button> <button class="btn-sm danger" onclick="apagarBaliza('${b.id}')">✕</button></td></tr>`).join('')}</tbody></table>`;
}

function abrirModalBaliza() {
  document.getElementById('modal-baliza-titulo').textContent = 'Nova Baliza';
  document.getElementById('baliza-id').value = '';
  ['baliza-nome','baliza-lat','baliza-lng'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('baliza-raio').value = 150;
  document.getElementById('baliza-err').style.display = 'none';
  document.getElementById('modal-baliza').classList.add('open');
}

function editarBaliza(id) {
  const b = BALIZAS_CACHE.find(x=>x.id===id); if (!b) return;
  document.getElementById('modal-baliza-titulo').textContent = 'Editar Baliza';
  document.getElementById('baliza-id').value = id;
  document.getElementById('baliza-nome').value = b.nome;
  document.getElementById('baliza-lat').value = b.lat;
  document.getElementById('baliza-lng').value = b.lng;
  document.getElementById('baliza-raio').value = b.raioMetros;
  document.getElementById('baliza-err').style.display = 'none';
  document.getElementById('modal-baliza').classList.add('open');
}

async function guardarBaliza() {
  const err = document.getElementById('baliza-err'); err.style.display = 'none';
  const id = document.getElementById('baliza-id').value;
  const lat = parseFloat(document.getElementById('baliza-lat').value);
  const lng = parseFloat(document.getElementById('baliza-lng').value);
  const raioMetros = parseInt(document.getElementById('baliza-raio').value, 10) || 150;
  const nome = document.getElementById('baliza-nome').value.trim();
  if (!nome || !isFinite(lat) || !isFinite(lng)) { err.textContent = 'Preenche nome, latitude e longitude.'; err.style.display = 'block'; return; }
  const baliza = {nome, lat, lng, raioMetros};
  const r = id ? await assApi({acao:'editarBaliza',id,baliza}) : await assApi({acao:'criarBaliza',baliza});
  if (!r.ok) { err.textContent = r.erro; err.style.display = 'block'; return; }
  closeModal('modal-baliza'); carregarBalizas();
}

async function apagarBaliza(id) {
  if (!confirm('Desativar esta baliza?')) return;
  await assApi({acao:'apagarBaliza',id}); carregarBalizas();
}

// ═══════════════════════════════════════
//  HORÁRIOS TIPO SEMANAIS
// ═══════════════════════════════════════
async function carregarHorariosTipo() {
  if (!TURNOS_CACHE.length) await carregarTurnos();
  const localId=document.getElementById('hor-local').value;
  const r=await assApi({acao:'listarHorariosTipoSemanal',localId:localId||undefined}); if (!r.ok) return;
  HORARIOS_TIPO_CACHE=r.horarios;
  const lista=document.getElementById('lista-horarios-tipo');
  if (!r.horarios.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem horários tipo criados. Crie o primeiro.</div>'; return; }
  const DIAS=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'], CAMPOS=['turnoSeg','turnoTer','turnoQua','turnoQui','turnoSex','turnoSab','turnoDom'];
  lista.innerHTML=`<table class="tbl"><thead><tr><th>Nome</th><th>Seg</th><th>Ter</th><th>Qua</th><th>Qui</th><th>Sex</th><th>Sáb</th><th>Dom</th><th></th></tr></thead><tbody>${r.horarios.map(h=>{const celulas=CAMPOS.map(c=>{const t=TURNOS_CACHE.find(x=>x.id===h[c]);return `<td style="font-size:.75rem">${t?`<span style="background:var(--teal-pale);color:var(--teal);border-radius:5px;padding:2px 6px;font-weight:600">${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)}</span>`:'<span style="color:var(--gray-mid)">—</span>'}</td>`;}).join('');return `<tr><td style="font-weight:700">${esc(h.nome)}</td>${celulas}<td><button class="btn-sm teal" onclick="editarHorarioTipo('${h.id}')">✎</button> <button class="btn-sm danger" onclick="apagarHorarioTipo('${h.id}')">✕</button></td></tr>`;}).join('')}</tbody></table>`;
}

async function popularHorariosTipoSelect(selectId) {
  if (!HORARIOS_TIPO_CACHE.length) await carregarHorariosTipo();
  const s=document.getElementById(selectId); if (!s) return;
  s.innerHTML='<option value="">Selecionar horário tipo…</option>';
  HORARIOS_TIPO_CACHE.forEach(h=>s.innerHTML+=`<option value="${h.id}">${esc(h.nome)}</option>`);
}

function popularTurnosNosSelects(prefixo) {
  ['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].forEach(d=>{
    const s=document.getElementById(`${prefixo}turno${d}`); if (!s) return;
    s.innerHTML='<option value="">— Folga —</option>';
    TURNOS_CACHE.forEach(t=>s.innerHTML+=`<option value="${t.id}">${esc(t.nome)} (${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)})</option>`);
  });
}

function abrirModalHorarioTipo() {
  document.getElementById('modal-ht-titulo').textContent='Novo Horário Tipo Semanal';
  document.getElementById('ht-id').value=''; document.getElementById('ht-nome').value=''; document.getElementById('ht-err').style.display='none';
  popularSelectLocal('ht-local');
  if (!TURNOS_CACHE.length) carregarTurnos().then(()=>popularTurnosNosSelects('ht-'));
  else popularTurnosNosSelects('ht-');
  document.getElementById('modal-horario-tipo').classList.add('open');
}

function editarHorarioTipo(id) {
  const h=HORARIOS_TIPO_CACHE.find(x=>x.id===id); if (!h) return;
  document.getElementById('modal-ht-titulo').textContent='Editar Horário Tipo Semanal';
  document.getElementById('ht-id').value=id; document.getElementById('ht-nome').value=h.nome; document.getElementById('ht-err').style.display='none';
  popularSelectLocal('ht-local');
  const aplicar=()=>{ popularTurnosNosSelects('ht-'); ['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].forEach(d=>{const el=document.getElementById(`ht-turno${d}`);if(el)el.value=h[`turno${d}`]||'';}); document.getElementById('ht-local').value=h.localId; };
  if (!TURNOS_CACHE.length) carregarTurnos().then(aplicar); else aplicar();
  document.getElementById('modal-horario-tipo').classList.add('open');
}

async function guardarHorarioTipo() {
  const err=document.getElementById('ht-err'); err.style.display='none';
  const id=document.getElementById('ht-id').value;
  const horario={nome:document.getElementById('ht-nome').value.trim(),localId:document.getElementById('ht-local').value,turnoSeg:document.getElementById('ht-turnoSeg').value,turnoTer:document.getElementById('ht-turnoTer').value,turnoQua:document.getElementById('ht-turnoQua').value,turnoQui:document.getElementById('ht-turnoQui').value,turnoSex:document.getElementById('ht-turnoSex').value,turnoSab:document.getElementById('ht-turnoSab').value,turnoDom:document.getElementById('ht-turnoDom').value};
  if (!horario.nome||!horario.localId) { err.textContent='Preencha nome e local.'; err.style.display='block'; return; }
  const r=id?await assApi({acao:'editarHorarioTipoSemanal',id,horario}):await assApi({acao:'criarHorarioTipoSemanal',horario});
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  closeModal('modal-horario-tipo'); HORARIOS_TIPO_CACHE=[]; carregarHorariosTipo();
}

async function apagarHorarioTipo(id) {
  if (!confirm('Apagar este horário tipo?')) return;
  await assApi({acao:'apagarHorarioTipoSemanal',id}); HORARIOS_TIPO_CACHE=[]; carregarHorariosTipo();
}

// ═══════════════════════════════════════
//  GANTT — SEMANAL
// ═══════════════════════════════════════
async function carregarGantt() {
  const localId = document.getElementById('hor-local').value;
  const semana = document.getElementById('hor-semana').value;
  if (!localId || !semana) return;
  document.getElementById('gantt-semana-label').textContent = 'Semana de ' + assFormatarData(semana);
  const r = await assApi({ acao:'gantSemanal', localId, semanaInicio:semana });
  if (!r.ok) return;
  const container = document.getElementById('gantt-container');
  const DIAS_PT = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  const cols = [...new Map(r.semana.flatMap(d => d.colaboradores.map(c => [c.username,c])))].map(([,c]) => c);
  if (!cols.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">Sem colaboradores atribuídos nesta semana.</div>';
    return;
  }
  const totalColab = cols.length;

  function corCobertura(n) {
    if (n === 0) return 'transparent';
    const pct = (n / totalColab) * 100;
    if (pct > 80) return '#15803d';
    if (pct > 60) return '#84cc16';
    if (pct > 40) return '#eab308';
    if (pct > 20) return '#f97706';
    return '#ef4444';
  }

  const SLOT = 30;

  const blocosDias = r.semana.map(d => {
    const dt = new Date(d.dia + 'T12:00:00');
    const diaNome = DIAS_PT[dt.getDay()];
    const dataStr = String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear();
    const ehFeriado = d.eFeriado;
    const ehFimDeSemana = (dt.getDay() === 0 || dt.getDay() === 6);

    const horasDia = d.colaboradores.flatMap(c => c.turno ? [c.turno.inicioMin, c.turno.fimMin] : []);
    if (!horasDia.length) {
      const corHdr = ehFeriado ? '#7c3aed' : (ehFimDeSemana ? '#64748b' : 'var(--teal)');
      const labelDia = ehFeriado ? (diaNome + ' ' + dataStr + ' · 🎉 Feriado') : (diaNome + ' ' + dataStr);
      return '<div style="border-radius:10px;overflow:hidden;border:1px solid var(--gray-light);margin-bottom:1.25rem;background:var(--white)"><div style="background:' + corHdr + ';color:white;padding:.6rem 1rem;font-size:.85rem;font-weight:700">' + labelDia + '</div><div style="padding:1rem;text-align:center;color:var(--text-muted);font-size:.8rem">Sem turnos atribuídos</div></div>';
    }

    const horaMin = Math.floor(Math.min(...horasDia)/60);
    const horaMax = Math.ceil(Math.max(...horasDia)/60);
    const totalHoras = horaMax - horaMin;
    const slotsPerDay = (totalHoras*60) / SLOT;
    const passoStr = (100/slotsPerDay).toFixed(4);

    const grelhaStyle = 'background:repeating-linear-gradient(to right, transparent 0, transparent calc(' + passoStr + '% - 1px), rgba(0,0,0,.10) calc(' + passoStr + '% - 1px), rgba(0,0,0,.10) ' + passoStr + '%)';

    const escalaDia = Array.from({length: totalHoras+1}, (_,i) =>
      '<div style="flex:0 0 ' + (100/totalHoras) + '%;text-align:center;font-size:.7rem;color:var(--text-muted);font-weight:600">' + String(horaMin+i).padStart(2,'0') + 'h</div>'
    ).join('');

    const segmentos = [];
    for (let s = 0; s < slotsPerDay; s++) {
      const minutoAbs = horaMin*60 + s*SLOT;
      const ativos = d.colaboradores.filter(c => {
        if (c.emFerias || c.folga || !c.turno) return false;
        const t = c.turno;
        if (minutoAbs < t.inicioMin || minutoAbs >= t.fimMin) return false;
        const emPausa = (t.pausas||[]).some(p => minutoAbs >= p.inicio && minutoAbs < p.fim);
        return !emPausa;
      }).length;
      const cor = corCobertura(ativos);
      const horaSlot = String(Math.floor(minutoAbs/60)).padStart(2,'0') + ':' + String(minutoAbs%60).padStart(2,'0');
      segmentos.push('<div style="flex:1;height:100%;background:' + cor + '" title="' + horaSlot + ' — ' + ativos + '/' + totalColab + ' colaborador(es)"></div>');
    }

const linhasColab = cols.map(col => {
      const info = d.colaboradores.find(c => c.username === col.username);
      let conteudo;
      if (info && info.emFerias) {
        const ausLbl={ferias:'🏖 Férias',baixa_medica:'🏥 Baixa médica',licenca:'📄 Licença',outro:'❓ Ausência'}[info.tipoAusencia]||'🏖 Férias';
        conteudo = '<div style="height:24px;display:flex;align-items:center;justify-content:flex-start;padding-left:.5rem"><span style="font-size:.7rem;background:#e0f2ff;color:#0369a1;border-radius:4px;padding:2px 8px">'+ausLbl+'</span></div>';
      } else if (!info || info.folga || !info.turno) {
        conteudo = '<div style="height:24px;display:flex;align-items:center;padding-left:.5rem;color:var(--text-muted);font-size:.7rem;font-style:italic">Folga</div>';
      } else {
        const t = info.turno;
        const pctInicio = ((t.inicioMin/60 - horaMin)/totalHoras)*100;
        const largura = ((t.fimMin - t.inicioMin)/60/totalHoras)*100;
        const cor = info.especial ? '#f59e0b' : 'var(--teal)';
        const pausas = (t.pausas||[]).map(p => {
          const duracaoTurno = t.fimMin - t.inicioMin;
          const pPI = ((p.inicio - t.inicioMin) / duracaoTurno) * 100;
          const pL = ((p.fim - p.inicio) / duracaoTurno) * 100;
          return '<div style="position:absolute;left:' + pPI + '%;width:' + pL + '%;height:100%;background:rgba(255,255,255,.45);border-radius:2px" title="Pausa: ' + p.label + '"></div>';
        }).join('');
        conteudo = '<div style="position:relative;height:24px;width:100%"><div style="position:absolute;left:' + pctInicio + '%;width:' + largura + '%;height:100%;background:' + cor + ';border-radius:4px;display:flex;align-items:center;overflow:hidden" title="' + esc(t.nome) + ': ' + minParaHora(t.inicioMin) + '–' + minParaHora(t.fimMin) + '">' + pausas + '<span style="font-size:.7rem;font-weight:700;color:white;padding:0 6px;white-space:nowrap;overflow:hidden">' + minParaHora(t.inicioMin) + '–' + minParaHora(t.fimMin) + '</span></div></div>';
      }
      return '<div style="display:grid;grid-template-columns:160px 1fr;border-bottom:1px solid var(--gray-light);background:var(--white)" onmouseover="this.style.background=\'var(--off-white)\'" onmouseout="this.style.background=\'var(--white)\'"><div style="padding:.4rem .75rem;font-size:.78rem;font-weight:600;border-right:1px solid var(--gray-light);display:flex;align-items:center">' + esc(col.nome) + '</div><div style="padding:.3rem .25rem;' + grelhaStyle + '">' + conteudo + '</div></div>';
    }).join('');

    const corHdr = ehFeriado ? '#7c3aed' : (ehFimDeSemana ? '#64748b' : 'var(--teal)');
    const labelDia = ehFeriado ? (diaNome + ' ' + dataStr + ' · 🎉 Feriado') : (diaNome + ' ' + dataStr);

    return '<div style="border-radius:10px;overflow:hidden;border:1px solid var(--gray-light);margin-bottom:1.25rem;background:var(--white)">'
      + '<div style="background:' + corHdr + ';color:white;padding:.6rem 1rem;font-size:.85rem;font-weight:700">' + labelDia + '</div>'
      + '<div style="display:grid;grid-template-columns:160px 1fr;background:var(--gray-light);padding:.4rem 0"><div></div><div style="display:flex;padding:0 .25rem">' + escalaDia + '</div></div>'
      + '<div style="display:grid;grid-template-columns:160px 1fr;background:var(--off-white);border-bottom:2px solid var(--gray-light)"><div style="padding:.4rem .75rem;font-size:.7rem;font-weight:700;color:var(--text-muted);border-right:1px solid var(--gray-light);display:flex;align-items:center">Cobertura</div><div style="padding:.3rem .25rem;' + grelhaStyle + '"><div style="display:flex;height:14px;border-radius:3px;overflow:hidden">' + segmentos.join('') + '</div></div></div>'
      + linhasColab
      + '</div>';
  }).join('');

  const legenda = '<div style="display:flex;gap:.75rem;align-items:center;padding:.6rem .9rem;font-size:.72rem;color:var(--text-muted);background:var(--off-white);border-radius:8px;margin-bottom:1rem;flex-wrap:wrap">'
    + '<span style="font-weight:700">Cobertura (' + totalColab + ' colab.):</span>'
    + '<span style="display:flex;align-items:center;gap:.25rem"><span style="width:14px;height:10px;background:#ef4444;border-radius:2px"></span>1–20%</span>'
    + '<span style="display:flex;align-items:center;gap:.25rem"><span style="width:14px;height:10px;background:#f97706;border-radius:2px"></span>21–40%</span>'
    + '<span style="display:flex;align-items:center;gap:.25rem"><span style="width:14px;height:10px;background:#eab308;border-radius:2px"></span>41–60%</span>'
    + '<span style="display:flex;align-items:center;gap:.25rem"><span style="width:14px;height:10px;background:#84cc16;border-radius:2px"></span>61–80%</span>'
    + '<span style="display:flex;align-items:center;gap:.25rem"><span style="width:14px;height:10px;background:#15803d;border-radius:2px"></span>81–100%</span>'
    + '</div>';

  container.innerHTML = '<div style="width:100%">' + legenda + blocosDias + '</div>';
}

// ═══════════════════════════════════════
//  GANTT — MENSAL (versão única)
// ═══════════════════════════════════════
async function carregarGanttMensal() {
  const localId=document.getElementById('hor-local').value;
  const semana=document.getElementById('hor-semana').value;
  if (!localId||!semana) return;
  // Período do "mês" corre de dia 20 a dia 19 do mês seguinte. A semana
  // seleccionada pode cair na primeira parte desse período (dias 1–19, que
  // pertencem ao período iniciado no mês ANTERIOR) — por isso o mês do
  // período não é simplesmente o mês da data escolhida; tem de recuar um
  // mês quando o dia da semana escolhida é anterior a 20.
  const semanaDt=new Date(semana+'T12:00:00');
  const anoInicio=semanaDt.getFullYear();
  const mesInicio=semanaDt.getDate()<20 ? semanaDt.getMonth()-1 : semanaDt.getMonth();
  const inicio=new Date(anoInicio,mesInicio,20,12,0,0);
  const fim=new Date(anoInicio,mesInicio+1,19,12,0,0);
  const inicioStr=inicio.getFullYear()+'-'+String(inicio.getMonth()+1).padStart(2,'0')+'-'+String(inicio.getDate()).padStart(2,'0');
  const fimStr=fim.getFullYear()+'-'+String(fim.getMonth()+1).padStart(2,'0')+'-'+String(fim.getDate()).padStart(2,'0');
  const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const dtFim=new Date(anoInicio,mesInicio+1,1);
  document.getElementById('gantt-mes-label').textContent=meses[dtFim.getMonth()]+' '+dtFim.getFullYear();
  const container=document.getElementById('gantt-mes-container');
  container.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted)">A carregar…</div>';
  // Um único pedido para o período inteiro (em vez de um por semana em
  // paralelo) — evita gastar várias das execuções simultâneas partilhadas
  // do Apps Script de uma só vez (ver 12º seguimento, 2026-09-10).
  const respostaPeriodo=await assApi({acao:'gantPeriodo',localId,inicioStr,fimStr});
  if (!respostaPeriodo.ok) { container.innerHTML='<div style="text-align:center;padding:2rem;color:var(--danger)">Erro ao carregar. Tenta novamente.</div>'; return; }
  const diasMes={};
  for (const d of respostaPeriodo.dias) diasMes[d.dia]=d;
  const cols=[...new Map(Object.values(diasMes).flatMap(d=>d.colaboradores.map(c=>[c.username,c])))].map(([,c])=>c);
  if (!cols.length) { container.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted)">Sem colaboradores atribuídos neste mês.</div>'; return; }
  const diasOrdenados=Object.keys(diasMes).sort(), DIAS_PT=['D','S','T','Q','Q','S','S'];
  const cabDias=diasOrdenados.map(dia=>{
    const d=new Date(dia+'T12:00:00'), ds=d.getDay();
    const fd=diasMes[dia]?.eFeriado?'background:rgba(245,158,11,.18);':'';
    const fw=(ds===0||ds===6)?'background:rgba(0,0,0,.04);':'';
    return `<div style="${fd}${fw}padding:.3rem .1rem;text-align:center;font-size:.62rem;font-weight:700;border-right:1px solid var(--gray-light);min-width:28px"><div style="color:var(--text-muted);font-weight:400">${DIAS_PT[ds]}</div><div>${d.getDate()}</div></div>`;
  }).join('');
  const linhas=cols.map(col=>{
    const celulas=diasOrdenados.map(dia=>{
      const d=diasMes[dia], info=d?.colaboradores.find(c=>c.username===col.username), ds=new Date(dia+'T12:00:00').getDay();
      const fundo=(ds===0||ds===6)?'background:rgba(0,0,0,.03);':'';
if (info?.emFerias) { const ausIco={ferias:'🏖',baixa_medica:'🏥',licenca:'📄',outro:'❓'}[info.tipoAusencia]||'🏖'; return `<div style="${fundo}border-right:1px solid var(--gray-light);min-width:28px;display:flex;align-items:center;justify-content:center;padding:.2rem 0"><span style="font-size:.55rem">${ausIco}</span></div>`; }
      if (!info||info.folga||!info.turno) {
        return `<div style="${fundo}border-right:1px solid var(--gray-light);min-width:28px"></div>`;
      }
      const t=info.turno, cor=info.especial?'#f59e0b':'var(--teal)';
      const label=minParaHora(t.inicioMin).replace(':','h').replace(/^0/,'');
      return `<div style="${fundo}border-right:1px solid var(--gray-light);min-width:28px;padding:.2rem .1rem" title="${esc(t.nome)}: ${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)}"><div style="background:${cor};border-radius:3px;height:20px;display:flex;align-items:center;justify-content:center"><span style="font-size:.55rem;font-weight:700;color:white">${esc(label)}</span></div></div>`;
    }).join('');
    return `<div style="display:grid;grid-template-columns:110px repeat(${diasOrdenados.length},1fr);border-bottom:1px solid var(--gray-light);background:var(--white)" onmouseover="this.style.background='var(--off-white)'" onmouseout="this.style.background='var(--white)'"><div style="padding:.4rem .6rem;font-size:.75rem;font-weight:600;border-right:1px solid var(--gray-light);display:flex;align-items:center">${esc(col.nome)}</div>${celulas}</div>`;
  }).join('');
  container.innerHTML=`<div style="min-width:500px"><div style="display:grid;grid-template-columns:110px repeat(${diasOrdenados.length},1fr);background:var(--teal);color:white;border-radius:8px 8px 0 0"><div style="padding:.5rem .6rem;font-size:.72rem;font-weight:700">Colaborador</div>${cabDias}</div>${linhas}</div>`;
}

// dispara ambas as vistas e expõe no window
function carregarAmbasVistas() { carregarGantt(); carregarGanttMensal(); }
window.carregarAmbasVistas = carregarAmbasVistas;
window.carregarGantt       = carregarGantt;
window.carregarGanttMensal = carregarGanttMensal;

// ═══════════════════════════════════════
//  MODAL ATRIBUIR SEMANA
// ═══════════════════════════════════════
function abrirModalAtribuir() {
  document.getElementById('atribuir-err').style.display='none';
  document.getElementById('atribuir-ok').style.display='none';
  delete document.getElementById('modal-atribuir').dataset.editId;
  document.querySelector('#modal-atribuir .modal-title').textContent = 'Atribuir Horário à Semana(s)';
  popularColaboradoresSelect('at-colaborador');
  popularSelectLocal('at-local');
  popularHorariosTipoSelect('at-horario-tipo');
  const semAtual=document.getElementById('hor-semana').value;
  if (semAtual) document.getElementById('at-semana').value=semAtual;
  // Novo: injectar UI de multi-colaborador + repetição no modo criar
  injectarUIMultiAtribuicao(false);
  document.getElementById('modal-atribuir').classList.add('open');
}

// Adiciona (uma vez) a UI de multi-select e repetição ao modal.
// Se modoEdicao=true, esconde essa UI; se false, mostra e prepara.
function injectarUIMultiAtribuicao(modoEdicao) {
  const selColab = document.getElementById('at-colaborador');
  if (!selColab) return;

  // Detectar se já foi injectado — se sim, só actualizar visibilidade
  let bloco = document.getElementById('at-multi-bloco');
  if (!bloco) {
    // Container do bloco novo, inserido logo depois do select antigo de colaborador
    bloco = document.createElement('div');
    bloco.id = 'at-multi-bloco';
    bloco.style.cssText = 'margin-top:.5rem';
    bloco.innerHTML = `
      <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.35rem">
        Colaboradores adicionais (opcional — para atribuir a vários de uma vez)
      </div>
      <div id="at-checkboxes" style="max-height:130px;overflow-y:auto;border:1px solid var(--gray-light);border-radius:8px;padding:.4rem .6rem;background:var(--off-white);display:flex;flex-wrap:wrap;gap:.35rem .8rem;font-size:.78rem"></div>
      <div style="display:flex;justify-content:space-between;margin-top:.3rem;font-size:.7rem">
        <button type="button" onclick="atMarcarTodosColab(true)" style="background:none;border:none;color:var(--teal);cursor:pointer;font-family:inherit;padding:0;font-weight:600">✓ Selecionar todos</button>
        <button type="button" onclick="atMarcarTodosColab(false)" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-family:inherit;padding:0">Limpar</button>
      </div>

      <div style="margin-top:1rem;border-top:1px solid var(--gray-light);padding-top:.75rem">
        <div class="form-label" style="margin-bottom:.4rem">Repetir</div>
        <div style="display:flex;flex-direction:column;gap:.3rem;font-size:.82rem">
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="at-repetir" value="nao" checked onchange="atAtualizarUIRepetir()">
            <span>Apenas esta semana</span>
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="at-repetir" value="nSemanas" onchange="atAtualizarUIRepetir()">
            <span>Por</span>
            <input type="number" id="at-rep-nsemanas" min="2" max="60" value="4" disabled style="width:60px;padding:.25rem .4rem;border:1px solid var(--gray-light);border-radius:6px;font-family:inherit">
            <span>semanas</span>
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="at-repetir" value="ateData" onchange="atAtualizarUIRepetir()">
            <span>Até</span>
            <input type="date" id="at-rep-ate" disabled style="padding:.25rem .4rem;border:1px solid var(--gray-light);border-radius:6px;font-family:inherit">
          </label>
        </div>
      </div>
    `;
    // Inserir logo a seguir ao container do select colaborador
    const grupoColab = selColab.closest('.form-group') || selColab.parentElement;
    if (grupoColab && grupoColab.parentElement) grupoColab.parentElement.insertBefore(bloco, grupoColab.nextSibling);
  }

  // Preencher checkboxes com todos os colaboradores
  const div = document.getElementById('at-checkboxes');
  if (div) {
    div.innerHTML = COLABORADORES_CACHE.map(c =>
      `<label style="display:flex;align-items:center;gap:.35rem;cursor:pointer;white-space:nowrap"><input type="checkbox" class="at-chk-colab" value="${c.username}"><span>${esc(c.nome)}</span></label>`
    ).join('');
  }

  // Mostrar ou esconder conforme modo
  bloco.style.display = modoEdicao ? 'none' : 'block';
}

function atAtualizarUIRepetir() {
  const modo = (document.querySelector('input[name="at-repetir"]:checked')||{}).value;
  document.getElementById('at-rep-nsemanas').disabled = (modo !== 'nSemanas');
  document.getElementById('at-rep-ate').disabled = (modo !== 'ateData');
}

function atMarcarTodosColab(marcar) {
  document.querySelectorAll('.at-chk-colab').forEach(c => c.checked = !!marcar);
}

// Recolhe todos os usernames seleccionados: o do select principal + checkboxes
function atRecolherUsernames() {
  const principal = document.getElementById('at-colaborador').value;
  const marcados = Array.from(document.querySelectorAll('.at-chk-colab:checked')).map(c => c.value);
  const set = new Set();
  if (principal) set.add(principal);
  marcados.forEach(u => set.add(u));
  return Array.from(set);
}

function atRecolherRepetir() {
  const el = document.querySelector('input[name="at-repetir"]:checked');
  const modo = el ? el.value : 'nao';
  if (modo === 'nao') return null;
  if (modo === 'nSemanas') {
    const n = Number(document.getElementById('at-rep-nsemanas').value);
    if (!(n >= 2)) return null;
    return {modo:'nSemanas', valor:n};
  }
  if (modo === 'ateData') {
    const v = document.getElementById('at-rep-ate').value;
    if (!v) return null;
    return {modo:'ateData', valor:v};
  }
  return null;
}

async function guardarAtribuicao() {
  const err=document.getElementById('atribuir-err'), ok=document.getElementById('atribuir-ok');
  err.style.display='none'; ok.style.display='none';
  const localId = document.getElementById('at-local').value;
  const semanaInicio = document.getElementById('at-semana').value;
  const horarioTipoId = document.getElementById('at-horario-tipo').value;
  const editId = document.getElementById('modal-atribuir').dataset.editId;

  // ── MODO EDIÇÃO — comportamento antigo (single) ──
  if (editId) {
    const atribuicao = {
      username: document.getElementById('at-colaborador').value,
      localId, semanaInicio, horarioTipoId
    };
    if (!atribuicao.username || !localId || !semanaInicio || !horarioTipoId) {
      err.textContent = 'Preencha todos os campos.'; err.style.display = 'block'; return;
    }
    const r = await assApi({acao:'editarAtribuicaoSemana', id:editId, atribuicao});
    if (!r.ok) { err.textContent = r.erro; err.style.display = 'block'; return; }
    ok.textContent = '✅ '+r.mensagem; ok.style.display = 'block';
    delete document.getElementById('modal-atribuir').dataset.editId;
    setTimeout(() => closeModal('modal-atribuir'), 1000);
    carregarAmbasVistas();
    if (typeof carregarAtribuicoes === 'function') carregarAtribuicoes();
    return;
  }

  // ── MODO CRIAÇÃO — multi-colaborador + repetição + conflitos ──
  const usernames = atRecolherUsernames();
  const repetir = atRecolherRepetir();
  if (!usernames.length || !localId || !semanaInicio || !horarioTipoId) {
    err.textContent = 'Preencha todos os campos (incluindo pelo menos um colaborador).';
    err.style.display = 'block'; return;
  }

  const payloadBase = {acao:'atribuirSemana', usernames, localId, semanaInicio, horarioTipoId, repetir};
  const r = await assApi(payloadBase);

  if (r.ok) {
    ok.textContent = '✅ '+r.mensagem; ok.style.display = 'block';
    setTimeout(() => closeModal('modal-atribuir'), 1200);
    carregarAmbasVistas();
    if (typeof carregarAtribuicoes === 'function') carregarAtribuicoes();
    return;
  }

  if (r.conflitos && r.conflitos.length) {
    // Fecha o modal principal e abre resolução de conflitos
    abrirModalConflitosAtribuicao(r.conflitos, payloadBase);
    return;
  }

  err.textContent = r.erro || 'Erro ao atribuir.'; err.style.display = 'block';
}

// ═══════════════════════════════════════
//  MODAL — Resolução de conflitos de atribuição
// ═══════════════════════════════════════
let ATRIB_CONFLITOS_ESTADO = null;

function abrirModalConflitosAtribuicao(conflitos, payloadBase) {
  ATRIB_CONFLITOS_ESTADO = { restantes: conflitos.slice(), decisoes: [], payloadBase };
  let overlay = document.getElementById('modal-conflito-atrib');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-conflito-atrib';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100000;display:none;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(3px)';
    overlay.innerHTML = `
      <div style="background:var(--card-bg);border-radius:14px;padding:1.25rem 1.5rem;max-width:440px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:inherit;position:relative;z-index:100001">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem">
          <span style="font-size:1.4rem">⚠</span>
          <div style="font-weight:700;font-size:1.05rem">Conflito de atribuição</div>
        </div>
        <div id="conf-atrib-body" style="font-size:.85rem;color:var(--text-main);line-height:1.55;margin-bottom:1rem"></div>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          <button id="conf-atrib-manter" style="padding:.55rem;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--text-main);font-weight:600;font-size:.85rem;cursor:pointer;font-family:inherit">Manter existente</button>
          <button id="conf-atrib-subst"  style="padding:.55rem;border-radius:8px;border:none;background:var(--teal);color:white;font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit">Substituir</button>
          <button id="conf-atrib-substodos" style="padding:.55rem;border-radius:8px;border:none;background:#d97706;color:white;font-weight:700;font-size:.85rem;cursor:pointer;font-family:inherit">Substituir tudo</button>
          <button id="conf-atrib-cancelar" style="padding:.4rem;border:none;background:transparent;color:var(--text-muted);font-size:.78rem;cursor:pointer;font-family:inherit;margin-top:.2rem">Cancelar tudo</button>
        </div>
        <div id="conf-atrib-progresso" style="font-size:.72rem;color:var(--text-muted);margin-top:.5rem;text-align:right"></div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('conf-atrib-manter').onclick   = () => atResolverConflito('manter');
    document.getElementById('conf-atrib-subst').onclick    = () => atResolverConflito('substituir');
    document.getElementById('conf-atrib-substodos').onclick= () => atResolverConflito('substituirTudo');
    document.getElementById('conf-atrib-cancelar').onclick = () => atCancelarConflitos();
  }
  overlay.style.display = 'flex';
  // Esconder temporariamente o modal principal de atribuir para não interferir visualmente
  const modalPrincipal = document.getElementById('modal-atribuir');
  if (modalPrincipal) modalPrincipal.style.visibility = 'hidden';
  atMostrarProximoConflito();
}

function atMostrarProximoConflito() {
  const est = ATRIB_CONFLITOS_ESTADO;
  if (!est) return;
  if (!est.restantes.length) {
    document.getElementById('modal-conflito-atrib').style.display = 'none';
    // Restaurar visibilidade do modal principal (fica com o overlay a resultar de sucesso)
    const modalPrincipal = document.getElementById('modal-atribuir');
    if (modalPrincipal) modalPrincipal.style.visibility = '';
    atSubmeterComDecisoes();
    return;
  }
  const c = est.restantes[0];
  const colab = (COLABORADORES_CACHE.find(x => x.username === c.username)||{}).nome || c.username;
  const nomeNovo = (HORARIOS_TIPO_CACHE.find(h => h.id === est.payloadBase.horarioTipoId)||{}).nome || est.payloadBase.horarioTipoId;
  document.getElementById('conf-atrib-body').innerHTML =
    `<div style="font-weight:700;font-size:.95rem;margin-bottom:.35rem">${colab}</div>
     <div>Semana de <strong>${assFormatarData(String(c.semanaInicio).slice(0,10))}</strong></div>
     <div style="margin-top:.5rem;color:var(--text-muted)">Já tem atribuído:</div>
     <div style="font-weight:600">${c.horarioNomeActual || c.horarioTipoIdActual}</div>
     <div style="margin-top:.5rem;color:var(--text-muted)">Vais atribuir:</div>
     <div style="font-weight:600;color:var(--teal)">${nomeNovo}</div>`;
  document.getElementById('conf-atrib-progresso').textContent = `Restantes: ${est.restantes.length}`;
}

function atResolverConflito(accao) {
  const est = ATRIB_CONFLITOS_ESTADO;
  if (!est) return;
  if (accao === 'substituirTudo') {
    est.restantes.forEach(c => est.decisoes.push({username:c.username, semanaInicio:c.semanaInicio, accao:'substituir'}));
    est.restantes = [];
    atMostrarProximoConflito();
    return;
  }
  const c = est.restantes.shift();
  est.decisoes.push({username:c.username, semanaInicio:c.semanaInicio, accao});
  atMostrarProximoConflito();
}

function atCancelarConflitos() {
  document.getElementById('modal-conflito-atrib').style.display = 'none';
  // Restaurar visibilidade do modal principal
  const modalPrincipal = document.getElementById('modal-atribuir');
  if (modalPrincipal) modalPrincipal.style.visibility = '';
  ATRIB_CONFLITOS_ESTADO = null;
  const err = document.getElementById('atribuir-err');
  if (err) { err.textContent = 'Operação cancelada.'; err.style.display = 'block'; }
}

async function atSubmeterComDecisoes() {
  const est = ATRIB_CONFLITOS_ESTADO;
  if (!est) return;
  const payload = Object.assign({}, est.payloadBase, {decisoesConflito: est.decisoes});
  ATRIB_CONFLITOS_ESTADO = null;
  const r = await assApi(payload);
  const err = document.getElementById('atribuir-err');
  const ok  = document.getElementById('atribuir-ok');
  if (!r.ok) {
    if (err) { err.textContent = r.erro || 'Erro ao atribuir.'; err.style.display = 'block'; }
    return;
  }
  if (ok) { ok.textContent = '✅ '+r.mensagem; ok.style.display = 'block'; }
  setTimeout(() => closeModal('modal-atribuir'), 1200);
  carregarAmbasVistas();
  if (typeof carregarAtribuicoes === 'function') carregarAtribuicoes();
}

// ═══════════════════════════════════════
//  ATRIBUIÇÕES — listar / editar / apagar
// ═══════════════════════════════════════
function popularFiltrosAtribuicoes() {
  const selColab = document.getElementById('atrib-filtro-colab');
  const selLocal = document.getElementById('atrib-filtro-local');
  if (selColab && !selColab.dataset.populated) {
    selColab.innerHTML = '<option value="">Todos</option>';
    COLABORADORES_CACHE.forEach(c => selColab.innerHTML += `<option value="${c.username}">${esc(c.nome)}</option>`);
    selColab.dataset.populated = '1';
  }
  if (selLocal && !selLocal.dataset.populated) {
    selLocal.innerHTML = '<option value="">Todos</option>';
    LOCAIS_CACHE.forEach(l => selLocal.innerHTML += `<option value="${l.id}">${esc(l.nome)}</option>`);
    selLocal.dataset.populated = '1';
  }
}

async function carregarAtribuicoes() {
  popularFiltrosAtribuicoes();
  const selColab = document.getElementById('atrib-filtro-colab');
  const selLocal = document.getElementById('atrib-filtro-local');
  const filtros = {};
  const fU = selColab?.value;       if (fU) filtros.username = fU;
  const fL = selLocal?.value;       if (fL) filtros.localId = fL;
  const fS = document.getElementById('atrib-filtro-semana')?.value; if (fS) filtros.semanaInicio = fS;
  const r = await assApi({acao:'listarAtribuicoesSemana', filtros});
  if (!r.ok) return;
  ATRIBUICOES_CACHE = r.atribuicoes; // reaproveitado por editarAtribuicao — evita repetir o pedido só para achar 1 item
  if (!HORARIOS_TIPO_CACHE.length) await carregarHorariosTipo();
  const lista = document.getElementById('lista-atribuicoes');
  if (!r.atribuicoes.length) {
    lista.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem atribuições para mostrar.</div>';
    return;
  }
  const ordenadas = r.atribuicoes.slice().sort((a,b) => {
    const sA = String(a.semanaInicio).slice(0,10);
    const sB = String(b.semanaInicio).slice(0,10);
    if (sA !== sB) return sB.localeCompare(sA);
    return (a.username||'').localeCompare(b.username||'');
  });
  lista.innerHTML = `<table class="tbl"><thead><tr><th>Colaborador</th><th>Local</th><th>Semana</th><th>Horário Tipo</th><th></th></tr></thead><tbody>${
    ordenadas.map(a => {
      const col = COLABORADORES_CACHE.find(c => c.username === a.username);
      const loc = LOCAIS_CACHE.find(l => l.id === a.localId);
      const hor = HORARIOS_TIPO_CACHE.find(h => h.id === a.horarioTipoId);
      const semStr = String(a.semanaInicio).slice(0,10);
      return `<tr>
        <td style="font-weight:600">${esc(col?.nome || a.username)}</td>
        <td>${esc(loc?.nome || a.localId)}</td>
        <td>${assFormatarData(semStr)}</td>
        <td><span style="background:var(--teal-pale);color:var(--teal);border-radius:5px;padding:2px 8px;font-weight:600;font-size:.78rem">${esc(hor?.nome || a.horarioTipoId)}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-sm teal" onclick="editarAtribuicao('${a.id}')">✎ Editar</button>
          <button class="btn-sm danger" onclick="apagarAtribuicao('${a.id}','${(col?.nome||a.username).replace(/'/g,"\\'")}','${semStr}')">✕ Apagar</button>
        </td>
      </tr>`;
    }).join('')
  }</tbody></table>`;
}

// 2026-09-12 (2ª ronda de auditoria): usava sempre um pedido
// listarAtribuicoesSemana sem filtros (todas as atribuições, de todos os
// colaboradores) só para encontrar 1 item — quando a lista já tinha acabado
// de ser carregada por carregarAtribuicoes (é o que desenhou o botão que
// chama esta função). Procura primeiro em ATRIBUICOES_CACHE; só pede ao
// servidor se, por algum motivo, não encontrar lá (ex.: item fora do filtro
// actualmente aplicado).
async function editarAtribuicao(id) {
  let a = ATRIBUICOES_CACHE.find(x => x.id === id);
  if (!a) {
    const r = await assApi({acao:'listarAtribuicoesSemana', filtros:{}});
    if (!r.ok) return;
    a = r.atribuicoes.find(x => x.id === id);
  }
  if (!a) { alert('Atribuição não encontrada.'); return; }
  document.getElementById('atribuir-err').style.display='none';
  document.getElementById('atribuir-ok').style.display='none';
  popularColaboradoresSelect('at-colaborador');
  popularSelectLocal('at-local');
  popularHorariosTipoSelect('at-horario-tipo').then(() => {
    document.getElementById('at-colaborador').value = a.username;
    document.getElementById('at-local').value = a.localId;
    document.getElementById('at-semana').value = String(a.semanaInicio).slice(0,10);
    document.getElementById('at-horario-tipo').value = a.horarioTipoId;
  });
  // Modo edição: esconder o bloco de multi-select + repetição
  injectarUIMultiAtribuicao(true);
  document.getElementById('modal-atribuir').dataset.editId = id;
  document.querySelector('#modal-atribuir .modal-title').textContent = 'Editar Atribuição';
  document.getElementById('modal-atribuir').classList.add('open');
}

async function apagarAtribuicao(id, nomeColab, semana) {
  if (!confirm(`Apagar atribuição de ${nomeColab} para a semana de ${assFormatarData(semana)}?`)) return;
  const r = await assApi({acao:'apagarAtribuicaoSemana', id});
  if (!r.ok) { alert(r.erro || 'Erro ao apagar.'); return; }
  carregarAtribuicoes();
  carregarAmbasVistas();
}

// ═══════════════════════════════════════
//  EXCEÇÕES DIÁRIAS (Horários Especiais)
// ═══════════════════════════════════════
function popularFiltrosExcecoes() {
  const selColab = document.getElementById('exc-filtro-colab');
  const selLocal = document.getElementById('exc-filtro-local');
  if (selColab && !selColab.dataset.populated) {
    selColab.innerHTML = '<option value="">Todos</option>';
    COLABORADORES_CACHE.forEach(c => selColab.innerHTML += `<option value="${c.username}">${esc(c.nome)}</option>`);
    selColab.dataset.populated = '1';
  }
  if (selLocal && !selLocal.dataset.populated) {
    selLocal.innerHTML = '<option value="">Todos</option>';
    LOCAIS_CACHE.forEach(l => selLocal.innerHTML += `<option value="${l.id}">${esc(l.nome)}</option>`);
    selLocal.dataset.populated = '1';
  }
}

async function carregarExcecoes() {
  popularFiltrosExcecoes();
  const lista=document.getElementById('lista-excecoes');
  if (!lista) return;
  if (!TURNOS_CACHE.length) await carregarTurnos();
  const filtros = {};
  const fU = document.getElementById('exc-filtro-colab')?.value; if (fU) filtros.username = fU;
  const fL = document.getElementById('exc-filtro-local')?.value; if (fL) filtros.localId = fL;
  const fD = document.getElementById('exc-filtro-data')?.value;  if (fD) filtros.data = fD;
  const r=await assApi({acao:'listarExcecoesDia',filtros});
  if (!r.ok) return;
  if (!r.excecoes.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem exceções registadas.</div>'; return; }
  const ordenadas=r.excecoes.slice().sort((a,b)=>b.data.localeCompare(a.data));
  lista.innerHTML=`<table class="tbl"><thead><tr><th>Colaborador</th><th>Data</th><th>Turno</th><th>Local</th><th>Motivo</th><th></th></tr></thead><tbody>${
    ordenadas.map(e=>{
      const col=COLABORADORES_CACHE.find(c=>c.username===e.username);
      const t=TURNOS_CACHE.find(x=>x.id===e.turnoTipoId);
      const loc=LOCAIS_CACHE.find(l=>l.id===e.localId);
      return `<tr>
        <td style="font-weight:600">${esc(col?.nome||e.username)}</td>
        <td>${assFormatarData(e.data)}</td>
        <td>${t?`<span style="background:#fff3e0;color:#d97706;border-radius:5px;padding:2px 8px;font-weight:600;font-size:.78rem">${esc(t.nome)}: ${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)}</span>`:esc(e.turnoTipoId)}</td>
        <td>${esc(loc?.nome||e.localId)}</td>
        <td style="font-size:.78rem;color:var(--text-muted)">${esc(e.motivo)||'—'}</td>
        <td style="text-align:right"><button class="btn-sm danger" onclick="removerExcecao('${e.id}')">✕</button></td>
      </tr>`;
    }).join('')
  }</tbody></table>`;
}

function abrirModalExcecao() {
  document.getElementById('exc-err').style.display='none';
  document.getElementById('exc-ok').style.display='none';
  popularColaboradoresSelect('exc-colaborador');
  const selT=document.getElementById('exc-turno');
  const popularTurnos=()=>{
    selT.innerHTML='<option value="">Selecionar turno…</option>';
    TURNOS_CACHE.forEach(t=>{
      const loc=LOCAIS_CACHE.find(l=>l.id===t.localId);
      selT.innerHTML+=`<option value="${t.id}">${esc(t.nome)} (${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)}) · ${esc(loc?.nome||t.localId)}</option>`;
    });
  };
  if (!TURNOS_CACHE.length) carregarTurnos().then(popularTurnos); else popularTurnos();
  document.getElementById('modal-excecao').classList.add('open');
}

async function guardarExcecao() {
  const err=document.getElementById('exc-err'), ok=document.getElementById('exc-ok');
  err.style.display='none'; ok.style.display='none';
  const excecao={
    username:document.getElementById('exc-colaborador').value,
    data:document.getElementById('exc-data').value,
    turnoTipoId:document.getElementById('exc-turno').value,
    motivo:document.getElementById('exc-motivo').value.trim()
  };
  if (!excecao.username||!excecao.data||!excecao.turnoTipoId) { err.textContent='Preencha colaborador, data e turno.'; err.style.display='block'; return; }
  const r=await assApi({acao:'criarExcecaoDia',excecao});
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  ok.textContent='✅ '+r.mensagem; ok.style.display='block';
  setTimeout(()=>closeModal('modal-excecao'),1000);
  carregarExcecoes();
  carregarAmbasVistas();
}

async function removerExcecao(id) {
  if (!confirm('Remover esta exceção? O colaborador volta ao horário normal nesse dia.')) return;
  const r=await assApi({acao:'apagarExcecaoDia',id});
  if (!r.ok) { alert(r.erro||'Erro ao remover.'); return; }
  carregarExcecoes();
  carregarAmbasVistas();
}

// ═══════════════════════════════════════
//  TABELAS ORDENÁVEIS E FILTRÁVEIS (utilitário genérico)
// ═══════════════════════════════════════
// Pedido do Ricardo (2026-09-10): as tabelas de férias deveriam poder ser
// ordenadas e filtradas por qualquer coluna. Em vez de resolver isto só
// para essa tabela, ficou como utilitário genérico (indexado por um "id"
// próprio por tabela) para poder ser reaproveitado noutras listas no
// futuro. Cada linha de dados é um objecto simples {coluna: valor, ...}
// usado para ordenar; quando o texto a filtrar deve ser diferente do valor
// de ordenação (ex.: datas — ordenar por ISO, filtrar pelo formato
// dd/mm/aaaa que é o que aparece no ecrã), usa-se a chave "coluna__t".
const TABELA_ESTADO = {};
function tabelaEstado_(id) {
  if (!TABELA_ESTADO[id]) TABELA_ESTADO[id] = { sortCol: null, sortDir: 1, filtros: {} };
  return TABELA_ESTADO[id];
}
function tabelaAplicar_(id, linhas) {
  const est = tabelaEstado_(id);
  let idx = linhas.map((_, i) => i);
  Object.keys(est.filtros).forEach(col => {
    const termo = (est.filtros[col] || '').toString().trim().toLowerCase();
    if (!termo) return;
    idx = idx.filter(i => {
      const v = linhas[i][col + '__t'] !== undefined ? linhas[i][col + '__t'] : linhas[i][col];
      return String(v ?? '').toLowerCase().includes(termo);
    });
  });
  if (est.sortCol) {
    idx.sort((a, b) => {
      const va = linhas[a][est.sortCol], vb = linhas[b][est.sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return -1 * est.sortDir;
      if (vb == null) return 1 * est.sortDir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * est.sortDir;
      return String(va).localeCompare(String(vb), 'pt') * est.sortDir;
    });
  }
  return idx;
}
function tabelaOrdenarPor(id, col, renderFn) {
  const est = tabelaEstado_(id);
  if (est.sortCol === col) est.sortDir *= -1; else { est.sortCol = col; est.sortDir = 1; }
  renderFn();
}
function tabelaFiltrar(id, col, valor, renderFn) {
  tabelaEstado_(id).filtros[col] = valor;
  // renderFn() reconstrói toda a tabela (innerHTML) — incluindo o próprio
  // campo onde se está a escrever, que fica um elemento DOM novo e perde o
  // foco. Sem isto, cada letra digitada tira o foco do campo e é preciso
  // clicar outra vez antes da letra seguinte ("só permite uma letra de cada
  // vez", reportado pelo Ricardo, 2026-09-10). Guarda a posição do cursor
  // antes de reconstruir e volta a focar + repor o cursor no elemento novo
  // com o mesmo id/coluna a seguir.
  const activo = document.activeElement;
  const cursor = (activo && typeof activo.selectionStart === 'number') ? activo.selectionStart : null;
  renderFn();
  const novo = document.querySelector(`[data-tfiltro-id="${id}"][data-tfiltro-col="${col}"]`);
  if (novo) {
    novo.focus();
    if (cursor !== null && typeof novo.setSelectionRange === 'function') {
      try { novo.setSelectionRange(cursor, cursor); } catch (_) {}
    }
  }
}
function tabelaLimparFiltros(id, renderFn) {
  tabelaEstado_(id).filtros = {};
  renderFn();
}
function tabelaTemFiltros_(id) {
  const f = tabelaEstado_(id).filtros;
  return Object.keys(f).some(k => (f[k] || '').toString().trim() !== '');
}
function tabelaSeta_(id, col) {
  const est = tabelaEstado_(id);
  if (est.sortCol !== col) return '';
  return est.sortDir === 1 ? ' ▲' : ' ▼';
}
function tabelaTh_(id, label, col, renderFnNome) {
  return `<th class="sortavel" onclick="tabelaOrdenarPor('${id}','${col}',${renderFnNome})">${label}${tabelaSeta_(id, col)}</th>`;
}
function tabelaFiltroTexto_(id, col, renderFnNome, placeholder) {
  const v = (tabelaEstado_(id).filtros[col] || '').toString().replace(/"/g, '&quot;');
  return `<input type="text" data-tfiltro-id="${id}" data-tfiltro-col="${col}" placeholder="${placeholder || 'filtrar…'}" value="${v}" oninput="tabelaFiltrar('${id}','${col}',this.value,${renderFnNome})">`;
}
function tabelaFiltroSelect_(id, col, renderFnNome, opcoes) {
  const actual = (tabelaEstado_(id).filtros[col] || '').toString();
  const opts = ['<option value="">Todos</option>', ...opcoes.map(([v,l]) => `<option value="${v}"${v===actual?' selected':''}>${l}</option>`)].join('');
  return `<select data-tfiltro-id="${id}" data-tfiltro-col="${col}" onchange="tabelaFiltrar('${id}','${col}',this.value,${renderFnNome})">${opts}</select>`;
}

// ═══════════════════════════════════════
//  FÉRIAS
// ═══════════════════════════════════════
const TIPO_AUSENCIA_LABEL = {ferias:'🏖 Férias',baixa_medica:'🏥 Baixa médica',licenca:'📄 Licença',outro:'❓ Outro'};

function renderFeriasTabela() {
  const lista=document.getElementById('lista-ferias');
  const dados = FERIAS_CACHE || [];
  if (!dados.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem registos de férias.</div>'; return; }
  const linhas = dados.map(f => {
    const col=COLABORADORES_CACHE.find(c=>c.username===f.username), loc=LOCAIS_CACHE.find(l=>l.id===f.localId);
    return {
      colaborador: col?.nome||f.username,
      tipo: TIPO_AUSENCIA_LABEL[f.tipo]||TIPO_AUSENCIA_LABEL.ferias, tipo__t: f.tipo,
      local: loc?.nome||f.localId, local__t: f.localId,
      inicio: String(f.dataInicio).slice(0,10), inicio__t: assFormatarData(f.dataInicio),
      fim: String(f.dataFim).slice(0,10), fim__t: assFormatarData(f.dataFim),
      dias: Number(f.diasUteis)||0,
      estado: f.estado,
      _f: f
    };
  });
  const idx = tabelaAplicar_('ferias', linhas);
  const th = (label, col) => tabelaTh_('ferias', label, col, 'renderFeriasTabela');
  const locaisOpts = LOCAIS_CACHE.map(l => [l.id, l.nome]);
  const tiposOpts = Object.keys(TIPO_AUSENCIA_LABEL).map(k => [k, TIPO_AUSENCIA_LABEL[k]]);
  const estadosOpts = [['pendente','pendente'],['aprovado','aprovado'],['rejeitado','rejeitado']];
  const linhaFiltros = `<tr class="tbl-filtros">
      <td>${tabelaFiltroTexto_('ferias','colaborador','renderFeriasTabela')}</td>
      <td>${tabelaFiltroSelect_('ferias','tipo','renderFeriasTabela',tiposOpts)}</td>
      <td>${tabelaFiltroSelect_('ferias','local','renderFeriasTabela',locaisOpts)}</td>
      <td>${tabelaFiltroTexto_('ferias','inicio','renderFeriasTabela','dd/mm/aaaa')}</td>
      <td>${tabelaFiltroTexto_('ferias','fim','renderFeriasTabela','dd/mm/aaaa')}</td>
      <td>${tabelaFiltroTexto_('ferias','dias','renderFeriasTabela')}</td>
      <td>${tabelaFiltroSelect_('ferias','estado','renderFeriasTabela',estadosOpts)}</td>
      <td>${tabelaTemFiltros_('ferias')?'<span class="tbl-limpar-filtros" onclick="tabelaLimparFiltros(\'ferias\',renderFeriasTabela)">✕ limpar</span>':''}</td>
    </tr>`;
  const corpo = idx.length
    ? idx.map(i=>{
        const f = linhas[i]._f, o=linhas[i];
        const cor=o.estado==='aprovado'?'color:#00a878':o.estado==='rejeitado'?'color:var(--danger)':'color:#d97706';
        return `<tr><td style="font-weight:600">${esc(o.colaborador)}</td><td style="font-size:.8rem">${o.tipo}</td><td>${esc(o.local)}</td><td>${o.inicio__t}</td><td>${o.fim__t}</td><td style="text-align:center;font-weight:700">${o.dias}</td><td style="${cor};font-weight:600;font-size:.8rem">${o.estado}</td><td style="white-space:nowrap">${f.estado==='pendente'?`<button class="btn-sm teal" onclick="decidirFerias('${f.id}','aprovado')">✓</button> <button class="btn-sm danger" onclick="decidirFerias('${f.id}','rejeitado')">✕</button> `:''}<button class="btn-sm" onclick="abrirEditarFerias('${f.id}')" title="Editar">✎</button>${SESSION.role==='master'?` <button class="btn-sm danger" onclick="apagarFeriasConfirm('${f.id}')" title="Apagar">🗑</button>`:''}</td></tr>`;
      }).join('')
    : `<tr><td colspan="8" style="text-align:center;padding:1.2rem;color:var(--text-muted)">Nenhum registo com estes filtros.</td></tr>`;
  lista.innerHTML = `<table class="tbl"><thead><tr>${th('Colaborador','colaborador')}${th('Tipo','tipo')}${th('Local','local')}${th('Início','inicio')}${th('Fim','fim')}${th('Dias úteis','dias')}${th('Estado','estado')}<th></th></tr>${linhaFiltros}</thead><tbody>${corpo}</tbody></table>`;
}

async function carregarFerias() {
  const ano = document.getElementById('fer-filtro-ano')?.value;
  const filtros = {}; if (ano) filtros.ano = ano;
  const r=await assApi({acao:'listarFerias',filtros}); if (!r.ok) return;
  FERIAS_CACHE = r.ferias;
  renderFeriasTabela();
}

// 2026-09-10: apagar uma ausência — só master (ver fsApagarFerias). Pede
// sempre um motivo (obrigatório no backend) e confirmação extra, por ser
// destrutivo e irreversível.
async function apagarFeriasConfirm(id) {
  const motivo = prompt('Motivo para apagar esta ausência (obrigatório):');
  if (!motivo || !motivo.trim()) return;
  if (!confirm('Apagar definitivamente esta ausência? Esta acção não pode ser desfeita.')) return;
  const r = await assApi({acao:'apagarFerias', id, motivo:motivo.trim()});
  if (!r.ok) { alert(r.erro||'Erro ao apagar.'); return; }
  carregarFerias();
}

function abrirEditarFerias(id) {
  const f = (FERIAS_CACHE||[]).find(x => x.id === id);
  if (!f) return;
  const col = COLABORADORES_CACHE.find(c => c.username === f.username);
  document.getElementById('feredit-id').value = id;
  document.getElementById('feredit-info').textContent = `${col?.nome||f.username}`;
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(()=>{ popularSelectLocal('feredit-local'); document.getElementById('feredit-local').value = f.localId; }); else { popularSelectLocal('feredit-local'); document.getElementById('feredit-local').value = f.localId; }
  document.getElementById('feredit-tipo').value = f.tipo || 'ferias';
  document.getElementById('feredit-inicio').value = String(f.dataInicio).slice(0,10);
  document.getElementById('feredit-fim').value = String(f.dataFim).slice(0,10);
  document.getElementById('feredit-aviso').textContent = f.estado !== 'pendente' ? '⚠ Esta ausência já foi ' + f.estado + '. Ao guardar, volta a ficar pendente para nova aprovação.' : '';
  document.getElementById('mferedit-err').style.display = 'none';
  document.getElementById('modal-editar-ferias').classList.add('open');
}

async function guardarFeriasEditada() {
  const err = document.getElementById('mferedit-err');
  err.style.display = 'none';
  const id = document.getElementById('feredit-id').value;
  const patch = {
    localId: document.getElementById('feredit-local').value,
    tipo: document.getElementById('feredit-tipo').value,
    dataInicio: document.getElementById('feredit-inicio').value,
    dataFim: document.getElementById('feredit-fim').value
  };
  if (!patch.localId || !patch.dataInicio || !patch.dataFim) { showAlert(err, 'Preencha todos os campos.'); return; }
  const r = await assApi({ acao: 'editarFerias', id, patch });
  if (!r.ok) { showAlert(err, r.erro); return; }
  closeModal('modal-editar-ferias');
  carregarFerias();
}

function abrirModalFerias() {
  document.getElementById('mferias-err').style.display='none'; document.getElementById('mferias-conflitos').style.display='none';
  if (!COLABORADORES_CACHE.length) carregarColaboradoresCache().then(()=>popularColaboradoresSelect('fer-colaborador')); else popularColaboradoresSelect('fer-colaborador');
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(()=>popularSelectLocal('fer-local')); else popularSelectLocal('fer-local');
  document.getElementById('modal-ferias').classList.add('open');
}

async function guardarFerias() {
  const err=document.getElementById('mferias-err'), conf=document.getElementById('mferias-conflitos');
  err.style.display='none'; conf.style.display='none';
  const ferias={username:document.getElementById('fer-colaborador').value,localId:document.getElementById('fer-local').value,dataInicio:document.getElementById('fer-inicio').value,dataFim:document.getElementById('fer-fim').value,tipo:(document.getElementById('fer-tipo')?document.getElementById('fer-tipo').value:'ferias')};
  if (!ferias.username||!ferias.localId||!ferias.dataInicio||!ferias.dataFim) { err.textContent='Preencha todos os campos.'; err.style.display='block'; return; }
  const r=await assApi({acao:'registarFerias',ferias});
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  if (r.conflitos&&r.conflitos.length) { conf.textContent=`⚠ Conflitos: loja sem cobertura em ${r.conflitos.length} dia(s): ${r.conflitos.map(assFormatarData).join(', ')}`; conf.style.display='block'; }
  closeModal('modal-ferias'); carregarFerias();
}

async function decidirFerias(id, decisao) {
  const nota=prompt('Nota de justificação (obrigatória):'); if (!nota) return;
  const r=decisao==='aprovado'?await assApi({acao:'aprovarFerias',id,nota}):await assApi({acao:'rejeitarFerias',id,nota});
  if (r.ok) carregarFerias();
}

// ═══════════════════════════════════════
//  FÉRIAS — AUTO-SERVIÇO (2026-09-10)
//  Vista "🏖 Férias", visível a qualquer colaborador autenticado (não só
//  master/coordenador): pedir férias para si próprio e consultar o mapa da
//  sua função. Usa os mesmos gestao-tab/gestao-panel do painel de Gestão só
//  para o estilo — a troca de separador é feita por uma função própria,
//  scoped a #view-ferias, para não interferir com os separadores de Gestão
//  (showGestaoTab mexe nesses elementos a nível do documento inteiro).
// ═══════════════════════════════════════
async function feriasColabActivar() {
  if (!LOCAIS_CACHE.length) await carregarLocaisCache();
  const primeiraTab = document.querySelector('#view-ferias .gestao-tab');
  showFeriasColabTab('minhasferias', primeiraTab);
}

function showFeriasColabTab(id, btn) {
  const view = document.getElementById('view-ferias');
  view.querySelectorAll('.gestao-panel').forEach(p=>p.classList.remove('active'));
  view.querySelectorAll('.gestao-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('gpanel-'+id).classList.add('active');
  if (btn) btn.classList.add('active');
  // 2026-09-10: idem — deixou de carregar sozinho ao abrir a sub-aba, só
  // preenche o ano por omissão; espera pelo clique em "Procurar"/"Actualizar".
  if (id==='minhasferias') {
    const anoInp=document.getElementById('minhasferias-ano');
    if (anoInp && !anoInp.value) anoInp.value = new Date().getFullYear();
  }
  if (id==='mapaferiascolab') {
    const anoInp=document.getElementById('mapaferiascolab-ano');
    if (anoInp && !anoInp.value) anoInp.value = new Date().getFullYear();
  }
}

function renderMinhasFeriasTabela() {
  const lista=document.getElementById('lista-minhas-ferias');
  const dados = MINHAS_FERIAS_CACHE || [];
  if (!dados.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Ainda não tem pedidos de ausência.</div>'; return; }
  const linhas = dados.map(f => {
    const loc=LOCAIS_CACHE.find(l=>l.id===f.localId);
    return {
      tipo: TIPO_AUSENCIA_LABEL[f.tipo]||TIPO_AUSENCIA_LABEL.ferias, tipo__t: f.tipo,
      local: loc?.nome||f.localId||'—', local__t: f.localId||'',
      inicio: String(f.dataInicio).slice(0,10), inicio__t: assFormatarData(f.dataInicio),
      fim: String(f.dataFim).slice(0,10), fim__t: assFormatarData(f.dataFim),
      dias: Number(f.diasUteis)||0,
      estado: f.estado,
      _f: f
    };
  });
  const idx = tabelaAplicar_('minhasferias', linhas);
  const th = (label, col) => tabelaTh_('minhasferias', label, col, 'renderMinhasFeriasTabela');
  const locaisOpts = LOCAIS_CACHE.map(l => [l.id, l.nome]);
  const tiposOpts = Object.keys(TIPO_AUSENCIA_LABEL).map(k => [k, TIPO_AUSENCIA_LABEL[k]]);
  const estadosOpts = [['pendente','pendente'],['aprovado','aprovado'],['rejeitado','rejeitado']];
  const linhaFiltros = `<tr class="tbl-filtros">
      <td>${tabelaFiltroSelect_('minhasferias','tipo','renderMinhasFeriasTabela',tiposOpts)}</td>
      <td>${tabelaFiltroSelect_('minhasferias','local','renderMinhasFeriasTabela',locaisOpts)}</td>
      <td>${tabelaFiltroTexto_('minhasferias','inicio','renderMinhasFeriasTabela','dd/mm/aaaa')}</td>
      <td>${tabelaFiltroTexto_('minhasferias','fim','renderMinhasFeriasTabela','dd/mm/aaaa')}</td>
      <td>${tabelaFiltroTexto_('minhasferias','dias','renderMinhasFeriasTabela')}</td>
      <td>${tabelaFiltroSelect_('minhasferias','estado','renderMinhasFeriasTabela',estadosOpts)}${tabelaTemFiltros_('minhasferias')?'<span class="tbl-limpar-filtros" onclick="tabelaLimparFiltros(\'minhasferias\',renderMinhasFeriasTabela)">✕ limpar</span>':''}</td>
    </tr>`;
  const corpo = idx.length
    ? idx.map(i=>{
        const o=linhas[i];
        const cor=o.estado==='aprovado'?'color:#00a878':o.estado==='rejeitado'?'color:var(--danger)':'color:#d97706';
        return `<tr><td style="font-size:.8rem">${o.tipo}</td><td>${esc(o.local)}</td><td>${o.inicio__t}</td><td>${o.fim__t}</td><td style="text-align:center;font-weight:700">${o.dias}</td><td style="${cor};font-weight:600;font-size:.8rem">${o.estado}</td></tr>`;
      }).join('')
    : `<tr><td colspan="6" style="text-align:center;padding:1.2rem;color:var(--text-muted)">Nenhum registo com estes filtros.</td></tr>`;
  lista.innerHTML = `<table class="tbl"><thead><tr>${th('Tipo','tipo')}${th('Local','local')}${th('Início','inicio')}${th('Fim','fim')}${th('Dias úteis','dias')}${th('Estado','estado')}</tr>${linhaFiltros}</thead><tbody>${corpo}</tbody></table>`;
}

async function carregarMinhasFerias() {
  if (!LOCAIS_CACHE.length) await carregarLocaisCache();
  // Envia sempre o próprio username no filtro: para um colaborador comum o
  // backend força isto de qualquer forma, mas para master/coordenador é
  // preciso pedir explicitamente — sem isto, fsListarFerias devolve-lhes
  // TODOS os pedidos do sistema (é o que já fazem em Gestão → Férias), não
  // só os seus próprios, que é o que esta aba de auto-serviço deve mostrar.
  const ano = document.getElementById('minhasferias-ano')?.value;
  const filtros = {username:SESSION.username}; if (ano) filtros.ano = ano;
  const r=await assApi({acao:'listarFerias',filtros}); if (!r.ok) return;
  MINHAS_FERIAS_CACHE = [...r.ferias].sort((a,b)=>String(b.dataInicio).localeCompare(String(a.dataInicio)));
  // Ordenação por data (mais recente primeiro) só como ponto de partida — se
  // o colaborador clicar num cabeçalho, tabelaAplicar_ passa a mandar.
  if (!tabelaEstado_('minhasferias').sortCol) { tabelaEstado_('minhasferias').sortCol = 'inicio'; tabelaEstado_('minhasferias').sortDir = -1; }
  renderMinhasFeriasTabela();
}

function abrirModalPedirFerias() {
  document.getElementById('mpedirferias-err').style.display='none';
  document.getElementById('pf-tipo').value='ferias';
  document.getElementById('pf-inicio').value='';
  document.getElementById('pf-fim').value='';
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(()=>popularSelectLocal('pf-local')); else popularSelectLocal('pf-local');
  document.getElementById('modal-pedir-ferias').classList.add('open');
}

async function guardarPedidoFerias() {
  const err=document.getElementById('mpedirferias-err'); err.style.display='none';
  const ferias={
    tipo: document.getElementById('pf-tipo').value,
    localId: document.getElementById('pf-local').value,
    dataInicio: document.getElementById('pf-inicio').value,
    dataFim: document.getElementById('pf-fim').value
  };
  if (!ferias.dataInicio||!ferias.dataFim) { err.textContent='Preencha as datas de início e fim.'; err.style.display='block'; return; }
  const r=await assApi({acao:'registarFerias',ferias});
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  closeModal('modal-pedir-ferias');
  carregarMinhasFerias();
}

// ═══════════════════════════════════════
//  APROVAÇÕES
// ═══════════════════════════════════════
async function carregarAprovacoes() {
  const estado=document.getElementById('aprov-filtro')?.value||'pendente';
  const r=await assApi({acao:'listarAprovacoes',filtros:{estado:estado||undefined}}); if (!r.ok) return;
  APROVACOES_CACHE = r.aprovacoes;
  const lista=document.getElementById('lista-aprovacoes');
  if (!r.aprovacoes.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem aprovações para mostrar.</div>'; return; }
  lista.innerHTML=r.aprovacoes.map(a=>{const col=COLABORADORES_CACHE.find(c=>c.username===a.username),loc=LOCAIS_CACHE.find(l=>l.id===a.localId);const tipoLabel={entrada_fora_janela:'⏰ Entrada fora de janela',saida_fora_janela:'⏰ Saída fora de janela',entrada_local_diferente:'📍 Entrada em local diferente',pedido_hora_extra:'🕐 Pedido de hora extra',pedido_entrada_antecipada:'🕐 Pedido de entrada antecipada'}[a.tipo]||a.tipo;
    // Registo móvel (foto+GPS) fora de baliza: mostra link para o mapa e para a
    // foto tirada no momento, se existirem (ver fsListarAprovacoes) — para o
    // coordenador poder confirmar visualmente antes de decidir.
    const linksMovel = (a.movelLat != null && a.movelLng != null)
      ? `<div style="margin-top:.4rem;display:flex;gap:.75rem;font-size:.78rem">
           <a href="https://www.google.com/maps?q=${encodeURIComponent(a.movelLat)},${encodeURIComponent(a.movelLng)}" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600">📍 Ver no mapa</a>
           ${a.movelFotoUrl?`<a href="${esc(a.movelFotoUrl)}" target="_blank" rel="noopener" style="color:var(--teal);font-weight:600">📷 Ver foto</a>`:''}
         </div>` : '';
    // 2026-09-11, pedido do Ricardo: hora real do registo + hora prevista do
    // turno bem visíveis no cartão (em vez de só embutidas no texto do
    // motivo) — ajuda a decidir sem ter de ir ler a frase toda. Nem todas as
    // aprovações têm turno previsto (ex.: comerciais/AVAC sem horário fixo).
    const temHoras = a.horaRealMin !== undefined && a.horaRealMin !== null && a.horaRealMin !== '';
    const horasLinha = temHoras
      ? `<div style="margin-top:.3rem;font-size:.78rem;color:var(--text-muted)">🕐 Registo real: <strong style="color:var(--text)">${minParaHora(a.horaRealMin)}</strong> · Turno previsto: <strong style="color:var(--text)">${(a.horaPrevistaMin !== undefined && a.horaPrevistaMin !== null && a.horaPrevistaMin !== '') ? minParaHora(a.horaPrevistaMin) : 'sem turno atribuído'}</strong></div>`
      : '';
    // 2026-09-12 (2ª ronda de auditoria) — item crítico de segurança: a.motivo
    // é texto livre escrito pelo PRÓPRIO colaborador (justificação ao registar
    // fora de baliza, ou ao pedir hora extra/entrada antecipada) e ia direto
    // para innerHTML sem escape nenhum — um colaborador podia pôr HTML/script
    // no motivo e ver isso correr no ecrã do master/coordenador que abrisse
    // esta lista para decidir. esc() aplicado a tudo o que pode conter texto
    // não controlado (nome, local, motivo, notas de decisão).
    return `<div class="aprov-card"><div class="aprov-hdr"><div><div class="aprov-nome">${esc(col?.nome||a.username)}</div><div class="aprov-meta">${esc(loc?.nome||a.localId)} · ${assFormatarData(a.data)} · ${esc(tipoLabel)}</div></div><span style="font-size:.75rem;font-weight:600;color:${a.estado==='pendente'?'#d97706':a.estado==='aprovado'?'#00a878':'var(--danger)'}">${esc(a.estado)}</span></div><div class="aprov-motivo">${esc(a.motivo)}</div>${horasLinha}${linksMovel}${a.estado==='pendente'?`<button class="btn-sm teal" onclick="abrirDecisao('${a.id}')">Decidir</button>`:`<div style="font-size:.75rem;color:var(--text-muted)">Decidido por ${esc(a.decididoPor)}: ${esc(a.notaDecisao)}</div>`}</div>`;}).join('');
}

function renderAprovacoesBadge(count) {
  const b = document.getElementById('badge-aprov');
  if (!b) return;
  if (count) { b.textContent = count; b.style.display = 'inline'; }
  else { b.textContent = ''; b.style.display = 'none'; }
}

// 2026-09-12 (2ª ronda de auditoria): esta chamada contornava o
// fetchComRetry/assApi que o resto do ficheiro usa — um fetch cru, sem
// qualquer tentativa extra, que falhava em silêncio (catch vazio) numa rede
// instável, deixando o badge desactualizado sem se notar. Passa a usar
// fetchComRetry directamente (não assApi, porque esta chamada corre em
// segundo plano e não deve mostrar o ecrã de "A processar…") com 2
// tentativas — chega para um badge, sem gastar demasiado tempo.
async function carregarAprovacoesBadge() {
  try {
    const r = await fetchComRetry(ASS_URL, {
      acao:'listarAprovacoes', filtros:{estado:'pendente'},
      username: SESSION.username, password: SESSION.password
    }, 2);
    if (r.ok) renderAprovacoesBadge(r.aprovacoes.length);
  } catch(_) {}
}

function abrirDecisao(id) {
  DECISAO_ATUAL = APROVACOES_CACHE.find(a => a.id === id) || null;
  document.getElementById('decisao-id').value=id; document.getElementById('decisao-nota').value=''; document.getElementById('decisao-err').style.display='none';
  atualizarAjusteHora();
  document.getElementById('modal-decisao').classList.add('open');
}
// Constrói a lista de opções de 30 em 30 min entre o horário original e o valor
// pedido, para o dropdown "Hora a considerar" do modal de decisão. Cada tipo tem
// uma regra ligeiramente diferente sobre quais extremos entram na lista — está
// tudo confirmado com exemplos reais, não é uma fórmula "inventada":
//  - entrada tardia / pedido de hora extra: exclui o horário original (nunca se
//    pode "perdoar tudo"), inclui o valor pedido (penalização/crédito máximo).
//  - saída antecipada: exclui o valor pedido (esse é só o valor de "Rejeitado"),
//    inclui o horário original (perdão total é uma opção aqui).
//  - pedido de entrada antecipada: inclui os dois extremos.
function assConstruirListaAjuste(tipo, valorOriginalMin, valorPedidoMin) {
  const min = Math.min(valorOriginalMin, valorPedidoMin);
  const max = Math.max(valorOriginalMin, valorPedidoMin);
  const inicio = (tipo === 'pedido_entrada_antecipada') ? min : (min + 30);
  const opcoes = [];
  for (let v = inicio; v <= max; v += 30) opcoes.push(v);
  return opcoes.length ? opcoes : [max]; // salvaguarda: nunca fica uma lista vazia
}

// Extrai a hora real (HH:MM) embutida no texto do motivo, ex: "Entrada às 09:39
// (previsto 09:30)" → 579 (minutos). Evita precisar de uma coluna nova na Sheet
// só para guardar a hora real em bruto — já está lá, no texto.
function assExtrairMinutosDoMotivo(motivo) {
  const m = /(\d{2}):(\d{2})/.exec(motivo || '');
  if (!m) return null;
  return Number(m[1])*60 + Number(m[2]);
}

function atualizarAjusteHora() {
  const decisao = document.getElementById('decisao-tipo').value;
  const bloco = document.getElementById('fg-ajuste-hora');
  const TIPOS_AJUSTE = ['entrada_fora_janela','saida_fora_janela','pedido_hora_extra','pedido_entrada_antecipada'];
  const mostrar = decisao==='aprovado' && DECISAO_ATUAL && TIPOS_AJUSTE.includes(DECISAO_ATUAL.tipo);
  if (mostrar) {
    const original = Number(DECISAO_ATUAL.valorOriginalMin);
    const pedido = Number(DECISAO_ATUAL.valorPedidoMin);
    let opcoes = assConstruirListaAjuste(DECISAO_ATUAL.tipo, original, pedido);

    // Exceção de benevolência: entrada tardia até 15 min de atraso — o horário
    // original passa também a ser uma opção (perdão total), além da lista normal.
    // Acima de 15 min, só a lista normal (sem o horário original).
    if (DECISAO_ATUAL.tipo === 'entrada_fora_janela') {
      const realMin = assExtrairMinutosDoMotivo(DECISAO_ATUAL.motivo);
      if (realMin !== null && (realMin - original) <= 15 && !opcoes.includes(original)) {
        opcoes = [original, ...opcoes];
      }
    }

    document.getElementById('decisao-ajuste').innerHTML =
      opcoes.map(v => `<option value="${v}">${minParaHora(v)}</option>`).join('');
    bloco.style.display='';
  } else {
    bloco.style.display='none';
  }
}

async function confirmarDecisao() {
  const err=document.getElementById('decisao-err'); err.style.display='none';
  const id=document.getElementById('decisao-id').value, decisao=document.getElementById('decisao-tipo').value, nota=document.getElementById('decisao-nota').value.trim();
  if (!nota) { err.textContent='Nota obrigatória.'; err.style.display='block'; return; }
  const payload = {acao:'decidirAprovacao', id, decisao, nota};
  const blocoAjuste = document.getElementById('fg-ajuste-hora');
  if (blocoAjuste.style.display !== 'none') {
    payload.valorAjustadoMin = Number(document.getElementById('decisao-ajuste').value);
  }
  const r=await assApi(payload);
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  DECISAO_ATUAL = null;
  closeModal('modal-decisao'); carregarAprovacoes(); carregarAprovacoesBadge();
}

// ═══════════════════════════════════════
//  MAPA MENSAL
// ═══════════════════════════════════════
// anoElId/contElId: por omissão usa o painel de Gestão (master/coordenador);
// a vista de auto-serviço "Férias" (2026-09-10) chama isto com os IDs do seu
// próprio painel ('mapaferiascolab-ano'/'mapaferiascolab-conteudo') para
// reaproveitar a mesma renderização sem colidir com o painel de Gestão.
async function carregarMapaFerias(anoElId, contElId) {
  anoElId = anoElId || 'mapaferias-ano';
  contElId = contElId || 'mapaferias-conteudo';
  const ano = document.getElementById(anoElId).value;
  const cont = document.getElementById(contElId);
  if (!ano) { cont.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Indique um ano.</div>'; return; }
  const r = await assApi({acao:'mapaFerias', ano});
  if (!r.ok) { cont.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--danger)">${r.erro||'Erro ao carregar.'}</div>`; return; }
  if (!r.colaboradores.length) { cont.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem colaboradores activos.</div>'; return; }

  const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const ICONE = {ferias:'🏖', baixa_medica:'🏥', licenca:'📄', outro:'❓'};

  const primeiroDiaMes = (a,m) => `${a}-${String(m+1).padStart(2,'0')}-01`;
  const ultimoDiaMes = (a,m) => { const d = new Date(Number(a), m+1, 0); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  const thMeses = MESES_ABREV.map(m=>`<th style="padding:4px 3px;font-size:.68rem;text-align:center;border:1px solid #ddd;min-width:80px">${m}</th>`).join('');
  const thTotais = `<th style="padding:4px 6px;font-size:.68rem;text-align:center;border:1px solid #ddd;background:#f0fafa">🏖 Dias</th><th style="padding:4px 6px;font-size:.68rem;text-align:center;border:1px solid #ddd;background:#f0fafa">🏥 Dias</th><th style="padding:4px 6px;font-size:.68rem;text-align:center;border:1px solid #ddd;background:#f0fafa">📄 Dias</th><th style="padding:4px 6px;font-size:.68rem;text-align:center;border:1px solid #ddd;background:#f0fafa">❓ Dias</th>`;

  const tdTotais = t => `<td style="padding:4px 6px;font-size:.75rem;text-align:center;border:1px solid #ddd;background:#f7fdfd;font-weight:600">${t.ferias||'–'}</td><td style="padding:4px 6px;font-size:.75rem;text-align:center;border:1px solid #ddd;background:#f7fdfd;font-weight:600">${t.baixa_medica||'–'}</td><td style="padding:4px 6px;font-size:.75rem;text-align:center;border:1px solid #ddd;background:#f7fdfd;font-weight:600">${t.licenca||'–'}</td><td style="padding:4px 6px;font-size:.75rem;text-align:center;border:1px solid #ddd;background:#f7fdfd;font-weight:600">${t.outro||'–'}</td>`;

  const trLinhas = r.colaboradores.map(col => {
    const tds = MESES_ABREV.map((_,i) => {
      const pIni = primeiroDiaMes(ano,i), pFim = ultimoDiaMes(ano,i);
      const relevantes = col.ausencias.filter(a => a.dataFim>=pIni && a.dataInicio<=pFim);
      if (!relevantes.length) return '<td style="border:1px solid #eee;padding:3px"></td>';
      const badges = relevantes.map(a => {
        const pendente = a.estado==='pendente';
        const dIniFmt = a.dataInicio.slice(8,10)+'/'+a.dataInicio.slice(5,7);
        const dFimFmt = a.dataFim.slice(8,10)+'/'+a.dataFim.slice(5,7);
        const estilo = pendente
          ? 'border:1px dashed var(--teal);color:var(--teal);background:transparent'
          : 'background:var(--teal-pale);color:var(--teal)';
        return `<div title="${esc(a.localNome)} · ${esc(a.diasUteis)} dia(s) útil(eis) · ${esc(a.estado)}" style="font-size:.62rem;border-radius:4px;padding:1px 4px;margin-bottom:2px;white-space:nowrap;${estilo}">${ICONE[a.tipo]||'❓'} ${dIniFmt}–${dFimFmt}</div>`;
      }).join('');
      return `<td style="border:1px solid #eee;padding:3px;vertical-align:top">${badges}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 8px;font-weight:600;font-size:.78rem;border:1px solid #ddd;white-space:nowrap;background:#fafafa">${esc(col.nome)}</td>${tdTotais(col.totais)}${tds}</tr>`;
  }).join('');

  const tg = r.totaisGerais || {ferias:0,baixa_medica:0,licenca:0,outro:0};
  const trTotalGeral = `<tr style="background:var(--teal-pale)"><td style="padding:4px 8px;font-weight:800;font-size:.78rem;border:1px solid #ddd">TOTAL GERAL</td>${tdTotais(tg)}<td colspan="12" style="border:1px solid #ddd"></td></tr>`;

  cont.innerHTML = `<table style="border-collapse:collapse;width:100%">
    <thead><tr style="background:var(--teal);color:white">
      <th style="padding:5px 8px;font-size:.75rem;text-align:left;border:1px solid #005f5f;white-space:nowrap">Colaborador</th>
      ${thTotais}
      ${thMeses}
    </tr></thead>
    <tbody>${trLinhas}${trTotalGeral}</tbody>
  </table>`;
}
window.carregarMapaFerias = carregarMapaFerias;

async function carregarMapa() {
  const localId=document.getElementById('mapa-local').value, mesAno=document.getElementById('mapa-mes').value;
  if (!mesAno) { alert('Seleciona um mês no Mapa Mensal.'); return; }
  const r=await assApi({acao:'mapaMenusal',mesAno,localId}); if (!r.ok) return;
  MAPA_CACHE=r;
  const container=document.getElementById('mapa-conteudo');
  if (!r.colaboradores.length) { container.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted)">Sem registos neste período.</div>'; return; }
  container.innerHTML=`<div style="margin-bottom:1rem;font-size:.82rem;color:var(--text-muted)">Período: ${assFormatarData(r.periodoInicio)} a ${assFormatarData(r.periodoFim)}</div>
  <table class="tbl"><thead><tr><th>Colaborador</th><th>Normal</th><th>Nocturno</th><th>Sábado</th><th>Domingo</th><th>Feriado</th><th>1ª H. Extra</th><th>H. Extra Seg.</th><th>Total</th><th>Distribuição</th><th>🏖 Férias</th><th>🏥 Baixa</th><th>📄 Licença</th><th>❓ Outro</th></tr></thead><tbody>
  ${r.colaboradores.map(col=>{const t=col.totais,total=t.total||1,a=col.ausencias||{};return `<tr><td style="font-weight:700">${esc(col.nome)}</td><td>${minParaHoraH(t.normal)}</td><td style="color:#1e40af">${minParaHoraH(t.noturno)}</td><td style="color:#d97706">${minParaHoraH(t.sabado)}</td><td style="color:var(--danger)">${minParaHoraH(t.domingo)}</td><td style="color:#7c3aed">${minParaHoraH(t.feriado)}</td><td style="color:#dc2626">${minParaHoraH(t.extraPrimeira)}</td><td style="color:#f97316">${minParaHoraH(t.extraSubsequente)}</td><td style="font-weight:800">${minParaHoraH(t.total)}</td><td style="min-width:120px"><div class="hora-bar">${barra('normal',t.normal,total)}${barra('noturno',t.noturno,total)}${barra('sabado',t.sabado,total)}${barra('domingo',t.domingo,total)}${barra('feriado',t.feriado,total)}${barra('extraPrimeira',t.extraPrimeira,total)}${barra('extraSubsequente',t.extraSubsequente,total)}</div></td><td style="text-align:center">${a.ferias||0}</td><td style="text-align:center">${a.baixa_medica||0}</td><td style="text-align:center">${a.licenca||0}</td><td style="text-align:center">${a.outro||0}</td></tr>`;}).join('')}</tbody></table>`;
}

function barra(tipo,val,total) { if(!val) return ''; const pct=Math.round((val/total)*100); return `<div class="hora-seg ${tipo}" style="width:${pct}%" title="${tipo}: ${minParaHoraH(val)}"></div>`; }

// 2026-09-10, pedido do Ricardo: exportar para Excel (.xlsx) já formatado —
// cabeçalho a cor/negrito, larguras de coluna, dias de férias/baixa/licença
// juntos com as horas no mesmo ficheiro — em vez do .csv simples anterior.
// O ficheiro é montado no backend (fsExportarMapaMenusalExcel, usa uma folha
// de cálculo temporária para ter formatação real) e devolvido em base64;
// aqui só é preciso transformar isso num ficheiro e descarregar.
async function exportarExcel() {
  const localId=document.getElementById('mapa-local').value, mesAno=document.getElementById('mapa-mes').value;
  if (!mesAno) { alert('Seleciona um mês no Mapa Mensal.'); return; }
  const btn = document.getElementById('btn-exportar-excel');
  const textoOriginal = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'A gerar…'; }
  try {
    const r = await assApi({acao:'exportarMapaMenusalExcel', mesAno, localId});
    if (!r.ok) { alert(r.erro || 'Erro ao gerar o Excel.'); return; }
    const bin = atob(r.ficheiro);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=r.nomeFicheiro||`mapa_horas_${mesAno}.xlsx`; a.click();
    URL.revokeObjectURL(a.href);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

// ═══════════════════════════════════════
//  ESCALA PDF
// ═══════════════════════════════════════
// Modal PDF — acessível a todos os utilizadores
function abrirModalPDF() {
  const modal = document.getElementById('modal-escala-pdf');
  // Popular locais
  const sel = document.getElementById('pdf-modal-local');
  sel.innerHTML = '<option value="">Selecionar local…</option>';
  const popular = () => {
    LOCAIS_CACHE.forEach(l => sel.innerHTML += `<option value="${l.id}">${esc(l.nome)}</option>`);
    // Pré-seleccionar local do utilizador se existir
    if (SESSION && SESSION.localId) sel.value = SESSION.localId;
  };
  if (!LOCAIS_CACHE.length) carregarLocaisCache().then(popular); else popular();
  // Mês actual
  const inp = document.getElementById('pdf-modal-mes');
  if (!inp.value) { const h=new Date(); inp.value=h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0'); }
  modal.style.display = 'flex';
}

function fecharModalPDF() {
  document.getElementById('modal-escala-pdf').style.display = 'none';
}

async function gerarEscalaPDFModal() {
  const localId = document.getElementById('pdf-modal-local').value;
  const mesAno  = document.getElementById('pdf-modal-mes').value;
  if (!localId) { alert('Seleciona um local de trabalho.'); return; }
  if (!mesAno)  { alert('Seleciona o mês.'); return; }
  fecharModalPDF();
  await gerarEscalaPDFComDados(localId, mesAno);
}

async function gerarEscalaPDF() {
  const localId = document.getElementById('mapa-local').value;
  const mesAno  = document.getElementById('mapa-mes').value;
  if (!localId) { alert('Seleciona um local de trabalho no Mapa Mensal.'); return; }
  if (!mesAno)  { alert('Seleciona um mês no Mapa Mensal.'); return; }
  await gerarEscalaPDFComDados(localId, mesAno);
}

async function gerarEscalaPDFComDados(localId, mesAno) {

  // Garantir caches carregadas
  if (!TURNOS_CACHE.length) { const rt=await assApi({acao:'listarTurnosTipo'}); if(rt.ok) TURNOS_CACHE=rt.turnos; }
  if (!COLABORADORES_CACHE.length) await carregarColaboradoresCache();

  // Período 20-19: mês seleccionado 2026-05 → 20 Abr a 19 Mai
  const [ano, mes] = mesAno.split('-').map(Number);
  const inicio = new Date(ano, mes-2, 20, 12, 0, 0);
  const fim    = new Date(ano, mes-1, 19, 12, 0, 0);
  const anoInicio = inicio.getFullYear(), mesInicio = inicio.getMonth();

  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomMes = MESES[mes-1] + ' de ' + ano;
  const local  = LOCAIS_CACHE.find(l => l.id === localId);
  const nomLocal = local ? local.nome : localId;

  const fmt = d => String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  const periodoStr = fmt(inicio) + ' a ' + fmt(fim);
  const fmtISO = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const inicioStr = fmtISO(inicio);
  const fimStr    = fmtISO(fim);

  // Um único pedido para o período inteiro (em vez de um por semana em
  // paralelo) — evita gastar várias das execuções simultâneas partilhadas
  // do Apps Script de uma só vez (ver 12º seguimento, 2026-09-10).
  let respostaPeriodo = await assApi({acao:'gantPeriodo', localId, inicioStr, fimStr});
  for (let tentativa = 0; tentativa < 2 && !respostaPeriodo.ok; tentativa++) {
    await new Promise(r => setTimeout(r, 900));
    respostaPeriodo = await assApi({acao:'gantPeriodo', localId, inicioStr, fimStr});
  }
  if (!respostaPeriodo.ok) {
    alert('Não foi possível carregar os dados deste período (falha de ligação temporária). O PDF não foi gerado — tenta novamente.');
    return;
  }

  // Consolidar dias do período
  const diasMes = {};
  for (const d of respostaPeriodo.dias) diasMes[d.dia] = d;

  const diasOrdenados = Object.keys(diasMes).sort();

  // Todos os colaboradores presentes no período
  const colsMap = new Map();
  for (const dia of diasOrdenados) {
    for (const c of (diasMes[dia].colaboradores || [])) {
      if (!colsMap.has(c.username)) colsMap.set(c.username, c.nome || c.username);
    }
  }
  const cols = [...colsMap.entries()].map(([username, nome]) => ({username, nome}));

  // Turnos presentes neste local neste período
  const turnosUsados = new Map();
  for (const dia of diasOrdenados) {
    for (const c of (diasMes[dia].colaboradores || [])) {
      if (c.turno && !turnosUsados.has(c.turno.id)) {
        turnosUsados.set(c.turno.id, c.turno);
      }
    }
  }
  // Completar com info detalhada do TURNOS_CACHE (pausas, etc.)
  const turnosDetalhados = [...turnosUsados.values()].map(t => {
    const cached = TURNOS_CACHE.find(x => x.id === t.id) || t;
    return cached;
  }).sort((a,b) => (a.inicioMin||0) - (b.inicioMin||0));

  const DIAS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const corBg = dia => { const dow = new Date(dia+'T12:00:00').getDay(); return dow===0?'#fde8e8':dow===6?'#fef9e7':'#fff'; };
  const durMin = (ini, fim) => { let d = fim - ini; if(d<0) d+=1440; return d; };
  const hm = min => { const h=Math.floor(min/60),m=min%60; return h+'h'+(m?String(m).padStart(2,'0'):''); };

  // ── SECÇÃO 1: Ficha de Turnos ──
  const fichaLinhas = turnosDetalhados.length ? turnosDetalhados.map(t => {
    const durBruta = durMin(t.inicioMin||0, t.fimMin||0);
    const durPausa1 = (t.pausa1InicioMin!=='' && t.pausa1FimMin!=='') ? durMin(t.pausa1InicioMin,t.pausa1FimMin) : 0;
    const durPausa2 = (t.pausa2InicioMin!=='' && t.pausa2FimMin!=='') ? durMin(t.pausa2InicioMin,t.pausa2FimMin) : 0;
    const durPausa3 = (t.pausa3InicioMin!=='' && t.pausa3FimMin!=='') ? durMin(t.pausa3InicioMin,t.pausa3FimMin) : 0;
    const dur = Math.max(0, durBruta - durPausa1 - durPausa2 - durPausa3);
    const pausas = [
      (t.pausa1Label && t.pausa1InicioMin!=='' && t.pausa1FimMin!=='') ? `${t.pausa1Label}: ${minParaHora(t.pausa1InicioMin)}–${minParaHora(t.pausa1FimMin)} (${hm(durPausa1)})` : null,
      (t.pausa2Label && t.pausa2InicioMin!=='' && t.pausa2FimMin!=='') ? `${t.pausa2Label}: ${minParaHora(t.pausa2InicioMin)}–${minParaHora(t.pausa2FimMin)} (${hm(durPausa2)})` : null,
      (t.pausa3Label && t.pausa3InicioMin!=='' && t.pausa3FimMin!=='') ? `${t.pausa3Label}: ${minParaHora(t.pausa3InicioMin)}–${minParaHora(t.pausa3FimMin)} (${hm(durPausa3)})` : null,
    ].filter(Boolean);
    return `<tr>
      <td style="padding:2px 6px;font-weight:700;font-size:.62rem;border:1px solid #ccc;white-space:nowrap">${esc(t.nome)||'—'}</td>
      <td style="padding:2px 6px;font-size:.62rem;border:1px solid #ccc;text-align:center;font-weight:600;color:#007878">${minParaHora(t.inicioMin||0)}</td>
      <td style="padding:2px 6px;font-size:.62rem;border:1px solid #ccc;text-align:center;font-weight:600;color:#007878">${minParaHora(t.fimMin||0)}</td>
      <td style="padding:2px 6px;font-size:.62rem;border:1px solid #ccc;text-align:center">${hm(dur)}</td>
      <td style="padding:2px 6px;font-size:.58rem;border:1px solid #ccc;color:#555">${pausas.join('<br>')||'—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:6px;text-align:center;color:#999;font-size:.62rem;border:1px solid #ccc">Sem turnos definidos para este local neste período.</td></tr>`;

  // ── SECÇÃO 2: Grelha Colaboradores × Dias (tabela única, condensada) ──
  const thDias = diasOrdenados.map(dia => {
    const d = new Date(dia+'T12:00:00');
    const bg = corBg(dia);
    return `<th style="min-width:24px;width:24px;padding:2px 1px;text-align:center;font-size:.56rem;background:${bg};border:1px solid #ccc;line-height:1.2;color:#111">
      <div style="font-weight:700;color:#111">${d.getDate()}</div>
      <div style="color:#666;font-weight:400;font-size:.48rem">${DIAS_PT[d.getDay()]}</div>
    </th>`;
  }).join('');

  const trColabs = cols.length ? cols.map(col => {
    const celdas = diasOrdenados.map(dia => {
      const dInfo = diasMes[dia];
      const info  = dInfo?.colaboradores.find(c => c.username === col.username);
      const bg    = corBg(dia);
      let label = '–', cor = '#ccc', title = '';
      if (info?.emFerias) { label = {ferias:'🏖',baixa_medica:'🏥',licenca:'📄',outro:'❓'}[info.tipoAusencia]||'🏖'; cor='transparent'; }
      else if (info?.turno && !info.folga) {
        label = info.turno.nome || minParaHora(info.turno.inicioMin);
        cor = info.especial ? '#d97706' : '#007878';
        title = `${info.turno.nome}: ${minParaHora(info.turno.inicioMin)}–${minParaHora(info.turno.fimMin)}`;
      }
      return `<td style="text-align:center;font-size:.5rem;padding:2px 1px;border:1px solid #ddd;background:${bg}" title="${esc(title)}">
        ${label==='–'?'<span style="color:#ddd">–</span>':`<span style="color:${cor};font-weight:700">${esc(label)}</span>`}
      </td>`;
    }).join('');
    return `<tr>
      <td style="padding:2px 6px;font-weight:600;font-size:.64rem;border:1px solid #ccc;white-space:nowrap;background:#fafafa">${esc(col.nome)}</td>
      ${celdas}
    </tr>`;
  }).join('') : `<tr><td colspan="${diasOrdenados.length+1}" style="padding:6px;text-align:center;color:#999;font-size:.7rem;border:1px solid #ccc">Sem colaboradores atribuídos neste período.</td></tr>`;

  // ── SECÇÃO 3: Trocas / Alterações ──
  const linhasTrocas = Array.from({length:6}, (_,i) =>
    `<tr style="height:15px">
      <td style="border:1px solid #ccc;padding:1px 5px;font-size:.58rem;color:#bbb;text-align:center">${i+1}</td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
    </tr>`
  ).join('');

  const hoje = new Date().toLocaleDateString('pt-PT');

  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;color:#111;font-size:8.5pt;line-height:1.25">
      <!-- CABEÇALHO -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #007878;padding-bottom:5px;margin-bottom:8px">
        <div>
          <div style="font-size:11pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:-.01em">Arpuro &amp; Redemóvel, Lda</div>
          <div style="font-size:6.5pt;color:#555;margin-top:1px">NIPC 503 198 749 &nbsp;·&nbsp; Mapa de Trabalho para Afixação Obrigatória</div>
          <div style="font-size:7.5pt;font-weight:700;color:#333;margin-top:2px">📍 ${nomLocal}</div>
          <div style="font-size:6.5pt;color:#666;margin-top:1px">Período: <strong>${periodoStr}</strong> &nbsp;·&nbsp; Escala de ${nomMes}</div>
        </div>
        <div style="text-align:right;font-size:6pt;color:#999;line-height:1.5;border:1px solid #eee;padding:3px 7px;border-radius:5px">
          <div style="font-weight:700;color:#555">Emitido em ${hoje}</div>
          <div>Portal Redemóvel</div>
          <div style="margin-top:2px;font-size:5.5pt">Art.º 215.º CT — Afixar no local de trabalho</div>
        </div>
      </div>
      <!-- SECÇÃO A: FICHA DE TURNOS -->
      <div style="font-size:7pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;margin-top:2px">
        A — Definição de Turnos
      </div>
      <table style="border-collapse:collapse;width:100%;margin-bottom:8px">
        <thead>
          <tr style="background:#007878;color:white">
            <th style="padding:2px 6px;font-size:.6rem;text-align:left;border:1px solid #005f5f">Designação do Turno</th>
            <th style="padding:2px 6px;font-size:.6rem;text-align:center;border:1px solid #005f5f">Entrada</th>
            <th style="padding:2px 6px;font-size:.6rem;text-align:center;border:1px solid #005f5f">Saída</th>
            <th style="padding:2px 6px;font-size:.6rem;text-align:center;border:1px solid #005f5f">Duração&nbsp;líquida</th>
            <th style="padding:2px 6px;font-size:.6rem;text-align:left;border:1px solid #005f5f">Pausas / Intervalos</th>
          </tr>
        </thead>
        <tbody>${fichaLinhas}</tbody>
      </table>
      <!-- SECÇÃO B: GRELHA DE ATRIBUIÇÃO -->
      <div style="font-size:7pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">
        B — Atribuição de Turnos por Colaborador
      </div>
      <div style="overflow-x:auto;margin-bottom:10px">
        <table style="border-collapse:collapse;width:100%;table-layout:fixed">
          <thead>
            <tr style="background:#007878;color:white">
              <th style="padding:3px 6px;font-size:.64rem;text-align:left;border:1px solid #005f5f;white-space:nowrap;min-width:110px">Nome Completo</th>
              ${thDias}
            </tr>
          </thead>
          <tbody>${trColabs}</tbody>
        </table>
      </div>
      <div style="font-size:6pt;color:#888;margin-bottom:8px">
        🏖 Férias &nbsp;·&nbsp; <span style="color:#007878;font-weight:700">■</span> Turno normal &nbsp;·&nbsp; <span style="color:#d97706;font-weight:700">■</span> Turno especial &nbsp;·&nbsp; – Folga/não atribuído &nbsp;·&nbsp; <span style="background:#fde8e8;padding:0 3px">Domingo</span> &nbsp;·&nbsp; <span style="background:#fef9e7;padding:0 3px">Sábado</span>
      </div>
      <!-- SECÇÃO C: TROCAS -->
      <div style="font-size:7pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">
        C — Trocas e Alterações de Turno
      </div>
      <table style="border-collapse:collapse;width:100%;margin-bottom:10px">
        <thead>
          <tr style="background:#f0fafa">
            <th style="border:1px solid #ccc;padding:2px 5px;font-size:.58rem;width:18px;text-align:center">#</th>
            <th style="border:1px solid #ccc;padding:2px 5px;font-size:.58rem">Data</th>
            <th style="border:1px solid #ccc;padding:2px 5px;font-size:.58rem">Colaborador (cede turno)</th>
            <th style="border:1px solid #ccc;padding:2px 5px;font-size:.58rem">Colaborador (assume turno)</th>
            <th style="border:1px solid #ccc;padding:2px 5px;font-size:.58rem">Turno</th>
            <th style="border:1px solid #ccc;padding:2px 5px;font-size:.58rem">Ass. Responsável</th>
          </tr>
        </thead>
        <tbody>${linhasTrocas}</tbody>
      </table>
      <!-- RODAPÉ LEGAL -->
      <div style="border-top:1px solid #007878;padding-top:5px;display:flex;justify-content:space-between;align-items:flex-end">
        <div style="font-size:6pt;color:#555">
          <div style="font-weight:700">Responsável pelo estabelecimento:</div>
          <div style="margin-top:10px;border-top:1px solid #555;width:160px;padding-top:2px;font-size:5.5pt;color:#888">Assinatura e data</div>
        </div>
        <div style="font-size:5.5pt;color:#bbb;text-align:right">
          <div>Arpuro &amp; Redemóvel, Lda · NIPC 503 198 749</div>
          <div>Gerado automaticamente pelo Portal Redemóvel · ${hoje}</div>
        </div>
      </div>
    </div>
  `;

  // Gerar o PDF diretamente (sem popup nem impressão manual) — usa html2pdf.js
  // Invólucro com altura zero: esconde visualmente o conteúdo (nada aparece no ecrã)
  // sem o tirar das coordenadas normais da página — posicionar com left:-9999px
  // confundia o html2canvas e produzia uma captura em branco.
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'height:0;overflow:hidden;';
  const container = document.createElement('div');
  // Largura já ajustada para caber numa página A4 paisagem (297mm) menos margens, a ~96dpi.
  // Tentar "encolher depois" com CSS zoom baralhava o texto (mau suporte no html2canvas) —
  // é mais fiável dar-lhe logo a largura certa e deixar as tabelas (width:100%) ajustarem-se.
  container.style.cssText = 'width:1000px;background:#fff;padding:1.2cm;font-family:Outfit,Arial,sans-serif;color:#111';
  container.innerHTML = html;
  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  const nomeFicheiro = `Escala_${nomLocal.replace(/[^a-zA-Z0-9]+/g,'_')}_${nomMes.replace(/\s+/g,'_')}.pdf`;

  try {
    await html2pdf().set({
      margin: 8,
      filename: nomeFicheiro,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['avoid-all','css','legacy'] }
    }).from(container).save();
  } catch(e) {
    alert('Erro ao gerar o PDF: ' + (e && e.message ? e.message : e));
  } finally {
    document.body.removeChild(wrapper);
  }
}


function minParaHora(min) { const h=Math.floor(Number(min)/60),m=Number(min)%60; return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
function minParaHoraH(min) { const m=Number(min),h=Math.floor(m/60),r=m%60; return r>0?`${h}h${String(r).padStart(2,'0')}m`:`${h}h`; }
function minParaHoraInput(min) { return minParaHora(min); }
function horaParaMin(str) { if(!str) return ''; const [h,m]=str.split(':').map(Number); return h*60+m; }
function segundaFeira(d) { const dt=new Date(d),dow=dt.getDay(),diff=dow===0?-6:1-dow; dt.setDate(dt.getDate()+diff); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }

// ═══════════════════════════════════════
//  REGRAS E RGPD — leitura obrigatória (2026-09-09)
// ═══════════════════════════════════════
// REGRAS_VERSAO: bump manual sempre que o texto em #view-regras (HTML) mudar
// de forma substantiva — invalida as confirmações anteriores (ficam presas à
// versão antiga) e faz reaparecer o aviso "por confirmar" para todos.
// IMPORTANTE: manter sincronizado com a constante homónima em registo-movel.html.
const REGRAS_VERSAO = 1;

// Devolve true/false consoante o colaborador já confirmou (ou não) a versão
// actual do texto — usado quer para actualizar a própria vista "Regras"
// (banner, info, botão de rodapé, badge no separador), quer por
// verificarRegrasGate() para decidir se bloqueia a navegação.
async function regrasActivar() {
  const r = await assApi({acao:'minhaConfirmacaoRegras', versao:REGRAS_VERSAO});
  // 2026-09-12 (correcção no mesmo dia): r.ok===false significa "não
  // conseguimos perguntar ao servidor" (falha de rede/timeout) — não é o
  // mesmo que o servidor responder "ainda não confirmaste". Antes desta
  // correcção, `r.ok && r.confirmado` tratava qualquer falha de rede como
  // "por confirmar", o que — combinado com o timeout de fetchComRetry —
  // chegou a mandar de volta para "Regras" um colaborador que já tinha
  // confirmado, só por causa de uma resposta lenta. Em caso de falha,
  // não mexe no aviso/badge existentes e não bloqueia a navegação.
  if (!r.ok) return true;
  const banner = document.getElementById('regras-banner-pendente');
  const info = document.getElementById('regras-confirmado-info');
  const badge = document.getElementById('badge-regras');
  const rodapePendente = document.getElementById('regras-confirmar-pendente-rodape');
  const rodapeFeito = document.getElementById('regras-confirmar-feito-rodape');
  const confirmado = !!r.confirmado;
  if (confirmado) {
    if (banner) banner.style.display = 'none';
    if (info) { info.style.display = 'block'; info.textContent = `✅ Confirmaste a leitura destas regras em ${r.confirmadoEm}.`; }
    if (badge) badge.style.display = 'none';
    if (rodapePendente) rodapePendente.style.display = 'none';
    if (rodapeFeito) rodapeFeito.style.display = 'block';
  } else {
    if (banner) banner.style.display = 'block';
    if (info) info.style.display = 'none';
    if (badge) badge.style.display = 'inline';
    if (rodapePendente) rodapePendente.style.display = '';
    if (rodapeFeito) rodapeFeito.style.display = 'none';
  }
  if (SESSION && (SESSION.role==='master'||SESSION.role==='coordenador_lojas')) {
    const painel = document.getElementById('panel-regras-confirmacoes');
    if (painel) painel.style.display = '';
    carregarConfirmacoesRegras();
  }
  return confirmado;
}

// Bloqueia a navegação a tudo excepto "Regras" enquanto o colaborador não
// confirmar a leitura da versão actual — chamado no arranque (enterDashboard).
// Devolve true se já está confirmado (nada bloqueado, pode prosseguir para
// mostrarVistaInicial()).
async function verificarRegrasGate() {
  const navList = document.getElementById('topbar-nav-list');
  const confirmado = await regrasActivar();
  if (!confirmado) {
    if (navList) navList.classList.add('regras-gate');
    const navBtn = document.querySelector('.nav-item.regras-nav-item');
    showView('regras', navBtn);
    return false;
  }
  if (navList) navList.classList.remove('regras-gate');
  return true;
}

async function confirmarLeituraRegras() {
  const btn = document.getElementById('btn-confirmar-regras');
  const erro = document.getElementById('regras-confirmar-erro');
  if (erro) erro.style.display = 'none';
  if (btn) { btn.disabled = true; btn.textContent = 'A confirmar…'; }
  let r;
  try {
    r = await assApi({acao:'confirmarLeituraRegras', versao:REGRAS_VERSAO});
  } catch (err) {
    r = { ok:false, erro: 'Falha de ligação ao servidor. Tenta novamente.' };
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Li e tomei conhecimento'; }
  if (!r.ok) {
    const msg = r.erro || 'Erro ao confirmar.';
    if (erro) { erro.textContent = '⚠ ' + msg; erro.style.display = 'block'; }
    else alert(msg);
    return;
  }
  await regrasActivar();
  const navList = document.getElementById('topbar-nav-list');
  if (navList) navList.classList.remove('regras-gate');
  await mostrarVistaInicial();
}

async function carregarConfirmacoesRegras() {
  if (!COLABORADORES_CACHE.length) await carregarColaboradoresCache();
  const r = await assApi({acao:'listarConfirmacoesRegras', versao:REGRAS_VERSAO});
  const container = document.getElementById('lista-confirmacoes-regras');
  if (!container) return;
  if (!r.ok) { container.innerHTML = `<div style="color:var(--danger)">${esc(r.erro)}</div>`; return; }
  const confirmadosSet = new Set(r.confirmacoes.map(c=>c.username));
  const linhas = COLABORADORES_CACHE.map(c => {
    const confirmado = confirmadosSet.has(c.username);
    const info = r.confirmacoes.find(x=>x.username===c.username);
    return `<tr><td style="font-weight:600">${esc(c.nome)}</td><td>${confirmado?`<span style="color:var(--success);font-weight:600">✓ Confirmado — ${esc(info.confirmadoEm)}</span>`:'<span style="color:var(--danger);font-weight:600">✗ Por confirmar</span>'}</td></tr>`;
  }).join('');
  const total = COLABORADORES_CACHE.length, feitos = confirmadosSet.size;
  container.innerHTML = `<div style="margin-bottom:.75rem;font-size:.82rem;color:var(--text-muted)">${feitos} de ${total} colaborador(es) confirmaram a leitura da versão actual.</div><table class="tbl"><thead><tr><th>Colaborador</th><th>Estado</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

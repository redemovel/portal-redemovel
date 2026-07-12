const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzD855AIX6BOudkvhvF3vI11dcmcaf2j5fWWKrTUUWGbHERSY-oqu8w4qCyuo-sYk_uKw/exec';

let SESSION = null;
let modalResetTarget = null;

// ═══════════════════════════════════════
//  INICIALIZAÇÃO
// ═══════════════════════════════════════
async function init() {
  setMsg('A verificar localização...');
  try {
    let ipPublico = 'desconhecido';
    try {
      const ipRes = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipRes.json();
      ipPublico = ipData.ip;
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
              // Restaurar view
              const savedView = sessionStorage.getItem('rmView');
              if (savedView && savedView !== 'dashboard') {
                const navBtn = document.querySelector(`.nav-item[onclick*="'${savedView}'"]`);
                showView(savedView, navBtn);
                if (savedView === 'assiduidade') assActivar();
                if (savedView === 'gestao') gestaoActivar();
              }
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
    if (res.ok) { SESSION={...SESSION, username:res.username, nome:res.nome, role:res.role, password}; sessionStorage.setItem('rmSession', JSON.stringify(SESSION)); enterDashboard(); }
    else showAlert(err, res.erro||'Erro de autenticação.');
  } catch(e) { showAlert(err,'Erro de ligação. Tente novamente.'); }
  btn.disabled=false; btn.textContent='Entrar no Portal';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('inp-pass').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  document.getElementById('inp-user').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('inp-pass').focus(); });
  init();

  // Auto-refresh quando o utilizador volta ao separador
  let ultimoRefresh = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !SESSION) return;
    // Não recarregar se voltou ao separador há menos de 10 segundos
    if (Date.now() - ultimoRefresh < 10000) return;
    ultimoRefresh = Date.now();
    refrescarVistaActual();
  });
});

// Recarrega os dados da vista actualmente visível — sem UI intrusiva
function refrescarVistaActual() {
  const vistaVisivel = document.querySelector('.view.active');
  if (!vistaVisivel) return;
  const id = vistaVisivel.id.replace('view-', '');

  try {
    if (id === 'assiduidade') { assCarregarPonto(); assCarregarProximosDias(); }
    else if (id === 'gestao') {
      const painelActivo = document.querySelector('.gestao-panel.active');
      if (!painelActivo) { carregarAprovacoesBadge(); return; }
      const pid = painelActivo.id.replace('gpanel-', '');
      if (pid === 'aprovacoes') carregarAprovacoes();
      else if (pid === 'ferias') carregarFerias();
      else if (pid === 'mapa') { if (document.getElementById('mapa-local').value && document.getElementById('mapa-mes').value) carregarMapa(); }
      else if (pid === 'horarios') { if (document.getElementById('hor-local').value && document.getElementById('hor-semana').value) carregarAmbasVistas(); if (typeof carregarAtribuicoes === 'function') carregarAtribuicoes(); }
      else if (pid === 'turnos') carregarTurnos();
      else if (pid === 'ips') carregarIPs();
      else if (pid === 'utilizadores') carregarUtilizadores();
      carregarAprovacoesBadge();
    }
    else if (id === 'dashboard') carregarAprovacoesBadge();
  } catch(_) {}
}

// ═══════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════
async function enterDashboard() {
  await sincronizarHoraServidor();
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
  if (SESSION.role==='master'||SESSION.role==='coordenador_lojas') {
    document.getElementById('nav-gestao').style.display='';
    carregarGestao();
  }
  buildChart(); startClock(); setPageDate();
}

function doLogout() {
  SESSION=null;
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
async function carregarGestao() { await carregarIPs(); await carregarUtilizadores(); }

async function carregarIPs() {
  const res=await api({acao:'listarIPs',ip:SESSION.ip,username:SESSION.username,password:SESSION.password});
  if (!res.ok) return;
  document.getElementById('ip-atual-gestao').textContent=SESSION.ip;
  const lista=document.getElementById('lista-ips'); lista.innerHTML='';
  res.ips.forEach(item=>{
    const div=document.createElement('div'); div.className='ip-item';
    const isAtual=item.ip===SESSION.ip;
    div.innerHTML=`<div class="ip-info"><div class="ip-local">${item.local}</div><div class="ip-addr">${item.ip}</div></div>${item.fixo?'<span class="ip-badge fixo">Fixo</span>':''}${isAtual?'<span class="ip-badge atual">Este PC</span>':''}${!item.fixo&&item.ativo?`<button class="btn-sm danger" onclick="desativarIP('${item.ip}','${item.local}')">Desativar</button>`:''}${!item.ativo?'<span style="font-size:0.7rem;color:var(--danger);font-weight:600;">Inativo</span>':''}`;
    lista.appendChild(div);
  });
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
async function carregarUtilizadores() {
  const res=await api({acao:'listarUtilizadores',ip:SESSION.ip,username:SESSION.username,password:SESSION.password});
  if (!res.ok) return;
  const lista=document.getElementById('lista-users'); lista.innerHTML='';
  res.utilizadores.forEach(u=>{
    const div=document.createElement('div'); div.className='user-item';
    div.innerHTML=`<div class="user-info"><div class="user-name-g">${u.nome}</div><div class="user-meta">@${u.username}</div></div><span class="role-badge ${u.role}">${roleLabel(u.role)}</span>${u.ativo?`<button class="btn-sm teal" onclick="abrirResetPass('${u.username}')">🔑 Reset</button>${u.username!==SESSION.username?`<button class="btn-sm danger" onclick="desativarUser('${u.username}')">Desativar</button>`:'`'}`:'<span style="font-size:0.7rem;color:var(--danger);font-weight:600;">Inativo</span>'}`;
    lista.appendChild(div);
  });
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
  if (res.ok) { SESSION.password=passNova; showAlert(suc,'Password alterada com sucesso!'); document.getElementById('pass-atual').value=''; document.getElementById('pass-nova').value=''; document.getElementById('pass-confirm').value=''; }
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
async function api(payload) {
  showGlobalLoading();
  try {
    const res=await fetch(SCRIPT_URL,{method:'POST',body:JSON.stringify(payload)});
    return await res.json();
  } finally {
    hideGlobalLoading();
  }
}
function roleLabel(role) { return {master:'Master',coordenador_lojas:'Coordenador Lojas',assistente_loja:'Assistente de Loja'}[role]||role; }
function showAlert(el,msg) { el.textContent=msg; el.style.display='block'; }
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
const ASS_URL = 'https://script.google.com/macros/s/AKfycbzD855AIX6BOudkvhvF3vI11dcmcaf2j5fWWKrTUUWGbHERSY-oqu8w4qCyuo-sYk_uKw/exec';
let ASS_REGISTO_HOJE = null;
let ASS_COLEGAS_CACHE = [];
let ASS_LOCAL_ID = null;
let ASS_TURNO_ID = null;
let ASS_CLOCK_OK = false;

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
    const res=await fetch(ASS_URL,{method:'POST',body:JSON.stringify({...payload,username:SESSION.username,password:SESSION.password})});
    return await res.json();
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

  const hoje=assDataHoje();

  // Calcular segunda-feira da semana de hoje
  const dt = new Date();
  const dow = dt.getDay();
  const segDt = new Date(dt);
  segDt.setDate(segDt.getDate() - ((dow + 6) % 7));
  const semanaInicio = segDt.getFullYear()+'-'+String(segDt.getMonth()+1).padStart(2,'0')+'-'+String(segDt.getDate()).padStart(2,'0');
  const CAMPOS_DIA = ['turnoDom','turnoSeg','turnoTer','turnoQua','turnoQui','turnoSex','turnoSab'];
  const campoDia = CAMPOS_DIA[dt.getDay()];

  // FASE 1a — chamadas críticas em paralelo (4 chamadas — sem registosColegas porque depende de localId)
  const [rAtrib, rHorTipo, rTurnos, rLoc] = await Promise.all([
    assApi({acao:'listarAtribuicoesSemana', filtros:{username:SESSION.username, semanaInicio}}),
    assApi({acao:'listarHorariosTipoSemanal'}),
    assApi({acao:'listarTurnosTipo'}),
    assApi({acao:'listarLocais'})
  ]);

  // Resolver turno e local de HOJE a partir das atribuições
  ASS_LOCAL_ID = null;
  ASS_TURNO_ID = null;
  if (rAtrib.ok && rAtrib.atribuicoes.length) {
    const atribHoje = rAtrib.atribuicoes[0]; // só uma atribuição por semana/utilizador
    ASS_LOCAL_ID = atribHoje.localId;
    if (rHorTipo.ok) {
      const horario = rHorTipo.horarios.find(h => h.id === atribHoje.horarioTipoId);
      if (horario) {
        const turnoIdHoje = horario[campoDia];
        if (turnoIdHoje) ASS_TURNO_ID = turnoIdHoje;
      }
    }
  }

  // Fallback: se não houver atribuição, usar 1º local
  if (!ASS_LOCAL_ID && rLoc.ok && rLoc.locais.length) ASS_LOCAL_ID = rLoc.locais[0].id;

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

  // FASE 1b — agora que ASS_LOCAL_ID está resolvido, podemos chamar registosColegas
  const rRegistos = await assApi({acao:'registosColegas', localId: ASS_LOCAL_ID});
  if (rRegistos.ok) {
    ASS_COLEGAS_CACHE = rRegistos.registos;
    ASS_REGISTO_HOJE = rRegistos.registos.find(x => x.username === SESSION.username && x.data === hoje) || null;
  }
  assAtualizarUI();

  // Mostrar listas (usam o cache, sem chamadas API extra)
  assMostrarMeusRegistos();
  assPopularFiltroColegas();
  assFiltraColegas();

  // FASE 2 — Próximos turnos (não bloqueia UI). Já temos rAtrib, rHorTipo, rTurnos em cache.
  ASS_DIAS_MOSTRADOS = 7;
  assCarregarProximosDias();
}

async function assCarregarTurno() {
  // No-op — o turno agora é resolvido directamente em assIniciar (mais rápido)
  return;
}

function assMinParaHora(min) { const h=Math.floor(Number(min)/60),m=Number(min)%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function assMinParaHoraH(min) {
  const m = Number(min);
  const h = Math.floor(m/60);
  const restoMin = m - h*60;
  return ((60 - restoMin) <= 5 ? h + 1 : h) + 'h';
}
function assDataHoje() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function assFormatarData(str) { if(!str) return '—'; const [a,m,d]=str.split('-'); return `${d}/${m}/${a}`; }
function assIniciais(nome) { if(!nome) return '?'; return nome.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase(); }

async function assCarregarPonto() {
  const r=await assApi({acao:'registosColegas',localId:ASS_LOCAL_ID});
  if (r.ok) {
    ASS_COLEGAS_CACHE = r.registos;
    const hoje=assDataHoje();
    ASS_REGISTO_HOJE=r.registos.find(x=>x.username===SESSION.username&&x.data===hoje)||null;
  }
  assAtualizarUI();
  assMostrarMeusRegistos();
  assPopularFiltroColegas();
  assFiltraColegas();
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

// assAcao — versão única com feedback visual e protecção anti-duplo-clique
async function assAcao(tipo) {
  // Confirmação antes de saída
  if (tipo==='saida') {
    const confirmado = await assConfirmarSaida();
    if (!confirmado) return;
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
    if (tipo==='entrada') { r=await assApi({acao:'registarEntrada',localId:ASS_LOCAL_ID}); }
    else if (tipo==='saida') { r=await assApi({acao:'registarSaida',localId:ASS_LOCAL_ID}); }
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
    document.getElementById('ass-ts-entrada').textContent=assMinParaHora(reg.entradaRealMin);
    document.getElementById('ass-ts-saida').textContent=temSaida?assMinParaHora(reg.saidaRealMin):'—';
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
async function assCarregarColegas() {
  // mantida por compatibilidade — chama assCarregarPonto que faz tudo
  return assCarregarPonto();
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
      ${regs.map(r=>`<div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;border-radius:10px;border:1px solid var(--gray-light);background:var(--off-white);margin-bottom:.4rem">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--teal-pale);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;color:var(--teal);flex-shrink:0">${assIniciais(r.nome)}</div>
        <div style="flex:1"><div style="font-weight:600;font-size:.85rem">${r.nome}</div><div style="font-size:.72rem;color:var(--text-muted);display:flex;gap:.75rem;margin-top:.1rem"><span>▶ ${r.entradaRealMin!==''?assMinParaHora(r.entradaRealMin):'—'}</span><span>⏹ ${r.saidaRealMin!==''?assMinParaHora(r.saidaRealMin):'—'}</span>${r.totalTrabalhadoMin?`<span>⏱ ${assMinParaHoraH(r.totalTrabalhadoMin)}</span>`:''}</div></div>
        <button onclick="assSinalizar('${r.username}','${r.nome}','${data}')" style="font-size:.72rem;font-weight:600;background:#fff3e0;color:#d97706;border:none;border-radius:6px;padding:.25rem .6rem;cursor:pointer;font-family:'Outfit',sans-serif">⚑ Sinalizar</button>
      </div>`).join('')}
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

  // Buscar atribuições do utilizador, todos os horarios tipo, todos os turnos — em paralelo
  const [rAtrib, rHorTipo, rTurnos] = await Promise.all([
    assApi({acao:'listarAtribuicoesSemana', filtros:{username: SESSION.username}}),
    assApi({acao:'listarHorariosTipoSemanal'}),
    assApi({acao:'listarTurnosTipo'})
  ]);

  if (!rAtrib.ok || !rHorTipo.ok || !rTurnos.ok) {
    container.innerHTML = '<div style="color:var(--danger);padding:1rem">Erro ao carregar.</div>';
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
            conteudoTurno = '<span style="background:var(--teal-pale);color:var(--teal);border-radius:5px;padding:2px 8px;font-weight:600;font-size:.78rem">'+t.nome+': '+minParaHora(t.inicioMin)+'–'+minParaHora(t.fimMin)+'</span>'
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
          ? assMinParaHora(ini) + '–' + assMinParaHora(fim)
          : assMinParaHora(ini) + '–em curso';
        pausas.push(txt);
      }
    }
    const entrada = reg.entradaRealMin !== '' ? assMinParaHora(reg.entradaRealMin) : '—';
    const saida = reg.saidaRealMin !== '' ? assMinParaHora(reg.saidaRealMin) : '—';
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

function assActivar() { if (SESSION) assIniciar(); }

// ═══════════════════════════════════════
//  GESTÃO — TABS
// ═══════════════════════════════════════
let LOCAIS_CACHE = [];
let COLABORADORES_CACHE = [];
let TURNOS_CACHE = [];
let HORARIOS_TIPO_CACHE = [];
let MAPA_CACHE = null;

function showGestaoTab(id, btn) {
  document.querySelectorAll('.gestao-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.gestao-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('gpanel-'+id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id==='turnos') carregarTurnos();
  if (id==='horarios') {
    const carregarHor=()=>{ popularSelectLocal('hor-local'); popularSelectLocal('at-local'); carregarHorariosTipo(); carregarAtribuicoes(); };
    if (!LOCAIS_CACHE.length) carregarLocaisCache().then(carregarHor);
    else carregarHor();
    const hor=document.getElementById('hor-semana');
    if (hor&&!hor.value) hor.value=segundaFeira(new Date());
    const horMes=document.getElementById('hor-mes');
    if (horMes&&!horMes.value) { const h=new Date(); horMes.value=h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0'); }
  }
  if (id==='ferias') { carregarFerias(); popularSelectLocal('fer-local'); popularColaboradoresSelect('fer-colaborador'); }
  if (id==='aprovacoes') carregarAprovacoes();
  if (id==='mapa') popularSelectLocal('mapa-local');
}
window.showGestaoTab = showGestaoTab;

async function gestaoActivar() {
  await Promise.all([carregarLocaisCache(),carregarColaboradoresCache()]);
  await Promise.all([carregarIPs(), carregarUtilizadores(), carregarAprovacoesBadge()]);
  const hor=document.getElementById('hor-semana'); if (hor) hor.value=segundaFeira(new Date());
  const mes=document.getElementById('mapa-mes'); if (mes) { const h=new Date(); mes.value=h.getFullYear()+'-'+String(h.getMonth()+1).padStart(2,'0'); }
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
  LOCAIS_CACHE.forEach(l=>s.innerHTML+=`<option value="${l.id}">${l.nome}</option>`);
}

function popularTodosSelects() {
  ['hor-local','hor-local-mes','at-local','fer-local','turno-local-sel','mapa-local'].forEach(popularSelectLocal);
}

function popularColaboradoresSelect(id) {
  const s=document.getElementById(id); if (!s) return;
  s.innerHTML='<option value="">Selecionar…</option>';
  COLABORADORES_CACHE.forEach(c=>s.innerHTML+=`<option value="${c.username}">${c.nome}</option>`);
}

// ═══════════════════════════════════════
//  TURNOS TIPO
// ═══════════════════════════════════════
async function carregarTurnos() {
  const r=await assApi({acao:'listarTurnosTipo'}); if (!r.ok) return;
  TURNOS_CACHE=r.turnos;
  const lista=document.getElementById('lista-turnos');
  if (!r.turnos.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem turnos criados.</div>'; return; }
  lista.innerHTML=`<table class="tbl"><thead><tr><th>Nome</th><th>Local</th><th>Início</th><th>Fim</th><th>Pausas</th><th></th></tr></thead><tbody>${r.turnos.map(t=>{const loc=LOCAIS_CACHE.find(l=>l.id===t.localId);const pausas=[t.pausa1Label,t.pausa2Label,t.pausa3Label].filter(Boolean).join(', ')||'—';return `<tr><td style="font-weight:700">${t.nome}</td><td>${loc?.nome||'—'}</td><td style="color:var(--teal);font-weight:600">${minParaHora(t.inicioMin)}</td><td style="color:var(--teal);font-weight:600">${minParaHora(t.fimMin)}</td><td style="font-size:.78rem;color:var(--text-muted)">${pausas}</td><td><button class="btn-sm teal" onclick="editarTurno('${t.id}')">✎</button> <button class="btn-sm danger" onclick="apagarTurno('${t.id}')">✕</button></td></tr>`;}).join('')}</tbody></table>`;
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
  lista.innerHTML=`<table class="tbl"><thead><tr><th>Nome</th><th>Seg</th><th>Ter</th><th>Qua</th><th>Qui</th><th>Sex</th><th>Sáb</th><th>Dom</th><th></th></tr></thead><tbody>${r.horarios.map(h=>{const celulas=CAMPOS.map(c=>{const t=TURNOS_CACHE.find(x=>x.id===h[c]);return `<td style="font-size:.75rem">${t?`<span style="background:var(--teal-pale);color:var(--teal);border-radius:5px;padding:2px 6px;font-weight:600">${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)}</span>`:'<span style="color:var(--gray-mid)">—</span>'}</td>`;}).join('');return `<tr><td style="font-weight:700">${h.nome}</td>${celulas}<td><button class="btn-sm teal" onclick="editarHorarioTipo('${h.id}')">✎</button> <button class="btn-sm danger" onclick="apagarHorarioTipo('${h.id}')">✕</button></td></tr>`;}).join('')}</tbody></table>`;
}

async function popularHorariosTipoSelect(selectId) {
  if (!HORARIOS_TIPO_CACHE.length) await carregarHorariosTipo();
  const s=document.getElementById(selectId); if (!s) return;
  s.innerHTML='<option value="">Selecionar horário tipo…</option>';
  HORARIOS_TIPO_CACHE.forEach(h=>s.innerHTML+=`<option value="${h.id}">${h.nome}</option>`);
}

function popularTurnosNosSelects(prefixo) {
  ['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].forEach(d=>{
    const s=document.getElementById(`${prefixo}turno${d}`); if (!s) return;
    s.innerHTML='<option value="">— Folga —</option>';
    TURNOS_CACHE.forEach(t=>s.innerHTML+=`<option value="${t.id}">${t.nome} (${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)})</option>`);
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
      if (!info || info.folga || !info.turno) {
        if (info && info.emFerias) {
          conteudo = '<div style="height:24px;display:flex;align-items:center;justify-content:flex-start;padding-left:.5rem"><span style="font-size:.7rem;background:#e0f2ff;color:#0369a1;border-radius:4px;padding:2px 8px">🏖 Férias</span></div>';
        } else {
          conteudo = '<div style="height:24px;display:flex;align-items:center;padding-left:.5rem;color:var(--text-muted);font-size:.7rem;font-style:italic">Folga</div>';
        }
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
        conteudo = '<div style="position:relative;height:24px;width:100%"><div style="position:absolute;left:' + pctInicio + '%;width:' + largura + '%;height:100%;background:' + cor + ';border-radius:4px;display:flex;align-items:center;overflow:hidden" title="' + t.nome + ': ' + minParaHora(t.inicioMin) + '–' + minParaHora(t.fimMin) + '">' + pausas + '<span style="font-size:.7rem;font-weight:700;color:white;padding:0 6px;white-space:nowrap;overflow:hidden">' + minParaHora(t.inicioMin) + '–' + minParaHora(t.fimMin) + '</span></div></div>';
      }
      return '<div style="display:grid;grid-template-columns:160px 1fr;border-bottom:1px solid var(--gray-light);background:var(--white)" onmouseover="this.style.background=\'var(--off-white)\'" onmouseout="this.style.background=\'var(--white)\'"><div style="padding:.4rem .75rem;font-size:.78rem;font-weight:600;border-right:1px solid var(--gray-light);display:flex;align-items:center">' + col.nome + '</div><div style="padding:.3rem .25rem;' + grelhaStyle + '">' + conteudo + '</div></div>';
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
  const localId=document.getElementById('hor-local-mes').value, mesAno=document.getElementById('hor-mes').value;
  if (!localId||!mesAno) return;
  const [ano,mes]=mesAno.split('-').map(Number);
  const anoInicio=ano, mesInicio=mes-1;
  const inicio=new Date(anoInicio,mesInicio,20,12,0,0);
  const fim=new Date(anoInicio,mesInicio+1,19,12,0,0);
  const inicioStr=inicio.getFullYear()+'-'+String(inicio.getMonth()+1).padStart(2,'0')+'-'+String(inicio.getDate()).padStart(2,'0');
  const fimStr=fim.getFullYear()+'-'+String(fim.getMonth()+1).padStart(2,'0')+'-'+String(fim.getDate()).padStart(2,'0');
  const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const dtFim=new Date(anoInicio,mesInicio+1,1);
  document.getElementById('gantt-mes-label').textContent=meses[dtFim.getMonth()]+' '+dtFim.getFullYear();
  const container=document.getElementById('gantt-mes-container');
  container.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted)">A carregar…</div>';
  // Segundas-feiras que cobrem o período 20-19
  const segundas=[], seg=new Date(inicio);
  seg.setDate(seg.getDate()-((seg.getDay()+6)%7));
  while (seg<=fim) { segundas.push(seg.getFullYear()+'-'+String(seg.getMonth()+1).padStart(2,'0')+'-'+String(seg.getDate()).padStart(2,'0')); seg.setDate(seg.getDate()+7); }
  const respostas=await Promise.all(segundas.map(s=>assApi({acao:'gantSemanal',localId,semanaInicio:s})));
  // Consolidar apenas dias do período
  const diasMes={};
  for (const r of respostas) {
    if (!r.ok) continue;
    for (const d of r.semana) {
      if (d.dia>=inicioStr&&d.dia<=fimStr) diasMes[d.dia]=d;
    }
  }
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
      if (!info||info.folga||!info.turno) {
        if (info?.emFerias) return `<div style="${fundo}border-right:1px solid var(--gray-light);min-width:28px;display:flex;align-items:center;justify-content:center;padding:.2rem 0"><span style="font-size:.55rem">🏖</span></div>`;
        return `<div style="${fundo}border-right:1px solid var(--gray-light);min-width:28px"></div>`;
      }
      const t=info.turno, cor=info.especial?'#f59e0b':'var(--teal)';
      const label=minParaHora(t.inicioMin).replace(':','h').replace(/^0/,'');
      return `<div style="${fundo}border-right:1px solid var(--gray-light);min-width:28px;padding:.2rem .1rem" title="${t.nome}: ${minParaHora(t.inicioMin)}–${minParaHora(t.fimMin)}"><div style="background:${cor};border-radius:3px;height:20px;display:flex;align-items:center;justify-content:center"><span style="font-size:.55rem;font-weight:700;color:white">${label}</span></div></div>`;
    }).join('');
    return `<div style="display:grid;grid-template-columns:110px repeat(${diasOrdenados.length},1fr);border-bottom:1px solid var(--gray-light);background:var(--white)" onmouseover="this.style.background='var(--off-white)'" onmouseout="this.style.background='var(--white)'"><div style="padding:.4rem .6rem;font-size:.75rem;font-weight:600;border-right:1px solid var(--gray-light);display:flex;align-items:center">${col.nome}</div>${celulas}</div>`;
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
  document.querySelector('#modal-atribuir .modal-title').textContent = 'Atribuir Horário à Semana';
  popularColaboradoresSelect('at-colaborador');
  popularSelectLocal('at-local');
  popularHorariosTipoSelect('at-horario-tipo');
  const semAtual=document.getElementById('hor-semana').value;
  if (semAtual) document.getElementById('at-semana').value=semAtual;
  document.getElementById('modal-atribuir').classList.add('open');
}

async function guardarAtribuicao() {
  const err=document.getElementById('atribuir-err'), ok=document.getElementById('atribuir-ok');
  err.style.display='none'; ok.style.display='none';
  const atribuicao={username:document.getElementById('at-colaborador').value,localId:document.getElementById('at-local').value,semanaInicio:document.getElementById('at-semana').value,horarioTipoId:document.getElementById('at-horario-tipo').value};
  if (!atribuicao.username||!atribuicao.localId||!atribuicao.semanaInicio||!atribuicao.horarioTipoId) { err.textContent='Preencha todos os campos.'; err.style.display='block'; return; }
  const editId = document.getElementById('modal-atribuir').dataset.editId;
  let r;
  if (editId) {
    r = await assApi({acao:'editarAtribuicaoSemana', id:editId, atribuicao});
  } else {
    r = await assApi({acao:'atribuirSemana', atribuicao});
  }
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  ok.textContent='✅ '+r.mensagem; ok.style.display='block';
  if (editId) {
    delete document.getElementById('modal-atribuir').dataset.editId;
    setTimeout(() => closeModal('modal-atribuir'), 1000);
  } else {
    document.getElementById('at-colaborador').value='';
  }
  carregarAmbasVistas();
  if (typeof carregarAtribuicoes === 'function') carregarAtribuicoes();
}

// ═══════════════════════════════════════
//  ATRIBUIÇÕES — listar / editar / apagar
// ═══════════════════════════════════════
async function carregarAtribuicoes() {
  const selColab = document.getElementById('atrib-filtro-colab');
  const selLocal = document.getElementById('atrib-filtro-local');
  if (selColab && !selColab.dataset.populated) {
    selColab.innerHTML = '<option value="">Todos</option>';
    COLABORADORES_CACHE.forEach(c => selColab.innerHTML += `<option value="${c.username}">${c.nome}</option>`);
    selColab.dataset.populated = '1';
  }
  if (selLocal && !selLocal.dataset.populated) {
    selLocal.innerHTML = '<option value="">Todos</option>';
    LOCAIS_CACHE.forEach(l => selLocal.innerHTML += `<option value="${l.id}">${l.nome}</option>`);
    selLocal.dataset.populated = '1';
  }
  const filtros = {};
  const fU = selColab?.value;       if (fU) filtros.username = fU;
  const fL = selLocal?.value;       if (fL) filtros.localId = fL;
  const fS = document.getElementById('atrib-filtro-semana')?.value; if (fS) filtros.semanaInicio = fS;
  const r = await assApi({acao:'listarAtribuicoesSemana', filtros});
  if (!r.ok) return;
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
        <td style="font-weight:600">${col?.nome || a.username}</td>
        <td>${loc?.nome || a.localId}</td>
        <td>${assFormatarData(semStr)}</td>
        <td><span style="background:var(--teal-pale);color:var(--teal);border-radius:5px;padding:2px 8px;font-weight:600;font-size:.78rem">${hor?.nome || a.horarioTipoId}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn-sm teal" onclick="editarAtribuicao('${a.id}')">✎ Editar</button>
          <button class="btn-sm danger" onclick="apagarAtribuicao('${a.id}','${(col?.nome||a.username).replace(/'/g,"\\'")}','${semStr}')">✕ Apagar</button>
        </td>
      </tr>`;
    }).join('')
  }</tbody></table>`;
}

function editarAtribuicao(id) {
  assApi({acao:'listarAtribuicoesSemana', filtros:{}}).then(r => {
    if (!r.ok) return;
    const a = r.atribuicoes.find(x => x.id === id);
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
    document.getElementById('modal-atribuir').dataset.editId = id;
    document.querySelector('#modal-atribuir .modal-title').textContent = 'Editar Atribuição';
    document.getElementById('modal-atribuir').classList.add('open');
  });
}

async function apagarAtribuicao(id, nomeColab, semana) {
  if (!confirm(`Apagar atribuição de ${nomeColab} para a semana de ${assFormatarData(semana)}?`)) return;
  const r = await assApi({acao:'apagarAtribuicaoSemana', id});
  if (!r.ok) { alert(r.erro || 'Erro ao apagar.'); return; }
  carregarAtribuicoes();
  carregarAmbasVistas();
}

// ═══════════════════════════════════════
//  FÉRIAS
// ═══════════════════════════════════════
async function carregarFerias() {
  const r=await assApi({acao:'listarFerias',filtros:{}}); if (!r.ok) return;
  const lista=document.getElementById('lista-ferias');
  if (!r.ferias.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem registos de férias.</div>'; return; }
  lista.innerHTML=`<table class="tbl"><thead><tr><th>Colaborador</th><th>Local</th><th>Início</th><th>Fim</th><th>Dias úteis</th><th>Estado</th><th></th></tr></thead><tbody>${r.ferias.map(f=>{const col=COLABORADORES_CACHE.find(c=>c.username===f.username),loc=LOCAIS_CACHE.find(l=>l.id===f.localId);const cor=f.estado==='aprovado'?'color:#00a878':f.estado==='rejeitado'?'color:var(--danger)':'color:#d97706';return `<tr><td style="font-weight:600">${col?.nome||f.username}</td><td>${loc?.nome||f.localId}</td><td>${assFormatarData(f.dataInicio)}</td><td>${assFormatarData(f.dataFim)}</td><td style="text-align:center;font-weight:700">${f.diasUteis}</td><td style="${cor};font-weight:600;font-size:.8rem">${f.estado}</td><td>${f.estado==='pendente'?`<button class="btn-sm teal" onclick="decidirFerias('${f.id}','aprovado')">✓</button> <button class="btn-sm danger" onclick="decidirFerias('${f.id}','rejeitado')">✕</button>`:'—'}</td></tr>`;}).join('')}</tbody></table>`;
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
  const ferias={username:document.getElementById('fer-colaborador').value,localId:document.getElementById('fer-local').value,dataInicio:document.getElementById('fer-inicio').value,dataFim:document.getElementById('fer-fim').value};
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
//  APROVAÇÕES
// ═══════════════════════════════════════
async function carregarAprovacoes() {
  const estado=document.getElementById('aprov-filtro')?.value||'pendente';
  const r=await assApi({acao:'listarAprovacoes',filtros:{estado:estado||undefined}}); if (!r.ok) return;
  const lista=document.getElementById('lista-aprovacoes');
  if (!r.aprovacoes.length) { lista.innerHTML='<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">Sem aprovações para mostrar.</div>'; return; }
  lista.innerHTML=r.aprovacoes.map(a=>{const col=COLABORADORES_CACHE.find(c=>c.username===a.username),loc=LOCAIS_CACHE.find(l=>l.id===a.localId);const tipoLabel={entrada_fora_janela:'⏰ Entrada fora de janela',saida_fora_janela:'⏰ Saída fora de janela'}[a.tipo]||a.tipo;return `<div class="aprov-card"><div class="aprov-hdr"><div><div class="aprov-nome">${col?.nome||a.username}</div><div class="aprov-meta">${loc?.nome||a.localId} · ${assFormatarData(a.data)} · ${tipoLabel}</div></div><span style="font-size:.75rem;font-weight:600;color:${a.estado==='pendente'?'#d97706':a.estado==='aprovado'?'#00a878':'var(--danger)'}">${a.estado}</span></div><div class="aprov-motivo">${a.motivo}</div>${a.estado==='pendente'?`<button class="btn-sm teal" onclick="abrirDecisao('${a.id}')">Decidir</button>`:`<div style="font-size:.75rem;color:var(--text-muted)">Decidido por ${a.decididoPor}: ${a.notaDecisao}</div>`}</div>`;}).join('');
}

async function carregarAprovacoesBadge() {
  // chamada silenciosa — não mostra loading
  try {
    const res = await fetch(ASS_URL, {method:'POST', body: JSON.stringify({
      acao:'listarAprovacoes', filtros:{estado:'pendente'},
      username: SESSION.username, password: SESSION.password
    })});
    const r = await res.json();
    const b = document.getElementById('badge-aprov');
    if (!b) return;
    if (r.ok && r.aprovacoes.length) {
      b.textContent = r.aprovacoes.length;
      b.style.display = 'inline';
    } else {
      b.textContent = '';
      b.style.display = 'none';
    }
  } catch(_) {}
}

function abrirDecisao(id) {
  document.getElementById('decisao-id').value=id; document.getElementById('decisao-nota').value=''; document.getElementById('decisao-err').style.display='none';
  document.getElementById('modal-decisao').classList.add('open');
}

async function confirmarDecisao() {
  const err=document.getElementById('decisao-err'); err.style.display='none';
  const id=document.getElementById('decisao-id').value, decisao=document.getElementById('decisao-tipo').value, nota=document.getElementById('decisao-nota').value.trim();
  if (!nota) { err.textContent='Nota obrigatória.'; err.style.display='block'; return; }
  const r=await assApi({acao:'decidirAprovacao',id,decisao,nota});
  if (!r.ok) { err.textContent=r.erro; err.style.display='block'; return; }
  closeModal('modal-decisao'); carregarAprovacoes(); carregarAprovacoesBadge();
}

// ═══════════════════════════════════════
//  MAPA MENSAL
// ═══════════════════════════════════════
async function carregarMapa() {
  const localId=document.getElementById('mapa-local').value, mesAno=document.getElementById('mapa-mes').value;
  if (!localId||!mesAno) return;
  const r=await assApi({acao:'mapaMenusal',mesAno,localId}); if (!r.ok) return;
  MAPA_CACHE=r;
  const container=document.getElementById('mapa-conteudo');
  if (!r.colaboradores.length) { container.innerHTML='<div style="text-align:center;padding:2rem;color:var(--text-muted)">Sem registos neste período.</div>'; return; }
  container.innerHTML=`<div style="margin-bottom:1rem;font-size:.82rem;color:var(--text-muted)">Período: ${assFormatarData(r.periodoInicio)} a ${assFormatarData(r.periodoFim)}</div>
  <table class="tbl"><thead><tr><th>Colaborador</th><th>Normal</th><th>Nocturno</th><th>Sábado</th><th>Domingo</th><th>Feriado</th><th>Extra</th><th>Total</th><th>Distribuição</th></tr></thead><tbody>
  ${r.colaboradores.map(col=>{const t=col.totais,total=t.total||1;return `<tr><td style="font-weight:700">${col.nome}</td><td>${minParaHoraH(t.normal)}</td><td style="color:#1e40af">${minParaHoraH(t.noturno)}</td><td style="color:#d97706">${minParaHoraH(t.sabado)}</td><td style="color:var(--danger)">${minParaHoraH(t.domingo)}</td><td style="color:#7c3aed">${minParaHoraH(t.feriado)}</td><td style="color:#dc2626">${minParaHoraH(t.extra)}</td><td style="font-weight:800">${minParaHoraH(t.total)}</td><td style="min-width:120px"><div class="hora-bar">${barra('normal',t.normal,total)}${barra('noturno',t.noturno,total)}${barra('sabado',t.sabado,total)}${barra('domingo',t.domingo,total)}${barra('feriado',t.feriado,total)}${barra('extra',t.extra,total)}</div></td></tr>`;}).join('')}</tbody></table>`;
}

function barra(tipo,val,total) { if(!val) return ''; const pct=Math.round((val/total)*100); return `<div class="hora-seg ${tipo}" style="width:${pct}%" title="${tipo}: ${minParaHoraH(val)}"></div>`; }

function exportarCSV() {
  if (!MAPA_CACHE) return;
  const linhas=['Colaborador;Normal;Noturno;Sábado;Domingo;Feriado;Extra;Total (horas)',...MAPA_CACHE.colaboradores.map(c=>{const t=c.totais,h=v=>(v/60).toFixed(2);return `${c.nome};${h(t.normal)};${h(t.noturno)};${h(t.sabado)};${h(t.domingo)};${h(t.feriado)};${h(t.extra)};${h(t.total)}`;})];
  const blob=new Blob([linhas.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`mapa_horas_${document.getElementById('mapa-mes').value}.csv`; a.click();
}

// ═══════════════════════════════════════
//  ESCALA PDF
// ═══════════════════════════════════════
function escalaPdfActivar() {}

// Modal PDF — acessível a todos os utilizadores
function abrirModalPDF() {
  const modal = document.getElementById('modal-escala-pdf');
  // Popular locais
  const sel = document.getElementById('pdf-modal-local');
  sel.innerHTML = '<option value="">Selecionar local…</option>';
  const popular = () => {
    LOCAIS_CACHE.forEach(l => sel.innerHTML += `<option value="${l.id}">${l.nome}</option>`);
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

  // Buscar semanas que cobrem o período
  const segundas = [];
  const seg = new Date(inicio);
  seg.setDate(seg.getDate() - ((seg.getDay()+6)%7));
  while (seg <= fim) { segundas.push(fmtISO(seg)); seg.setDate(seg.getDate()+7); }

  const respostas = await Promise.all(segundas.map(s => assApi({acao:'gantSemanal', localId, semanaInicio:s})));

  // Consolidar dias do período
  const diasMes   = {};
  for (const r of respostas) {
    if (!r.ok) continue;
    for (const d of r.semana) {
      if (d.dia >= inicioStr && d.dia <= fimStr) diasMes[d.dia] = d;
    }
  }

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
    const dur = durMin(t.inicioMin||0, t.fimMin||0);
    const pausas = [
      (t.pausa1Label && t.pausa1InicioMin!=='' && t.pausa1FimMin!=='') ? `${t.pausa1Label}: ${minParaHora(t.pausa1InicioMin)}–${minParaHora(t.pausa1FimMin)} (${hm(durMin(t.pausa1InicioMin,t.pausa1FimMin))})` : null,
      (t.pausa2Label && t.pausa2InicioMin!=='' && t.pausa2FimMin!=='') ? `${t.pausa2Label}: ${minParaHora(t.pausa2InicioMin)}–${minParaHora(t.pausa2FimMin)} (${hm(durMin(t.pausa2InicioMin,t.pausa2FimMin))})` : null,
      (t.pausa3Label && t.pausa3InicioMin!=='' && t.pausa3FimMin!=='') ? `${t.pausa3Label}: ${minParaHora(t.pausa3InicioMin)}–${minParaHora(t.pausa3FimMin)} (${hm(durMin(t.pausa3InicioMin,t.pausa3FimMin))})` : null,
    ].filter(Boolean);
    return `<tr>
      <td style="padding:5px 8px;font-weight:700;font-size:.75rem;border:1px solid #ccc;white-space:nowrap">${t.nome||'—'}</td>
      <td style="padding:5px 8px;font-size:.75rem;border:1px solid #ccc;text-align:center;font-weight:600;color:#007878">${minParaHora(t.inicioMin||0)}</td>
      <td style="padding:5px 8px;font-size:.75rem;border:1px solid #ccc;text-align:center;font-weight:600;color:#007878">${minParaHora(t.fimMin||0)}</td>
      <td style="padding:5px 8px;font-size:.75rem;border:1px solid #ccc;text-align:center">${hm(dur)}</td>
      <td style="padding:5px 8px;font-size:.7rem;border:1px solid #ccc;color:#555">${pausas.join('<br>')||'—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:8px;text-align:center;color:#999;font-size:.75rem;border:1px solid #ccc">Sem turnos definidos para este local neste período.</td></tr>`;

  // ── SECÇÃO 2: Grelha Colaboradores × Dias ──
  const thDias = diasOrdenados.map(dia => {
    const d = new Date(dia+'T12:00:00');
    const bg = corBg(dia);
    return `<th style="min-width:26px;width:26px;padding:2px 1px;text-align:center;font-size:.56rem;background:${bg};border:1px solid #ccc;line-height:1.3">
      <div style="font-weight:700">${d.getDate()}</div>
      <div style="color:#777;font-weight:400">${DIAS_PT[d.getDay()]}</div>
    </th>`;
  }).join('');

  const trColabs = cols.length ? cols.map(col => {
    const celdas = diasOrdenados.map(dia => {
      const dInfo = diasMes[dia];
      const info  = dInfo?.colaboradores.find(c => c.username === col.username);
      const bg    = corBg(dia);
      let label = '–', cor = '#ccc', title = '';
      if (info?.emFerias) { label = '🏖'; cor='transparent'; }
      else if (info?.turno && !info.folga) {
        label = info.turno.nome || minParaHora(info.turno.inicioMin);
        cor = info.especial ? '#d97706' : '#007878';
        title = `${info.turno.nome}: ${minParaHora(info.turno.inicioMin)}–${minParaHora(info.turno.fimMin)}`;
      }
      return `<td style="text-align:center;font-size:.54rem;padding:2px 1px;border:1px solid #ddd;background:${bg}" title="${title}">
        ${label==='–'?'<span style="color:#ddd">–</span>':`<span style="color:${cor};font-weight:700">${label}</span>`}
      </td>`;
    }).join('');
    return `<tr>
      <td style="padding:3px 8px;font-weight:600;font-size:.68rem;border:1px solid #ccc;white-space:nowrap;background:#fafafa">${col.nome}</td>
      ${celdas}
    </tr>`;
  }).join('') : `<tr><td colspan="${diasOrdenados.length+1}" style="padding:8px;text-align:center;color:#999;font-size:.75rem;border:1px solid #ccc">Sem colaboradores atribuídos neste período.</td></tr>`;

  // ── SECÇÃO 3: Trocas / Alterações ──
  const linhasTrocas = Array.from({length:10}, (_,i) =>
    `<tr style="height:24px">
      <td style="border:1px solid #ccc;padding:2px 6px;font-size:.7rem;color:#bbb;text-align:center">${i+1}</td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
      <td style="border:1px solid #ccc"></td>
    </tr>`
  ).join('');

  const hoje = new Date().toLocaleDateString('pt-PT');

  const html = `
    <div style="font-family:'Outfit',Arial,sans-serif;color:#111;font-size:10pt;line-height:1.4">
      <!-- CABEÇALHO -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2.5px solid #007878;padding-bottom:8px;margin-bottom:12px">
        <div>
          <div style="font-size:13pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:-.01em">Arpuro &amp; Redemóvel, Lda</div>
          <div style="font-size:8pt;color:#555;margin-top:2px">NIPC 503 198 749 &nbsp;·&nbsp; Mapa de Trabalho para Afixação Obrigatória</div>
          <div style="font-size:9pt;font-weight:700;color:#333;margin-top:4px">📍 ${nomLocal}</div>
          <div style="font-size:8pt;color:#666;margin-top:2px">Período: <strong>${periodoStr}</strong> &nbsp;·&nbsp; Escala de ${nomMes}</div>
        </div>
        <div style="text-align:right;font-size:7.5pt;color:#999;line-height:1.8;border:1px solid #eee;padding:6px 10px;border-radius:6px">
          <div style="font-weight:700;color:#555">Emitido em ${hoje}</div>
          <div>Portal Redemóvel</div>
          <div style="margin-top:4px;font-size:7pt">Art.º 215.º CT — Afixar no local de trabalho</div>
        </div>
      </div>
      <!-- SECÇÃO A: FICHA DE TURNOS -->
      <div style="font-size:8.5pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;margin-top:4px">
        A — Definição de Turnos
      </div>
      <table style="border-collapse:collapse;width:100%;margin-bottom:14px">
        <thead>
          <tr style="background:#007878;color:white">
            <th style="padding:5px 8px;font-size:.72rem;text-align:left;border:1px solid #005f5f">Designação do Turno</th>
            <th style="padding:5px 8px;font-size:.72rem;text-align:center;border:1px solid #005f5f">Entrada</th>
            <th style="padding:5px 8px;font-size:.72rem;text-align:center;border:1px solid #005f5f">Saída</th>
            <th style="padding:5px 8px;font-size:.72rem;text-align:center;border:1px solid #005f5f">Duração</th>
            <th style="padding:5px 8px;font-size:.72rem;text-align:left;border:1px solid #005f5f">Pausas / Intervalos</th>
          </tr>
        </thead>
        <tbody>${fichaLinhas}</tbody>
      </table>
      <!-- SECÇÃO B: GRELHA DE ATRIBUIÇÃO -->
      <div style="font-size:8.5pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">
        B — Atribuição de Turnos por Colaborador
      </div>
      <div style="overflow-x:auto;margin-bottom:14px">
        <table style="border-collapse:collapse;width:100%">
          <thead>
            <tr style="background:#007878;color:white">
              <th style="padding:5px 8px;font-size:.72rem;text-align:left;border:1px solid #005f5f;white-space:nowrap;min-width:130px">Nome Completo</th>
              ${thDias}
            </tr>
          </thead>
          <tbody>${trColabs}</tbody>
        </table>
      </div>
      <div style="font-size:7pt;color:#888;margin-bottom:14px">
        🏖 Férias &nbsp;·&nbsp; <span style="color:#007878;font-weight:700">■</span> Turno normal &nbsp;·&nbsp; <span style="color:#d97706;font-weight:700">■</span> Turno especial &nbsp;·&nbsp; – Folga/não atribuído &nbsp;·&nbsp; <span style="background:#fde8e8;padding:0 3px">Domingo</span> &nbsp;·&nbsp; <span style="background:#fef9e7;padding:0 3px">Sábado</span>
      </div>
      <!-- SECÇÃO C: TROCAS -->
      <div style="font-size:8.5pt;font-weight:800;color:#007878;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">
        C — Trocas e Alterações de Turno
      </div>
      <table style="border-collapse:collapse;width:100%;margin-bottom:18px">
        <thead>
          <tr style="background:#f0fafa">
            <th style="border:1px solid #ccc;padding:5px 6px;font-size:.7rem;width:22px;text-align:center">#</th>
            <th style="border:1px solid #ccc;padding:5px 6px;font-size:.7rem">Data</th>
            <th style="border:1px solid #ccc;padding:5px 6px;font-size:.7rem">Colaborador (cede turno)</th>
            <th style="border:1px solid #ccc;padding:5px 6px;font-size:.7rem">Colaborador (assume turno)</th>
            <th style="border:1px solid #ccc;padding:5px 6px;font-size:.7rem">Turno</th>
            <th style="border:1px solid #ccc;padding:5px 6px;font-size:.7rem">Ass. Responsável</th>
          </tr>
        </thead>
        <tbody>${linhasTrocas}</tbody>
      </table>
      <!-- RODAPÉ LEGAL -->
      <div style="border-top:1.5px solid #007878;padding-top:8px;display:flex;justify-content:space-between;align-items:flex-end">
        <div style="font-size:7.5pt;color:#555">
          <div style="font-weight:700">Responsável pelo estabelecimento:</div>
          <div style="margin-top:18px;border-top:1px solid #555;width:200px;padding-top:3px;font-size:7pt;color:#888">Assinatura e data</div>
        </div>
        <div style="font-size:6.5pt;color:#bbb;text-align:right">
          <div>Arpuro &amp; Redemóvel, Lda · NIPC 503 198 749</div>
          <div>Gerado automaticamente pelo Portal Redemóvel · ${hoje}</div>
        </div>
      </div>
    </div>
  `;

  // Abrir janela separada para impressao via Blob (robusto com caracteres especiais)
  const fullHtml = '<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Escala Mensal</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">'
    + '<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Outfit,Arial,sans-serif;color:#111;background:white;padding:1.5cm;}'
    + '@media print{body{padding:1cm;}@page{margin:1cm;size:A4 landscape;}}'
    + '</style></head><body>' + html + '</body></html>';
  const blob = new Blob([fullHtml], {type: 'text/html;charset=utf-8'});
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank', 'width=950,height=750');
  if (!win) { alert('Permite pop-ups para este site nas definicoes do browser.'); URL.revokeObjectURL(blobUrl); return; }
  win.onload = function() { win.focus(); win.print(); setTimeout(()=>URL.revokeObjectURL(blobUrl), 60000); };
}


function minParaHora(min) { const h=Math.floor(Number(min)/60),m=Number(min)%60; return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }
function minParaHoraH(min) { const m=Number(min),h=Math.floor(m/60),r=m%60; return r>0?`${h}h${String(r).padStart(2,'0')}m`:`${h}h`; }
function minParaHoraInput(min) { return minParaHora(min); }
function horaParaMin(str) { if(!str) return ''; const [h,m]=str.split(':').map(Number); return h*60+m; }
function segundaFeira(d) { const dt=new Date(d),dow=dt.getDay(),diff=dow===0?-6:1-dow; dt.setDate(dt.getDate()+diff); return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }

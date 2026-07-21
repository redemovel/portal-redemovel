// ═══════════════════════════════════════════════════════
//  EQUIPA REDEMÓVEL — Apps Script Backend
//  Cola este código em Extensões → Apps Script
// ═══════════════════════════════════════════════════════

const SHEET_ID      = '1iYPovaevX8IaBtXW05NzuUmV0JGGc3wYJhBmGTUKVYw';
const ABA_IPS       = 'ips_autorizados';
const ABA_LOG       = 'log_acessos';
const ABA_USERS     = 'Utilizadores';
const IP_SEDE_FIXO  = '148.69.78.10'; // NUNCA pode ser removido

// ───────────────────────────────────────────────────────
//  ENTRY POINT — recebe todos os pedidos do portal
// ───────────────────────────────────────────────────────

function processarAssiduidade(payload, user) {
  try {
    switch(payload.acao) {
      case 'listarLocais': return listarLocais();
      case 'listarColaboradores': return listarColaboradores(user);
      case 'listarTurnosTipo': return { ok: true, turnos: listarTurnosTipo(payload.localId) };
      case 'criarTurnoTipo': return criarTurnoTipo(user, payload.turno);
      case 'editarTurnoTipo': return editarTurnoTipo(user, payload.id, payload.turno);
      case 'apagarTurnoTipo': return apagarTurnoTipo(user, payload.id);
      case 'criarHorarioTipoSemanal': return criarHorarioTipoSemanal(user, payload.horario);
      case 'editarHorarioTipoSemanal': return editarHorarioTipoSemanal(user, payload.id, payload.horario);
      case 'apagarHorarioTipoSemanal': return apagarHorarioTipoSemanal(user, payload.id);
      case 'listarHorariosTipoSemanal': return { ok: true, horarios: listarHorariosTipoSemanal(payload.localId) };
      case 'atribuirSemana': return atribuirSemana(user, payload.atribuicao || payload);
      case 'listarAtribuicoesSemana': return { ok: true, atribuicoes: listarAtribuicoesSemana(payload.filtros || {}) };
      case 'apagarAtribuicaoSemana':  return apagarAtribuicaoSemana(user, payload.id);
      case 'editarAtribuicaoSemana':  return editarAtribuicaoSemana(user, payload.id, payload.atribuicao);
      case 'criarHorarioEspecial': return criarHorarioEspecial(user, payload.horarioEspecial);
      case 'gantSemanal': return gantSemanal(user, payload.localId, payload.semanaInicio);
      case 'ocupacaoDiaria': return ocupacaoDiaria(user, payload.data);
      case 'horarioSemanal': return horarioSemanal(user, payload.data);
      case 'registarEntrada': return registarEntrada(user, payload.localId, payload.localManual, payload.justificativa);
      case 'registarSaida': return registarSaida(user, payload.localId);
      case 'registarPausa': return registarPausa(user, payload.numeroPausa, payload.tipo);
      case 'meuRegistoHoje': return { ok: true, registo: meuRegistoHoje(user) };
      case 'registosColegas': return { ok: true, registos: registosColegas(user, payload.localId) };
      case 'criarSinalizacao': return criarSinalizacao(user, payload.sinalizacao);
      case 'listarAprovacoes': return listarAprovacoes(user, payload.filtros);
      case 'decidirAprovacao': return decidirAprovacao(user, payload.id, payload.decisao, payload.nota);
      case 'registarFerias': return registarFerias(user, payload.ferias);
      case 'listarFerias': return { ok: true, ferias: listarFerias(payload.filtros || {}) };
      case 'aprovarFerias': return aprovarFerias(user, payload.id, payload.nota);
      case 'rejeitarFerias': return rejeitarFerias(user, payload.id, payload.nota);
      case 'mapaMenusal': return mapaMenusal(user, payload.mesAno, payload.localId);
      case 'listarHorarios': return { ok: true, horarios: listarHorarios(payload.filtros || {}) };
      case 'inicializarAbas': return inicializarAbas();
      case 'obterHoraServidor': return obterHoraServidor();
      case 'criarExcecaoDia': return criarExcecaoDia(user, payload.excecao);
      case 'listarExcecoesDia': return { ok: true, excecoes: listarExcecoesDia(payload.filtros || {}) };
      case 'apagarExcecaoDia': return apagarExcecaoDia(user, payload.id);
      default: return { ok: false, erro: 'Ação desconhecida: ' + payload.acao };
    }
  } catch(err) {
    return { ok: false, erro: 'Erro: ' + err.message };
  }
}

function autenticarSimples(username, password) {
  const users = lerAba('Utilizadores');
  const u = users.find(x =>
    String(x.username).toLowerCase() === String(username).toLowerCase() &&
    String(x.password) === String(password) &&
    String(x.ativo).toUpperCase() === 'TRUE'
  );
  if (!u) return null;
  return { username: u.username, nome: u.nome, role: u.role };
}


function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const acao    = payload.acao;
    const ip      = getClientIP(e);

    switch (acao) {

      case 'verificarIP':
        return responder(verificarIP(ip));

      case 'autenticar':
        return responder(autenticar(ip, payload.username, payload.password));

      case 'alterarPassword':
        return responder(alterarPassword(
          ip, payload.username, payload.passwordAtual, payload.passwordNova
        ));

      case 'redefinirPassword':
        return responder(redefinirPassword(
          ip, payload.master, payload.passwordMaster,
          payload.username, payload.passwordNova
        ));

      case 'listarIPs':
        return responder(listarIPs(ip, payload.username, payload.password));

      case 'adicionarIP':
        return responder(adicionarIP(
          ip, payload.username, payload.password,
          payload.local, payload.novoIP, payload.fixo, payload.notas
        ));

      case 'desativarIP':
        return responder(desativarIP(
          ip, payload.username, payload.password, payload.ipAlvo
        ));

      case 'listarUtilizadores':
        return responder(listarUtilizadores(ip, payload.username, payload.password));

      case 'criarUtilizador':
        return responder(criarUtilizador(
          ip, payload.username, payload.password, payload.novoUser
        ));

      case 'desativarUtilizador':
        return responder(desativarUtilizador(
          ip, payload.username, payload.password, payload.usernameAlvo
        ));

      default:
        const userAss = autenticarSimples(payload.username, payload.password);
        if (!userAss) return responder({ ok: false, erro: 'Credenciais inválidas.' });
        return responder(processarAssiduidade(payload, userAss));
    }

  } catch (err) {
    return responder({ ok: false, erro: 'Erro interno: ' + err.message });
  }
}

// ───────────────────────────────────────────────────────
//  VERIFICAR IP
// ───────────────────────────────────────────────────────
function verificarIP(ip, e) {
  // Se ip for 'auto', obter do pedido
  if (ip === 'auto' && e) {
    ip = e.parameter && e.parameter.ip ? e.parameter.ip : getClientIP(e);
  }

  const sheet = getSheet(ABA_IPS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    const [local, ipGuardado, ativo] = dados[i];
    if (ipGuardado === ip && ativo === true) {
      return { ok: true, local: local, ip: ip };
    }
  }

  registarLog(ip, '—', 'ACESSO NEGADO — IP não autorizado');
  return { ok: false, erro: 'Acesso não autorizado para este IP.', ip: ip };
}

// ───────────────────────────────────────────────────────
//  AUTENTICAR
// ───────────────────────────────────────────────────────
function autenticar(ip, username, password) {
  const ipCheck = verificarIP(ip);
  if (!ipCheck.ok) return ipCheck;

  const user = encontrarUtilizador(username);
  if (!user) {
    registarLog(ip, username, 'LOGIN FALHADO — utilizador não existe');
    return { ok: false, erro: 'Utilizador ou password incorretos.' };
  }

  if (!user.ativo) {
    registarLog(ip, username, 'LOGIN FALHADO — utilizador inativo');
    return { ok: false, erro: 'Utilizador desativado. Contacte o administrador.' };
  }

  if (user.password !== password) {
    registarLog(ip, username, 'LOGIN FALHADO — password incorreta');
    return { ok: false, erro: 'Utilizador ou password incorretos.' };
  }

  registarLog(ip, username, 'LOGIN OK');
  return {
    ok:        true,
    nome:      user.nome,
    username:  user.username,
    role:      user.role,
    local:     ipCheck.local
  };
}

// ───────────────────────────────────────────────────────
//  ALTERAR PASSWORD (pelo próprio utilizador)
// ───────────────────────────────────────────────────────
function alterarPassword(ip, username, passwordAtual, passwordNova) {
  const ipCheck = verificarIP(ip);
  if (!ipCheck.ok) return ipCheck;

  if (!passwordNova || passwordNova.length < 6) {
    return { ok: false, erro: 'A nova password deve ter pelo menos 6 caracteres.' };
  }

  const sheet = getSheet(ABA_USERS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === username) {
      if (dados[i][1] !== passwordAtual) {
        registarLog(ip, username, 'ALTERAÇÃO PASSWORD FALHADA — password atual incorreta');
        return { ok: false, erro: 'Password atual incorreta.' };
      }
      sheet.getRange(i + 1, 2).setValue(passwordNova);
      registarLog(ip, username, 'PASSWORD ALTERADA');
      return { ok: true, mensagem: 'Password alterada com sucesso.' };
    }
  }

  return { ok: false, erro: 'Utilizador não encontrado.' };
}

// ───────────────────────────────────────────────────────
//  REDEFINIR PASSWORD (pelo master)
// ───────────────────────────────────────────────────────
function redefinirPassword(ip, master, passwordMaster, usernameAlvo, passwordNova) {
  const auth = autenticar(ip, master, passwordMaster);
  if (!auth.ok) return auth;
  if (auth.role !== 'master') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  if (!passwordNova || passwordNova.length < 6) {
    return { ok: false, erro: 'A nova password deve ter pelo menos 6 caracteres.' };
  }

  const sheet = getSheet(ABA_USERS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === usernameAlvo) {
      sheet.getRange(i + 1, 2).setValue(passwordNova);
      registarLog(ip, master, 'PASSWORD REDEFINIDA para ' + usernameAlvo);
      return { ok: true, mensagem: 'Password redefinida com sucesso.' };
    }
  }

  return { ok: false, erro: 'Utilizador não encontrado.' };
}

// ───────────────────────────────────────────────────────
//  LISTAR IPs (só master)
// ───────────────────────────────────────────────────────
function listarIPs(ip, username, password) {
  const auth = autenticar(ip, username, password);
  if (!auth.ok) return auth;
  if (auth.role !== 'master' && auth.role !== 'coordenador_lojas') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  const sheet = getSheet(ABA_IPS);
  const dados = sheet.getDataRange().getValues();
  const ips   = [];

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0]) {
      ips.push({
        local: dados[i][0],
        ip:    dados[i][1],
        ativo: dados[i][2],
        fixo:  dados[i][3],
        notas: dados[i][4] || ''
      });
    }
  }

  return { ok: true, ips: ips, ipAtual: ip };
}

// ───────────────────────────────────────────────────────
//  ADICIONAR IP (só master)
// ───────────────────────────────────────────────────────
function adicionarIP(ip, username, password, local, novoIP, fixo, notas) {
  const auth = autenticar(ip, username, password);
  if (!auth.ok) return auth;
  if (auth.role !== 'master' && auth.role !== 'coordenador_lojas') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  const sheet = getSheet(ABA_IPS);
  sheet.appendRow([local, novoIP, true, fixo || false, notas || '']);
  registarLog(ip, username, 'IP ADICIONADO: ' + novoIP + ' (' + local + ')');
  return { ok: true, mensagem: 'IP adicionado com sucesso.' };
}

// ───────────────────────────────────────────────────────
//  DESATIVAR IP (só master, nunca o IP fixo da Sede)
// ───────────────────────────────────────────────────────
function desativarIP(ip, username, password, ipAlvo) {
  const auth = autenticar(ip, username, password);
  if (!auth.ok) return auth;
  if (auth.role !== 'master' && auth.role !== 'coordenador_lojas') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  if (ipAlvo === IP_SEDE_FIXO) {
    return { ok: false, erro: 'O IP da Sede não pode ser desativado.' };
  }

  const sheet = getSheet(ABA_IPS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][1] === ipAlvo) {
      if (dados[i][3] === true) {
        return { ok: false, erro: 'IPs fixos não podem ser desativados aqui. Edita diretamente na Sheet.' };
      }
      sheet.getRange(i + 1, 3).setValue(false);
      registarLog(ip, username, 'IP DESATIVADO: ' + ipAlvo);
      return { ok: true, mensagem: 'IP desativado com sucesso.' };
    }
  }

  return { ok: false, erro: 'IP não encontrado.' };
}

// ───────────────────────────────────────────────────────
//  LISTAR UTILIZADORES (master + coordenador_lojas)
// ───────────────────────────────────────────────────────
function listarUtilizadores(ip, username, password) {
  const auth = autenticar(ip, username, password);
  if (!auth.ok) return auth;
  if (auth.role !== 'master' && auth.role !== 'coordenador_lojas') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  const sheet = getSheet(ABA_USERS);
  const dados = sheet.getDataRange().getValues();
  const users = [];

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0]) {
      const role = dados[i][3];
      // Coordenador só vê assistentes de loja — master vê todos
      if (auth.role === 'coordenador_lojas' && role === 'master') continue;
      users.push({
        username: dados[i][0],
        nome:     dados[i][2],
        role:     role,
        ativo:    dados[i][4]
      });
      // Nota: password (coluna 1) nunca é enviada para o portal
    }
  }

  return { ok: true, utilizadores: users, permissao: auth.role };
}

// ───────────────────────────────────────────────────────
//  CRIAR UTILIZADOR (master + coordenador_lojas)
// ───────────────────────────────────────────────────────
function criarUtilizador(ip, username, password, novoUser) {
  const auth = autenticar(ip, username, password);
  if (!auth.ok) return auth;
  if (auth.role !== 'master' && auth.role !== 'coordenador_lojas') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  // Coordenador só pode criar assistentes de loja
  if (auth.role === 'coordenador_lojas' && novoUser.role !== 'assistente_loja') {
    return { ok: false, erro: 'Só podes criar utilizadores com perfil Assistente de Loja.' };
  }

  if (!novoUser.username || !novoUser.password || !novoUser.nome || !novoUser.role) {
    return { ok: false, erro: 'Dados incompletos do novo utilizador.' };
  }

  if (novoUser.password.length < 6) {
    return { ok: false, erro: 'Password deve ter pelo menos 6 caracteres.' };
  }

  // Verifica se já existe
  const user = encontrarUtilizador(novoUser.username);
  if (user) {
    return { ok: false, erro: 'Username já existe.' };
  }

  const sheet = getSheet(ABA_USERS);
  sheet.appendRow([
    novoUser.username,
    novoUser.password,
    novoUser.nome,
    novoUser.role,
    true
  ]);

  registarLog(ip, username, 'UTILIZADOR CRIADO: ' + novoUser.username);
  return { ok: true, mensagem: 'Utilizador criado com sucesso.' };
}

// ───────────────────────────────────────────────────────
//  DESATIVAR UTILIZADOR (master + coordenador_lojas com restrições)
// ───────────────────────────────────────────────────────
function desativarUtilizador(ip, username, password, usernameAlvo) {
  const auth = autenticar(ip, username, password);
  if (!auth.ok) return auth;
  if (auth.role !== 'master' && auth.role !== 'coordenador_lojas') {
    return { ok: false, erro: 'Sem permissões para esta operação.' };
  }

  if (username === usernameAlvo) {
    return { ok: false, erro: 'Não podes desativar a tua própria conta.' };
  }

  const sheet = getSheet(ABA_USERS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === usernameAlvo) {
      // Coordenadora não pode desativar master nem outras coordenadoras
      if (auth.role === 'coordenador_lojas' && dados[i][3] !== 'assistente_loja') {
        return { ok: false, erro: 'Sem permissões para desativar este utilizador.' };
      }
      sheet.getRange(i + 1, 5).setValue(false);
      registarLog(ip, username, 'UTILIZADOR DESATIVADO: ' + usernameAlvo);
      return { ok: true, mensagem: 'Utilizador desativado com sucesso.' };
    }
  }

  return { ok: false, erro: 'Utilizador não encontrado.' };
}

// ═══════════════════════════════════════════════════════
//  FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════

function getSheet(nome) {
  return SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName(nome);
}

function encontrarUtilizador(username) {
  const sheet = getSheet(ABA_USERS);
  const dados = sheet.getDataRange().getValues();

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][0] === username) {
      return {
        username: dados[i][0],
        password: dados[i][1],
        nome:     dados[i][2],
        role:     dados[i][3],
        ativo:    dados[i][4]
      };
    }
  }
  return null;
}

function registarLog(ip, username, acao) {
  const sheet = getSheet(ABA_LOG);
  sheet.appendRow([
    new Date().toLocaleString('pt-PT'),
    ip,
    username,
    acao
  ]);
}

function getClientIP(e) {
  try {
    return e.parameter.ip || JSON.parse(e.postData.contents).ip || 'desconhecido';
  } catch(_) {
    return 'desconhecido';
  }
}

function responder(dados) {
  return ContentService
    .createTextOutput(JSON.stringify(dados))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
const pagina = p.p === 'assiduidade' ? 'assiduidade' : (p.p === 'v2' ? 'equipa-redemovel-v2' : 'equipa-redemovel-v3');
  const titulo = pagina === 'assiduidade' ? 'Assiduidade · Redemovel' : 'Redemovel · Portal';
  
  const html = HtmlService.createHtmlOutputFromFile(pagina);
  
if (p.u && p.p && pagina === 'assiduidade') {
    const sessao = JSON.stringify({
      username: p.u,
      password: p.p,
      nome: p.n || p.u,
      role: p.r || 'assistente_loja',
      ip: ''
    });
    const script = '<script>window.__SESSAO_INJECTADA = ' + sessao + ';<\/script>';
    html.setContent(html.getContent().replace('</head>', script + '</head>'));
  }
  
  return html.setTitle(titulo).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

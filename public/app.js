/* =====================================================================
   app.js — telas do Sistema de Controle de Biblioteca (JavaScript puro)
   Rotas por hash (#/inicio, #/livros ...).
   Os dados vêm da API do servidor (server.js) e ficam no banco SQLite.
   Acesso de teste: admin@biblioteca.com (0001) ou bibliotecario@biblioteca.com (0002) / senha 123456
   ===================================================================== */

(function () {
  'use strict';

  /* ---------------- Configuração ---------------- */
  const PRAZO_PADRAO_DIAS = 7;
  const POR_PAGINA = 5;
  const CHAVE_SESSAO = 'biblioteca_sessao';

  /* ---------------- Utilitários ---------------- */
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function hojeISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function somaDias(iso, dias) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }
  function fmtData(iso) {
    if (!iso) return '—';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3000);
  }

  function baixarCSV(nome, cabecalho, linhas) {
    const celula = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- Sessão (token do login) ---------------- */
  function pegarSessao() {
    return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || localStorage.getItem(CHAVE_SESSAO) || 'null');
  }
  const logado = () => pegarSessao() !== null;
  const ehAdmin = () => logado() && pegarSessao().perfil === 'admin';

  function entrar(sessao, manter) {
    // "Manter conectado" -> localStorage (continua depois de fechar o navegador)
    (manter ? localStorage : sessionStorage).setItem(CHAVE_SESSAO, JSON.stringify(sessao));
  }
  function sair() {
    sessionStorage.removeItem(CHAVE_SESSAO);
    localStorage.removeItem(CHAVE_SESSAO);
    location.hash = '#/login';
  }

  /* ---------------- Chamada à API ---------------- */
  // Exemplo: const livros = await api('GET', '/api/livros?busca=dom');
  async function api(metodo, caminho, dados) {
    const sessao = pegarSessao();
    const resposta = await fetch(caminho, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (sessao ? sessao.token : '')
      },
      body: dados ? JSON.stringify(dados) : undefined
    });

    if (resposta.status === 401 && caminho !== '/api/login') { sair(); throw new Error('Sessão expirada. Faça login novamente.'); }
    if (resposta.status === 204) return null; // excluído, sem conteúdo

    const json = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(json.erro || 'Erro ao falar com o servidor.');
    return json;
  }

  /* ---------------- Pedaços de tela reaproveitados ---------------- */
  function tagSituacao(e, contextoHistorico = false) {
    if (e.situacao === 'devolvido') return '<span class="tag">Devolvido</span>';
    if (e.situacao === 'atraso') return '<span class="tag preta">Em atraso</span>';
    return contextoHistorico ? '<span class="tag tracejada">Em aberto</span>' : '<span class="tag">No prazo</span>';
  }
  const tagLivro = (l) => l.disponiveis > 0
    ? '<span class="tag">Disponível</span>'
    : '<span class="tag preta">Indisponível</span>';

  function cabecalho(titulo, direita = '') {
    return `<header class="page-header"><h1>${esc(titulo)}</h1><div class="acoes">${direita}</div></header>`;
  }
  const perfil = () => `<span class="perfil">${ehAdmin() ? 'Administrador(a)' : 'Bibliotecário(a)'}</span>`;

  function paginar(lista, pagina) {
    const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    const p = Math.min(Math.max(1, pagina), totalPaginas);
    return { itens: lista.slice((p - 1) * POR_PAGINA, p * POR_PAGINA), pagina: p, totalPaginas };
  }
  function htmlPaginacao(p) {
    return `<div class="paginacao">
      <span>Página ${p.pagina} de ${p.totalPaginas}</span>
      <button class="btn btn-secundario" data-pag="${p.pagina - 1}" ${p.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
      <button class="btn btn-secundario" data-pag="${p.pagina + 1}" ${p.pagina >= p.totalPaginas ? 'disabled' : ''}>Próxima</button>
    </div>`;
  }
  function linhaVazia(colunas, msg = 'Nenhum registro encontrado.') {
    return `<tr><td class="vazio" colspan="${colunas}">${msg}</td></tr>`;
  }
  function ligarEnter(input, acao) {
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); acao(); } });
  }

  // Janela de confirmação (usada para excluir livro)
  function confirmar(titulo, mensagem) {
    return new Promise((resolve) => {
      const modal = document.createElement('dialog');
      modal.className = 'modal-confirmacao';
      modal.innerHTML = `<h2>${esc(titulo)}</h2><p>${esc(mensagem)}</p>
        <div class="modal-acoes">
          <button type="button" class="btn btn-secundario" value="cancelar">Cancelar</button>
          <button type="button" class="btn btn-primario" value="ok">Excluir</button>
        </div>`;
      $$('button', modal).forEach((b) => b.addEventListener('click', () => modal.close(b.value)));
      modal.addEventListener('close', () => { resolve(modal.returnValue === 'ok'); modal.remove(); }, { once: true });
      document.body.appendChild(modal);
      modal.showModal();
    });
  }

  async function excluirLivro(livro) {
    const ok = await confirmar('Excluir livro?', `Tem certeza de que deseja excluir "${livro.titulo}"? Essa ação não pode ser desfeita.`);
    if (!ok) return false;
    try {
      await api('DELETE', '/api/livros/' + livro.id);
      toast('Livro excluído.');
      return true;
    } catch (erro) {
      toast(erro.message);
      return false;
    }
  }

  /* =================================================================
     TELAS — cada uma busca seus dados na API e devolve { html, bind }
     ================================================================= */

  /* 1. Login ---------------------------------------------------------- */
  function telaLogin() {
    return {
      auth: true,
      html: `<div class="auth-card">
        <h1>Entrar</h1>
        <p class="sub">Acesso restrito a bibliotecários(as).</p>
        <div id="erro" class="aviso" hidden></div>
        <form id="form-login" novalidate>
          <div class="campo">
            <label for="login">E-mail ou matrícula</label>
            <input type="text" id="login" placeholder="nome@exemplo.com" autocomplete="username">
          </div>
          <div class="campo">
            <label for="senha">Senha</label>
            <input type="password" id="senha" placeholder="Digite sua senha" autocomplete="current-password">
          </div>
          <div class="auth-linha">
            <label class="check"><input type="checkbox" id="manter"> Manter conectado</label>
            <a href="#/recuperar">Esqueci minha senha</a>
          </div>
          <button type="submit" class="btn btn-primario btn-bloco">Entrar</button>
        </form>
      </div>`,
      bind() {
        $('#login').focus();
        $('#form-login').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            const sessao = await api('POST', '/api/login', { login: $('#login').value.trim(), senha: $('#senha').value });
            entrar(sessao, $('#manter').checked);
            location.hash = '#/inicio';
          } catch (erro) {
            $('#erro').textContent = erro.message;
            $('#erro').hidden = false;
            $('#senha').value = '';
            $('#senha').focus();
          }
        });
      }
    };
  }

  /* 2. Recuperar senha (o envio do e-mail não faz parte do trabalho) --- */
  function telaRecuperar() {
    return {
      auth: true,
      html: `<div class="auth-card">
        <h1>Recuperar senha</h1>
        <p class="sub">Informe o e-mail cadastrado. Enviaremos um link para criar uma nova senha.</p>
        <form id="form-rec" novalidate>
          <div class="campo">
            <label for="email-rec">E-mail</label>
            <input type="email" id="email-rec" placeholder="nome@exemplo.com">
          </div>
          <div id="msg-rec" class="aviso" hidden>Se o e-mail estiver cadastrado, você receberá o link em instantes.</div>
          <button type="submit" class="btn btn-primario btn-bloco">Enviar link</button>
        </form>
        <a href="#/login" class="link-centro">Voltar para o login</a>
      </div>`,
      bind() {
        $('#form-rec').addEventListener('submit', (ev) => {
          ev.preventDefault();
          const campo = $('#email-rec');
          if (!/^\S+@\S+\.\S+$/.test(campo.value)) { campo.classList.add('invalido'); campo.focus(); return; }
          campo.classList.remove('invalido');
          $('#msg-rec').hidden = false;
        });
      }
    };
  }

  /* 3. Início --------------------------------------------------------- */
  async function telaInicio() {
    const d = await api('GET', '/api/inicio');
    return {
      menu: 'inicio',
      html: `${cabecalho('Início', perfil())}
        <div class="campo">
          <label for="busca-inicio">Buscar livro</label>
          <div class="linha-busca">
            <div class="grow"><input type="text" id="busca-inicio" placeholder="Título, autor ou editora"></div>
            <button class="btn btn-primario" id="btn-busca-inicio">Buscar</button>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><div class="rot">Títulos cadastrados</div><div class="num">${d.titulos}</div></div>
          <div class="stat"><div class="rot">Exemplares disponíveis</div><div class="num">${d.disponiveis}</div></div>
          <div class="stat"><div class="rot">Empréstimos ativos</div><div class="num">${d.ativos}</div></div>
          <a class="stat destaque" href="#/relatorios/atraso" style="text-decoration:none"><div class="rot">Em atraso</div><div class="num">${d.atrasados}</div></a>
        </div>
        <div class="inicio-grid">
          <section class="card">
            <h2>Atalhos</h2>
            <a href="#/emprestimos/novo" class="btn btn-primario btn-bloco">Novo empréstimo</a>
            <a href="#/devolucao" class="btn btn-secundario btn-bloco">Registrar devolução</a>
          </section>
          <section class="card">
            <h2>Devoluções previstas para hoje</h2>
            <div class="tabela-wrap"><table>
              <thead><tr><th>Livro</th><th>Usuário</th><th>Prevista</th></tr></thead>
              <tbody>${d.devolucoesHoje.length ? d.devolucoesHoje.map((e) => `<tr>
                <td>${esc(e.titulo)}</td><td>${esc(e.nome)}</td><td>${fmtData(e.prevista)}</td></tr>`).join('')
                : linhaVazia(3, 'Nenhuma devolução prevista para hoje.')}
              </tbody>
            </table></div>
            <p style="margin:12px 0 0"><a href="#/emprestimos">Ver todos os empréstimos</a></p>
          </section>
        </div>`,
      bind() {
        const ir = () => { location.hash = '#/livros?q=' + encodeURIComponent($('#busca-inicio').value); };
        $('#btn-busca-inicio').addEventListener('click', ir);
        ligarEnter($('#busca-inicio'), ir);
      }
    };
  }

  /* 4. Consulta de livros --------------------------------------------- */
  async function telaLivros(params) {
    const q = params.get('q') || '';
    const lista = await api('GET', '/api/livros?busca=' + encodeURIComponent(q));
    const p = paginar(lista, Number(params.get('p')) || 1);
    return {
      menu: 'livros',
      html: `${cabecalho('Livros', `<a href="#/livros/novo" class="btn btn-primario">+ Novo livro</a>${perfil()}`)}
        <label for="q-livros">Pesquisar</label>
        <div class="linha-busca">
          <div class="grow"><input type="text" id="q-livros" placeholder="Título, autor ou editora" value="${esc(q)}"></div>
          <button class="btn btn-primario" id="pesquisar">Pesquisar</button>
          <button class="btn btn-secundario" id="limpar">Limpar</button>
        </div>
        <p class="info">Resultados: ${lista.length} ${lista.length === 1 ? 'livro encontrado' : 'livros encontrados'}</p>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Título</th><th>Autor</th><th>Editora</th><th>Ano</th><th>Disponíveis</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>${p.itens.length ? p.itens.map((l) => `<tr>
            <td>${esc(l.titulo)}</td><td>${esc(l.autor)}</td><td>${esc(l.editora)}</td><td>${l.ano}</td>
            <td>${l.disponiveis} de ${l.total}</td><td>${tagLivro(l)}</td>
            <td><a href="#/livros/editar/${l.id}">Editar</a>${l.disponiveis > 0
              ? `<span class="sep">·</span><a href="#/emprestimos/novo?livro=${l.id}">Emprestar</a>` : ''}${ehAdmin()
              ? `<span class="sep">·</span><button type="button" class="link-acao" data-excluir="${l.id}">Excluir</button>` : ''}</td>
          </tr>`).join('') : linhaVazia(7, 'Nenhum livro encontrado.')}</tbody>
        </table></div>
        ${htmlPaginacao(p)}`,
      bind() {
        const buscar = () => { location.hash = '#/livros?q=' + encodeURIComponent($('#q-livros').value); };
        $('#pesquisar').addEventListener('click', buscar);
        ligarEnter($('#q-livros'), buscar);
        $('#limpar').addEventListener('click', () => { location.hash = '#/livros'; });
        $$('[data-pag]').forEach((b) => b.addEventListener('click', () => {
          location.hash = `#/livros?q=${encodeURIComponent(q)}&p=${b.dataset.pag}`;
        }));
        $$('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
          const livro = lista.find((l) => l.id === Number(b.dataset.excluir));
          if (await excluirLivro(livro)) rotear();
        }));
      }
    };
  }

  /* 5. Cadastro / edição de livro ------------------------------------- */
  async function telaLivroForm(id) {
    const l = id ? await api('GET', '/api/livros/' + id) : null;
    const emprestados = l ? l.total - l.disponiveis : 0;
    return {
      menu: 'livros',
      html: `${cabecalho(l ? 'Editar livro' : 'Cadastro de livro', '<a href="#/livros">Voltar para livros</a>')}
        <form id="form-livro" class="card form-card" novalidate>
          <h2>Dados do livro</h2>
          <div class="campo"><label for="titulo">Título</label><input type="text" id="titulo" value="${esc(l?.titulo)}"></div>
          <div class="grid-2">
            <div class="campo"><label for="autor">Autor</label><input type="text" id="autor" value="${esc(l?.autor)}"></div>
            <div class="campo"><label for="editora">Editora</label><input type="text" id="editora" value="${esc(l?.editora)}"></div>
            <div class="campo"><label for="ano">Ano de publicação</label><input type="text" inputmode="numeric" id="ano" maxlength="4" value="${l?.ano ?? ''}"></div>
            <div class="campo"><label for="exemplares">Exemplares</label><input type="text" inputmode="numeric" id="exemplares" value="${l?.total ?? ''}"></div>
          </div>
          <p class="ajuda">Todos os campos são obrigatórios. Ano e exemplares aceitam apenas números.${emprestados ? ` Há ${emprestados} exemplar(es) emprestado(s) — o total não pode ser menor que isso.` : ''}</p>
          <div class="form-acoes">
            ${l && ehAdmin() ? '<button type="button" class="btn btn-secundario" id="excluir-livro" style="margin-right:auto">Excluir livro</button>' : ''}
            <a href="#/livros" class="btn btn-secundario">Cancelar</a>
            <button type="submit" class="btn btn-primario">Salvar livro</button>
          </div>
        </form>`,
      bind() {
        if ($('#excluir-livro')) {
          $('#excluir-livro').addEventListener('click', async () => {
            if (await excluirLivro(l)) location.hash = '#/livros';
          });
        }
        ['ano', 'exemplares'].forEach((c) => $('#' + c).addEventListener('input', (ev) => {
          ev.target.value = ev.target.value.replace(/\D/g, '');
        }));
        $('#form-livro').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const v = (c) => $('#' + c).value.trim();
          // Destaca os campos vazios antes de enviar
          let primeiroErro = null;
          ['titulo', 'autor', 'editora', 'ano', 'exemplares'].forEach((c) => {
            $('#' + c).classList.toggle('invalido', !v(c));
            if (!v(c) && !primeiroErro) primeiroErro = c;
          });
          if (primeiroErro) { $('#' + primeiroErro).focus(); toast('Preencha todos os campos.'); return; }

          const dados = { titulo: v('titulo'), autor: v('autor'), editora: v('editora'), ano: Number(v('ano')), total: Number(v('exemplares')) };
          try {
            if (l) await api('PUT', '/api/livros/' + l.id, dados);
            else await api('POST', '/api/livros', dados);
            toast('Livro salvo.');
            location.hash = '#/livros';
          } catch (erro) {
            toast(erro.message); // mensagem de validação vinda do servidor
          }
        });
      }
    };
  }

  /* 6. Consulta de usuários ------------------------------------------- */
  async function telaUsuarios(params) {
    const q = params.get('q') || '';
    const lista = await api('GET', '/api/usuarios?busca=' + encodeURIComponent(q));
    const p = paginar(lista, Number(params.get('p')) || 1);
    return {
      menu: 'usuarios',
      html: `${cabecalho('Usuários', `<a href="#/usuarios/novo" class="btn btn-primario">+ Novo usuário</a>${perfil()}`)}
        <label for="q-usu">Buscar usuário</label>
        <div class="linha-busca">
          <div class="grow"><input type="text" id="q-usu" placeholder="Nome, CPF ou matrícula" value="${esc(q)}"></div>
          <button class="btn btn-primario" id="buscar-usu">Buscar</button>
        </div>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Nome</th><th>CPF / matrícula</th><th>Telefone</th><th>E-mail</th><th>Ações</th></tr></thead>
          <tbody>${p.itens.length ? p.itens.map((u) => `<tr>
            <td>${esc(u.nome)}</td><td>${esc(u.doc)}</td><td>${esc(u.telefone)}</td><td>${esc(u.email)}</td>
            <td><a href="#/usuarios/editar/${u.id}">Editar</a><span class="sep">·</span><a href="#/relatorios/historico?usuario=${u.id}">Histórico</a></td>
          </tr>`).join('') : linhaVazia(5, 'Nenhum usuário encontrado.')}</tbody>
        </table></div>
        ${htmlPaginacao(p)}`,
      bind() {
        const buscar = () => { location.hash = '#/usuarios?q=' + encodeURIComponent($('#q-usu').value); };
        $('#buscar-usu').addEventListener('click', buscar);
        ligarEnter($('#q-usu'), buscar);
        $$('[data-pag]').forEach((b) => b.addEventListener('click', () => {
          location.hash = `#/usuarios?q=${encodeURIComponent(q)}&p=${b.dataset.pag}`;
        }));
      }
    };
  }

  /* 7. Cadastro / edição de usuário ----------------------------------- */
  function mascaraTelefone(v) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  async function telaUsuarioForm(id) {
    const u = id ? await api('GET', '/api/usuarios/' + id) : null;
    return {
      menu: 'usuarios',
      html: `${cabecalho(u ? 'Editar usuário' : 'Cadastro de usuário', '<a href="#/usuarios">Voltar para usuários</a>')}
        <form id="form-usu" class="card form-card" novalidate>
          <h2>Dados do usuário</h2>
          <div class="campo"><label for="nome">Nome completo</label><input type="text" id="nome" value="${esc(u?.nome)}"></div>
          <div class="grid-2">
            <div class="campo"><label for="doc">CPF ou matrícula</label><input type="text" id="doc" value="${esc(u?.doc)}"></div>
            <div class="campo"><label for="telefone">Telefone</label><input type="tel" id="telefone" placeholder="(00) 00000-0000" value="${esc(u?.telefone)}"></div>
          </div>
          <div class="campo"><label for="email">E-mail</label><input type="email" id="email" placeholder="nome@exemplo.com" value="${esc(u?.email)}"></div>
          <p class="ajuda">Todos os campos são obrigatórios. O CPF ou a matrícula não pode se repetir.</p>
          <div class="form-acoes">
            <a href="#/usuarios" class="btn btn-secundario">Cancelar</a>
            <button type="submit" class="btn btn-primario">Salvar usuário</button>
          </div>
        </form>`,
      bind() {
        $('#telefone').addEventListener('input', (ev) => { ev.target.value = mascaraTelefone(ev.target.value); });
        $('#form-usu').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const v = (c) => $('#' + c).value.trim();
          let primeiroErro = null;
          ['nome', 'doc', 'telefone', 'email'].forEach((c) => {
            $('#' + c).classList.toggle('invalido', !v(c));
            if (!v(c) && !primeiroErro) primeiroErro = c;
          });
          if (primeiroErro) { $('#' + primeiroErro).focus(); toast('Preencha todos os campos.'); return; }

          const dados = { nome: v('nome'), doc: v('doc'), telefone: v('telefone'), email: v('email') };
          try {
            if (u) await api('PUT', '/api/usuarios/' + u.id, dados);
            else await api('POST', '/api/usuarios', dados);
            toast('Usuário salvo.');
            location.hash = '#/usuarios';
          } catch (erro) {
            toast(erro.message); // ex.: "Este CPF ou matrícula já está cadastrado."
          }
        });
      }
    };
  }

  /* 8. Consulta de empréstimos ---------------------------------------- */
  async function telaEmprestimos(params) {
    const situacao = params.get('s') || 'ativos';
    const q = params.get('q') || '';
    const lista = await api('GET', `/api/emprestimos?situacao=${situacao}&busca=${encodeURIComponent(q)}`);
    const opc = (v, t) => `<option value="${v}" ${situacao === v ? 'selected' : ''}>${t}</option>`;
    return {
      menu: 'emprestimos',
      html: `${cabecalho('Empréstimos', `<a href="#/emprestimos/novo" class="btn btn-primario">+ Novo empréstimo</a>${perfil()}`)}
        <div class="linha-busca">
          <div class="w-select"><label for="situacao">Situação</label>
            <select id="situacao">${opc('ativos', 'Ativos (não devolvidos)')}${opc('atraso', 'Em atraso')}${opc('devolvidos', 'Devolvidos')}${opc('todos', 'Todos')}</select>
          </div>
          <div class="grow"><label for="q-emp">Usuário ou livro</label>
            <input type="text" id="q-emp" placeholder="Nome, CPF, matrícula ou título" value="${esc(q)}">
          </div>
          <button class="btn btn-primario" id="filtrar">Filtrar</button>
        </div>
        <p class="info">${lista.length} ${lista.length === 1 ? 'empréstimo encontrado' : 'empréstimos encontrados'} · os atrasados aparecem com a etiqueta preta</p>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Livro</th><th>Usuário</th><th>Emprestado em</th><th>Prevista</th><th>Dias de atraso</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>${lista.length ? lista.map((e) => `<tr>
            <td>${esc(e.titulo)}</td><td>${esc(e.nome)}</td>
            <td>${fmtData(e.data)}</td><td>${fmtData(e.prevista)}</td>
            <td>${e.dias_atraso}</td><td>${tagSituacao(e)}</td>
            <td>${e.devolvido ? `<span class="info">${fmtData(e.devolvido)}</span>` : `<a href="#/devolucao?emp=${e.id}">Devolver</a>`}</td>
          </tr>`).join('') : linhaVazia(7, 'Nenhum empréstimo encontrado.')}</tbody>
        </table></div>`,
      bind() {
        const filtrar = () => {
          location.hash = `#/emprestimos?s=${$('#situacao').value}&q=${encodeURIComponent($('#q-emp').value)}`;
        };
        $('#filtrar').addEventListener('click', filtrar);
        ligarEnter($('#q-emp'), filtrar);
      }
    };
  }

  /* 9. Novo empréstimo ------------------------------------------------ */
  async function telaNovoEmprestimo(params) {
    const livroInicial = params.get('livro') ? await api('GET', '/api/livros/' + params.get('livro')) : null;
    const estado = { usuario: null, livro: livroInicial };
    const h = hojeISO();
    return {
      menu: 'emprestimos',
      html: `${cabecalho('Novo empréstimo', '<a href="#/emprestimos">Voltar para empréstimos</a>')}
        <div class="emprestimo-grid">
          <div class="passos">
            <section class="card">
              <h2>1. Usuário</h2>
              <label for="q-usuario">CPF ou matrícula</label>
              <div class="linha-busca">
                <div class="grow"><input type="text" id="q-usuario" placeholder="Digite e busque"></div>
                <button class="btn btn-secundario" id="b-usuario">Buscar</button>
              </div>
              <div id="r-usuario" class="resultados-busca" hidden></div>
              <div id="s-usuario" class="aviso vazio" style="margin:0">Usuário encontrado: nome, telefone e e-mail</div>
            </section>
            <section class="card">
              <h2>2. Livro</h2>
              <label for="q-livro">Título do livro</label>
              <div class="linha-busca">
                <div class="grow"><input type="text" id="q-livro" placeholder="Digite e busque"></div>
                <button class="btn btn-secundario" id="b-livro">Buscar</button>
              </div>
              <div id="r-livro" class="resultados-busca" hidden></div>
              <div id="s-livro" class="aviso vazio" style="margin:0">Livro selecionado: título, autor e exemplares disponíveis</div>
            </section>
            <section class="card">
              <h2>3. Prazo</h2>
              <div class="grid-2">
                <div><label for="d-emp">Data do empréstimo</label><input type="date" id="d-emp" value="${h}"></div>
                <div><label for="d-prev">Devolução prevista</label><input type="date" id="d-prev" value="${somaDias(h, PRAZO_PADRAO_DIAS)}"></div>
              </div>
            </section>
          </div>
          <aside class="card resumo">
            <h2>Resumo</h2>
            <div class="aviso" id="res-usuario">Usuário: —</div>
            <div class="aviso" id="res-livro">Livro: —</div>
            <div class="aviso" id="res-datas">Empréstimo: —<br>Devolução: —</div>
            <p class="ajuda">O botão só fica ativo se o livro tiver exemplar disponível.</p>
            <button class="btn btn-primario btn-bloco" id="confirmar" disabled>Confirmar empréstimo</button>
            <a href="#/emprestimos" class="btn btn-secundario btn-bloco">Cancelar</a>
          </aside>
        </div>`,
      bind() {
        function atualizar() {
          const u = estado.usuario, l = estado.livro;
          $('#s-usuario').textContent = u ? `${u.nome} · ${u.telefone} · ${u.email}` : 'Usuário encontrado: nome, telefone e e-mail';
          $('#s-usuario').classList.toggle('vazio', !u);
          $('#s-livro').textContent = l ? `${l.titulo} · ${l.autor} · ${l.disponiveis} de ${l.total} disponíveis` : 'Livro selecionado: título, autor e exemplares disponíveis';
          $('#s-livro').classList.toggle('vazio', !l);
          $('#res-usuario').textContent = 'Usuário: ' + (u ? u.nome : '—');
          $('#res-livro').textContent = 'Livro: ' + (l ? l.titulo : '—');
          const de = $('#d-emp').value, dp = $('#d-prev').value;
          $('#res-datas').innerHTML = `Empréstimo: ${de ? fmtData(de) : '—'}<br>Devolução: ${dp ? fmtData(dp) : '—'}`;
          $('#confirmar').disabled = !(u && l && l.disponiveis > 0 && de && dp && dp >= de);
        }

        // Mostra a lista de resultados para escolher um
        function mostrarResultados(caixa, itens, rotulo, desabilitado, aoEscolher) {
          caixa.innerHTML = itens.length
            ? itens.map((x, i) => `<button type="button" data-i="${i}" ${desabilitado(x) ? 'disabled' : ''}>${rotulo(x)}</button>`).join('')
            : '<button type="button" disabled>Nada encontrado.</button>';
          caixa.hidden = false;
          $$('button[data-i]', caixa).forEach((b) => b.addEventListener('click', () => {
            aoEscolher(itens[Number(b.dataset.i)]);
            caixa.hidden = true;
            atualizar();
          }));
        }

        async function buscarUsuario() {
          const termo = $('#q-usuario').value.trim();
          if (!termo) return;
          const achados = await api('GET', '/api/usuarios?busca=' + encodeURIComponent(termo));
          if (achados.length === 1) { estado.usuario = achados[0]; $('#r-usuario').hidden = true; atualizar(); return; }
          mostrarResultados($('#r-usuario'), achados, (u) => `${esc(u.nome)} — ${esc(u.doc)}`, () => false, (u) => { estado.usuario = u; });
        }
        async function buscarLivro() {
          const termo = $('#q-livro').value.trim();
          if (!termo) return;
          const achados = await api('GET', '/api/livros?busca=' + encodeURIComponent(termo));
          mostrarResultados($('#r-livro'), achados,
            (l) => `${esc(l.titulo)} — ${esc(l.autor)} (${l.disponiveis} de ${l.total} disponíveis)`,
            (l) => l.disponiveis <= 0, (l) => { estado.livro = l; });
        }

        $('#b-usuario').addEventListener('click', buscarUsuario);
        ligarEnter($('#q-usuario'), buscarUsuario);
        $('#b-livro').addEventListener('click', buscarLivro);
        ligarEnter($('#q-livro'), buscarLivro);
        $('#d-emp').addEventListener('change', () => {
          if ($('#d-emp').value) $('#d-prev').value = somaDias($('#d-emp').value, PRAZO_PADRAO_DIAS);
          atualizar();
        });
        $('#d-prev').addEventListener('change', atualizar);

        $('#confirmar').addEventListener('click', async () => {
          try {
            await api('POST', '/api/emprestimos', {
              usuario_id: estado.usuario.id,
              livro_id: estado.livro.id,
              data: $('#d-emp').value,
              prevista: $('#d-prev').value
            });
            toast('Empréstimo registrado.');
            location.hash = '#/emprestimos';
          } catch (erro) {
            toast(erro.message);
          }
        });

        atualizar();
      }
    };
  }

  /* 10. Registrar devolução ------------------------------------------- */
  async function telaDevolucao(params) {
    const q = params.get('q') || '';
    const pre = Number(params.get('emp')) || null;
    let lista = await api('GET', '/api/emprestimos?situacao=ativos&busca=' + encodeURIComponent(q));
    // Veio do botão "Devolver": garante que o empréstimo aparece na lista
    if (pre && !lista.some((e) => e.id === pre)) {
      const todos = await api('GET', '/api/emprestimos?situacao=ativos');
      const e = todos.find((x) => x.id === pre);
      if (e) lista = [e, ...lista];
    }
    let selecionado = lista.find((e) => e.id === pre) || null;
    return {
      menu: 'emprestimos',
      html: `${cabecalho('Registrar devolução', '<a href="#/emprestimos">Voltar para empréstimos</a>')}
        <label for="q-dev">Usuário ou livro</label>
        <div class="linha-busca">
          <div class="grow"><input type="text" id="q-dev" placeholder="CPF, matrícula ou título" value="${esc(q)}"></div>
          <button class="btn btn-primario" id="buscar-dev">Buscar empréstimos</button>
        </div>
        <p class="info">Empréstimos ativos encontrados: ${lista.length}</p>
        <div class="tabela-wrap"><table>
          <thead><tr><th style="width:90px">Selecionar</th><th>Livro</th><th>Usuário</th><th>Prevista</th><th>Situação</th></tr></thead>
          <tbody>${lista.length ? lista.map((e) => `<tr data-id="${e.id}" class="${selecionado?.id === e.id ? 'selecionada' : ''}">
            <td><input type="radio" name="emp" value="${e.id}" aria-label="Selecionar" ${selecionado?.id === e.id ? 'checked' : ''}></td>
            <td>${esc(e.titulo)}</td><td>${esc(e.nome)}</td>
            <td>${fmtData(e.prevista)}</td><td>${tagSituacao(e)}</td>
          </tr>`).join('') : linhaVazia(5, 'Nenhum empréstimo ativo encontrado.')}</tbody>
        </table></div>
        <div class="card devolucao-box">
          <div class="aviso vazio" id="sel-dev">Empréstimo selecionado: livro, usuário e data prevista</div>
          <div class="data"><label for="d-dev">Data da devolução</label><input type="date" id="d-dev" value="${hojeISO()}"></div>
          <button class="btn btn-primario" id="confirmar-dev" disabled>Confirmar devolução</button>
        </div>
        <p class="ajuda" style="margin-top:14px">Ao confirmar, o empréstimo é encerrado e os exemplares disponíveis do livro aumentam em 1.</p>`,
      bind() {
        function atualizar() {
          const box = $('#sel-dev');
          if (selecionado) {
            box.textContent = `${selecionado.titulo} · ${selecionado.nome} · prevista ${fmtData(selecionado.prevista)}`;
            box.classList.remove('vazio');
          }
          $('#confirmar-dev').disabled = !(selecionado && $('#d-dev').value && $('#d-dev').value >= selecionado.data);
          $$('tbody tr[data-id]').forEach((tr) => tr.classList.toggle('selecionada', Number(tr.dataset.id) === selecionado?.id));
        }
        $$('tbody tr[data-id]').forEach((tr) => tr.addEventListener('click', () => {
          selecionado = lista.find((e) => e.id === Number(tr.dataset.id));
          $('input[type=radio]', tr).checked = true;
          atualizar();
        }));
        const buscar = () => { location.hash = '#/devolucao?q=' + encodeURIComponent($('#q-dev').value); };
        $('#buscar-dev').addEventListener('click', buscar);
        ligarEnter($('#q-dev'), buscar);
        $('#d-dev').addEventListener('change', atualizar);
        $('#confirmar-dev').addEventListener('click', async () => {
          try {
            await api('POST', `/api/emprestimos/${selecionado.id}/devolucao`, { devolvido: $('#d-dev').value });
            toast('Devolução registrada.');
            location.hash = '#/emprestimos';
          } catch (erro) {
            toast(erro.message);
          }
        });
        atualizar();
      }
    };
  }

  /* 11–13. Relatórios ------------------------------------------------- */
  function abasRelatorio(ativa) {
    const a = (id, txt) => `<a href="#/relatorios/${id}" class="${ativa === id ? 'ativa' : ''}">${txt}</a>`;
    return `<nav class="abas">${a('historico', 'Histórico do usuário')}${a('disponiveis', 'Disponíveis / emprestados')}${a('atraso', 'Em atraso')}</nav>`;
  }

  // 11. Histórico de empréstimos de um usuário (com período opcional)
  async function telaRelHistorico(params) {
    const uid = Number(params.get('usuario')) || null;
    const q = params.get('q') || '';
    const de = params.get('de') || '';
    const ate = params.get('ate') || '';

    // Descobre o usuário: pelo id, ou pesquisando pelo nome/CPF digitado
    let usuarioId = uid;
    let candidatos = [];
    if (!usuarioId && q) {
      candidatos = await api('GET', '/api/usuarios?busca=' + encodeURIComponent(q));
      if (candidatos.length === 1) usuarioId = candidatos[0].id;
    }
    const relatorio = usuarioId ? await api('GET', `/api/relatorios/historico/${usuarioId}?de=${de}&ate=${ate}`) : null;
    const usuario = relatorio ? relatorio.usuario : null;
    const lista = relatorio ? relatorio.emprestimos : [];
    const abertos = lista.filter((e) => !e.devolvido).length;

    let resumo;
    if (usuario) resumo = `<div class="aviso">${esc(usuario.nome)}, ${esc(usuario.doc)} · ${lista.length} empréstimo(s) no total · ${abertos} em aberto</div>`;
    else if (candidatos.length > 1) resumo = `<div class="aviso">Vários usuários encontrados — escolha um: ${candidatos.map((u) =>
      `<a href="#/relatorios/historico?usuario=${u.id}&de=${de}&ate=${ate}">${esc(u.nome)}</a>`).join(' · ')}</div>`;
    else if (q) resumo = '<div class="aviso vazio">Nenhum usuário encontrado.</div>';
    else resumo = '<div class="aviso vazio">Usuário selecionado: nome, CPF / matrícula · 00 empréstimos no total · 00 em aberto</div>';

    return {
      menu: 'relatorios',
      html: `${cabecalho('Relatórios', perfil())}${abasRelatorio('historico')}
        <div class="linha-busca">
          <div class="grow"><label for="q-hist">Usuário</label>
            <input type="text" id="q-hist" placeholder="Nome, CPF ou matrícula" value="${esc(usuario ? usuario.nome : q)}"></div>
          <div style="width:150px"><label for="de">De</label><input type="date" id="de" value="${de}"></div>
          <div style="width:150px"><label for="ate">Até</label><input type="date" id="ate" value="${ate}"></div>
          <button class="btn btn-primario" id="gerar">Gerar relatório</button>
          <button class="btn btn-secundario" id="exportar" ${lista.length ? '' : 'disabled'}>Exportar</button>
        </div>
        ${resumo}
        <div class="tabela-wrap"><table>
          <thead><tr><th>Livro</th><th>Emprestado em</th><th>Prevista</th><th>Devolvido em</th><th>Situação</th></tr></thead>
          <tbody>${lista.length ? lista.map((e) => `<tr>
            <td>${esc(e.titulo)}</td><td>${fmtData(e.data)}</td><td>${fmtData(e.prevista)}</td>
            <td>${fmtData(e.devolvido)}</td><td>${tagSituacao(e, true)}</td>
          </tr>`).join('') : linhaVazia(5, usuario ? 'Nenhum empréstimo no período.' : 'Selecione um usuário e clique em Gerar relatório.')}</tbody>
        </table></div>`,
      bind() {
        const gerar = () => {
          location.hash = `#/relatorios/historico?q=${encodeURIComponent($('#q-hist').value)}&de=${$('#de').value}&ate=${$('#ate').value}`;
        };
        $('#gerar').addEventListener('click', gerar);
        ligarEnter($('#q-hist'), gerar);
        $('#exportar').addEventListener('click', () => {
          const rotulo = { devolvido: 'Devolvido', atraso: 'Em atraso', prazo: 'Em aberto' };
          baixarCSV(`historico-${norm(usuario.nome).replace(/\s+/g, '-')}.csv`,
            ['Livro', 'Emprestado em', 'Prevista', 'Devolvido em', 'Situação'],
            lista.map((e) => [e.titulo, fmtData(e.data), fmtData(e.prevista), fmtData(e.devolvido), rotulo[e.situacao]]));
        });
      }
    };
  }

  // 12. Livros disponíveis e emprestados
  async function telaRelDisponiveis(params) {
    const mostrar = params.get('m') || 'todos';
    const q = params.get('q') || '';
    const t = norm(q);
    const dados = await api('GET', '/api/relatorios/livros');
    // Filtro feito na própria tela
    const lista = dados.livros.filter((l) => {
      if (mostrar === 'disponiveis' && l.disponiveis <= 0) return false;
      if (mostrar === 'emprestados' && l.emprestados <= 0) return false;
      return !t || [l.titulo, l.autor].some((c) => norm(c).includes(t));
    });
    const opc = (v, txt) => `<option value="${v}" ${mostrar === v ? 'selected' : ''}>${txt}</option>`;
    return {
      menu: 'relatorios',
      html: `${cabecalho('Relatórios', perfil())}${abasRelatorio('disponiveis')}
        <div class="stats tres">
          <div class="stat"><div class="rot">Total de exemplares</div><div class="num">${dados.total}</div></div>
          <div class="stat"><div class="rot">Disponíveis</div><div class="num">${dados.disponiveis}</div></div>
          <div class="stat"><div class="rot">Emprestados</div><div class="num">${dados.emprestados}</div></div>
        </div>
        <div class="linha-busca">
          <div class="w-select"><label for="mostrar">Mostrar</label>
            <select id="mostrar">${opc('todos', 'Todos')}${opc('disponiveis', 'Com exemplares disponíveis')}${opc('emprestados', 'Com exemplares emprestados')}</select></div>
          <div class="grow"><label for="q-disp">Livro</label><input type="text" id="q-disp" placeholder="Título ou autor" value="${esc(q)}"></div>
          <button class="btn btn-primario" id="filtrar">Filtrar</button>
          <button class="btn btn-secundario" id="exportar" ${lista.length ? '' : 'disabled'}>Exportar</button>
        </div>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Livro</th><th>Autor</th><th>Total</th><th>Disponíveis</th><th>Emprestados</th><th>Situação</th></tr></thead>
          <tbody>${lista.length ? lista.map((l) => `<tr>
            <td>${esc(l.titulo)}</td><td>${esc(l.autor)}</td><td>${l.total}</td><td>${l.disponiveis}</td>
            <td>${l.emprestados}</td><td>${tagLivro(l)}</td>
          </tr>`).join('') : linhaVazia(6, 'Nenhum livro encontrado.')}</tbody>
        </table></div>`,
      bind() {
        const filtrar = () => {
          location.hash = `#/relatorios/disponiveis?m=${$('#mostrar').value}&q=${encodeURIComponent($('#q-disp').value)}`;
        };
        $('#filtrar').addEventListener('click', filtrar);
        ligarEnter($('#q-disp'), filtrar);
        $('#exportar').addEventListener('click', () => {
          baixarCSV('livros-disponiveis-emprestados.csv',
            ['Livro', 'Autor', 'Total', 'Disponíveis', 'Emprestados', 'Situação'],
            lista.map((l) => [l.titulo, l.autor, l.total, l.disponiveis, l.emprestados, l.disponiveis > 0 ? 'Disponível' : 'Indisponível']));
        });
      }
    };
  }

  // 13. Empréstimos em atraso
  async function telaRelAtraso(params) {
    const q = params.get('q') || '';
    const t = norm(q);
    const todos = await api('GET', '/api/relatorios/atrasos'); // já vem do maior atraso para o menor
    const lista = todos.filter((e) => !t || [e.titulo, e.nome, e.doc].some((c) => norm(c).includes(t)));
    const usuariosAtraso = new Set(todos.map((e) => e.usuario_id)).size;
    const maior = todos.length ? todos[0].dias_atraso : 0;
    return {
      menu: 'relatorios',
      html: `${cabecalho('Relatórios', perfil())}${abasRelatorio('atraso')}
        <div class="stats tres">
          <div class="stat destaque"><div class="rot">Empréstimos em atraso</div><div class="num">${todos.length}</div></div>
          <div class="stat"><div class="rot">Usuários com atraso</div><div class="num">${usuariosAtraso}</div></div>
          <div class="stat"><div class="rot">Maior atraso (dias)</div><div class="num">${maior}</div></div>
        </div>
        <label for="q-atr">Usuário ou livro</label>
        <div class="linha-busca">
          <div class="grow"><input type="text" id="q-atr" placeholder="Nome, CPF, matrícula ou título" value="${esc(q)}"></div>
          <button class="btn btn-primario" id="filtrar">Filtrar</button>
          <button class="btn btn-secundario" id="exportar" ${lista.length ? '' : 'disabled'}>Exportar</button>
        </div>
        <div class="tabela-wrap"><table>
          <thead><tr><th>Livro</th><th>Usuário</th><th>Contato</th><th>Prevista</th><th>Dias de atraso</th><th>Ações</th></tr></thead>
          <tbody>${lista.length ? lista.map((e) => `<tr>
              <td>${esc(e.titulo)}</td><td>${esc(e.nome)}</td>
              <td>${esc(e.telefone)}<br>${esc(e.email)}</td><td>${fmtData(e.prevista)}</td>
              <td><span class="tag preta">${e.dias_atraso} ${e.dias_atraso === 1 ? 'dia' : 'dias'}</span></td>
              <td><a href="#/devolucao?emp=${e.id}">Devolver</a></td></tr>`).join('')
            : linhaVazia(6, 'Nenhum empréstimo em atraso.')}</tbody>
        </table></div>`,
      bind() {
        const filtrar = () => { location.hash = '#/relatorios/atraso?q=' + encodeURIComponent($('#q-atr').value); };
        $('#filtrar').addEventListener('click', filtrar);
        ligarEnter($('#q-atr'), filtrar);
        $('#exportar').addEventListener('click', () => {
          baixarCSV('emprestimos-em-atraso.csv',
            ['Livro', 'Usuário', 'Telefone', 'E-mail', 'Prevista', 'Dias de atraso'],
            lista.map((e) => [e.titulo, e.nome, e.telefone, e.email, fmtData(e.prevista), e.dias_atraso]));
        });
      }
    };
  }

  function telaErro(msg, voltar) {
    return {
      html: `${cabecalho('Ops')}<div class="aviso">${esc(msg)}</div><a href="${voltar}">Voltar</a>`,
      bind() {}
    };
  }

  /* ---------------- Roteador ---------------- */
  const rotas = [
    [/^\/login$/, () => telaLogin(), true],
    [/^\/recuperar$/, () => telaRecuperar(), true],
    [/^\/inicio$/, () => telaInicio()],
    [/^\/livros$/, (m, p) => telaLivros(p)],
    [/^\/livros\/novo$/, () => telaLivroForm(null)],
    [/^\/livros\/editar\/(\d+)$/, (m) => telaLivroForm(m[1])],
    [/^\/usuarios$/, (m, p) => telaUsuarios(p)],
    [/^\/usuarios\/novo$/, () => telaUsuarioForm(null)],
    [/^\/usuarios\/editar\/(\d+)$/, (m) => telaUsuarioForm(m[1])],
    [/^\/emprestimos$/, (m, p) => telaEmprestimos(p)],
    [/^\/emprestimos\/novo$/, (m, p) => telaNovoEmprestimo(p)],
    [/^\/devolucao$/, (m, p) => telaDevolucao(p)],
    [/^\/relatorios\/historico$/, (m, p) => telaRelHistorico(p)],
    [/^\/relatorios\/disponiveis$/, (m, p) => telaRelDisponiveis(p)],
    [/^\/relatorios\/atraso$/, (m, p) => telaRelAtraso(p)]
  ];

  async function rotear() {
    const hashAtual = location.hash;
    const hash = hashAtual.replace(/^#/, '') || '/inicio';
    const [caminho, query = ''] = hash.split('?');
    const params = new URLSearchParams(query);
    const rota = rotas.find(([re]) => re.test(caminho));

    if (!rota) { location.hash = logado() ? '#/inicio' : '#/login'; return; }
    const publica = !!rota[2];
    if (!publica && !logado()) { location.hash = '#/login'; return; }
    if (publica && logado()) { location.hash = '#/inicio'; return; }

    // Busca os dados da tela na API
    let tela;
    try {
      tela = await rota[1](caminho.match(rota[0]), params);
    } catch (erro) {
      if (!logado()) return; // a sessão expirou e já fomos mandados para o login
      tela = telaErro(erro.message, '#/inicio');
    }
    if (location.hash !== hashAtual) return; // o usuário já mudou de tela enquanto carregava

    const auth = $('#auth'), app = $('#app');
    if (publica) {
      app.hidden = true;
      $('#view').innerHTML = '';
      auth.hidden = false;
      auth.innerHTML = tela.html;
    } else {
      auth.hidden = true;
      auth.innerHTML = '';
      app.hidden = false;
      $('#view').innerHTML = tela.html;
      $$('.menu a').forEach((a) => a.classList.toggle('ativo', a.dataset.menu === tela.menu));
    }
    document.title = ($('h1')?.textContent || 'Biblioteca') + ' · Controle de Biblioteca';
    window.scrollTo(0, 0);
    tela.bind && tela.bind();
  }

  /* ---------------- Inicialização ---------------- */
  $('#sair').addEventListener('click', (ev) => { ev.preventDefault(); sair(); });
  window.addEventListener('hashchange', rotear);
  rotear();
})();

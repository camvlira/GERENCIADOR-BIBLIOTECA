// =====================================================================
// server.js — Sistema de Controle de Biblioteca
// Node.js + Express + SQLite (better-sqlite3)
// Para rodar: npm start  ->  http://localhost:3000
// =====================================================================
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const PORTA = 3000;
const SEGREDO = 'chave-secreta-da-biblioteca'; // usada para assinar o token de login

// ---------------------------------------------------------------------
// BANCO DE DADOS
// ---------------------------------------------------------------------
// Nos testes usamos um banco só na memória (process.env.BANCO = ':memory:')
let arquivoBanco = process.env.BANCO;
if (!arquivoBanco) {
  const pastaBanco = path.join(__dirname, 'database');
  fs.mkdirSync(pastaBanco, { recursive: true });
  arquivoBanco = path.join(pastaBanco, 'biblioteca.db');
}
const db = new Database(arquivoBanco);
db.pragma('foreign_keys = ON');

// Função usada nas buscas: ignora acentos e maiúsculas ("atica" encontra "Ática")
db.function('norm', (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());

db.exec(`
  CREATE TABLE IF NOT EXISTS bibliotecarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    matricula TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL,
    perfil TEXT NOT NULL DEFAULT 'bibliotecario'   -- 'admin' ou 'bibliotecario'
  );

  CREATE TABLE IF NOT EXISTS livros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    autor TEXT NOT NULL,
    editora TEXT NOT NULL,
    ano INTEGER NOT NULL,
    total INTEGER NOT NULL CHECK (total >= 1),
    disponiveis INTEGER NOT NULL CHECK (disponiveis >= 0 AND disponiveis <= total)
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    doc TEXT NOT NULL UNIQUE,                       -- CPF ou matrícula
    telefone TEXT NOT NULL,
    email TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS emprestimos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    livro_id INTEGER,
    usuario_id INTEGER NOT NULL,
    livro_titulo TEXT,                              -- guarda o título se o livro for excluído
    data TEXT NOT NULL,                             -- data do empréstimo
    prevista TEXT NOT NULL,                         -- devolução prevista
    devolvido TEXT,                                 -- data da devolução (vazio = em aberto)
    FOREIGN KEY (livro_id) REFERENCES livros(id) ON DELETE SET NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
`);

// Bancos criados antes desta versão não tinham a coluna "perfil": adiciona agora
const colunas = db.prepare('PRAGMA table_info(bibliotecarios)').all().map((c) => c.name);
if (!colunas.includes('perfil')) {
  db.exec("ALTER TABLE bibliotecarios ADD COLUMN perfil TEXT NOT NULL DEFAULT 'bibliotecario'");
  db.prepare("UPDATE bibliotecarios SET perfil = 'admin' WHERE matricula = '0001'").run();
}

// Data no formato AAAA-MM-DD (dias = quantos dias somar a hoje)
function dataISO(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}
function somaDias(data, dias) {
  const d = new Date(data + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Dados de exemplo (só quando o banco está vazio)
function inserirDadosIniciais() {
  const senhaHash = bcrypt.hashSync('123456', 10);
  const inserirBibliotecario = db.prepare(`INSERT OR IGNORE INTO bibliotecarios (nome, email, matricula, senha, perfil)
    VALUES (?, ?, ?, ?, ?)`);
  inserirBibliotecario.run('Administrador(a)', 'admin@biblioteca.com', '0001', senhaHash, 'admin');
  inserirBibliotecario.run('Bibliotecário(a)', 'bibliotecario@biblioteca.com', '0002', senhaHash, 'bibliotecario');

  const quantidade = db.prepare('SELECT COUNT(*) AS total FROM livros').get().total;
  if (quantidade > 0) return;

  const inserirUsuario = db.prepare('INSERT INTO usuarios (id, nome, doc, telefone, email) VALUES (?, ?, ?, ?, ?)');
  const inserirLivro = db.prepare('INSERT INTO livros (id, titulo, autor, editora, ano, total, disponiveis) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const inserirEmprestimo = db.prepare(`INSERT INTO emprestimos (id, livro_id, usuario_id, livro_titulo, data, prevista, devolvido)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const usuarios = [
    [1, 'Camilly Lira', '2023001', '(85) 98888-1111', 'camilly@exemplo.com'],
    [2, 'Rafaela Quevedo', '2023002', '(85) 98888-2222', 'rafaela@exemplo.com'],
    [3, 'João Pereira', '123.456.789-00', '(85) 99999-3333', 'joao@exemplo.com'],
    [4, 'Maria Souza', '2023004', '(85) 97777-4444', 'maria@exemplo.com'],
    [5, 'Pedro Alves', '2023005', '(85) 96666-5555', 'pedro@exemplo.com'],
    [6, 'Ana Lima', '2023006', '(85) 95555-6666', 'ana@exemplo.com']
  ];
  const livros = [
    [1, 'Dom Casmurro', 'Machado de Assis', 'Ática', 1899, 3, 2],
    [2, 'O Cortiço', 'Aluísio Azevedo', 'Moderna', 1890, 2, 0],
    [3, 'Vidas Secas', 'Graciliano Ramos', 'Record', 1938, 4, 3],
    [4, 'Iracema', 'José de Alencar', 'Ática', 1865, 2, 1],
    [5, 'O Quinze', 'Rachel de Queiroz', 'José Olympio', 1930, 3, 2],
    [6, 'Capitães da Areia', 'Jorge Amado', 'Companhia das Letras', 1937, 1, 0],
    [7, 'A Hora da Estrela', 'Clarice Lispector', 'Rocco', 1977, 2, 2],
    [8, 'Grande Sertão: Veredas', 'Guimarães Rosa', 'Nova Fronteira', 1956, 2, 2]
  ];
  const emprestimos = [
    [1, 1, 1, 'Dom Casmurro', dataISO(-7), dataISO(0), null],
    [2, 2, 3, 'O Cortiço', dataISO(-15), dataISO(-8), null],
    [3, 2, 4, 'O Cortiço', dataISO(-5), dataISO(2), null],
    [4, 3, 2, 'Vidas Secas', dataISO(-7), dataISO(0), null],
    [5, 4, 1, 'Iracema', dataISO(-12), dataISO(-5), null],
    [6, 5, 5, 'O Quinze', dataISO(-3), dataISO(4), null],
    [7, 6, 6, 'Capitães da Areia', dataISO(-20), dataISO(-13), null],
    [8, 7, 1, 'A Hora da Estrela', dataISO(-40), dataISO(-33), dataISO(-34)]
  ];

  const inserirTudo = db.transaction(() => {
    usuarios.forEach((u) => inserirUsuario.run(...u));
    livros.forEach((l) => inserirLivro.run(...l));
    emprestimos.forEach((e) => inserirEmprestimo.run(...e));
  });
  inserirTudo();
}
inserirDadosIniciais();


// ---------------------------------------------------------------------
// APLICAÇÃO EXPRESS
// ---------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // entrega index.html, app.js e style.css


// ---------------------------------------------------------------------
// CONTROLE DE ACESSO
// ---------------------------------------------------------------------

// Autenticação: só passa quem mandou um token válido (recebido no login)
function exigirLogin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.bibliotecario = jwt.verify(token, SEGREDO); // { id, nome, perfil }
    next();
  } catch {
    res.status(401).json({ erro: 'Faça login para continuar.' });
  }
}

// Autorização: só passa quem tem perfil "admin"
function exigirAdmin(req, res, next) {
  if (req.bibliotecario.perfil !== 'admin') {
    return res.status(403).json({ erro: 'Somente o administrador pode fazer isso.' });
  }
  next();
}


// ---------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------

// POST /api/login   { login, senha }  ->  { token, nome, perfil }
app.post('/api/login', (req, res) => {
  const { login, senha } = req.body || {};
  if (!login || !senha) return res.status(400).json({ erro: 'Informe login e senha.' });

  const bibliotecario = db.prepare('SELECT * FROM bibliotecarios WHERE lower(email) = lower(?) OR matricula = ?')
    .get(String(login).trim(), String(login).trim());

  if (!bibliotecario || !bcrypt.compareSync(String(senha), bibliotecario.senha)) {
    return res.status(401).json({ erro: 'E-mail/matrícula ou senha incorretos.' });
  }

  const dados = { id: bibliotecario.id, nome: bibliotecario.nome, perfil: bibliotecario.perfil };
  const token = jwt.sign(dados, SEGREDO, { expiresIn: '8h' });
  res.json({ token, nome: dados.nome, perfil: dados.perfil });
});

// Daqui para baixo, todas as rotas /api exigem login
app.use('/api', exigirLogin);


// ---------------------------------------------------------------------
// LIVROS
// ---------------------------------------------------------------------

// Confere os dados do livro. Devolve a mensagem de erro, ou null se estiver tudo certo.
function validarLivro(l) {
  if (!l.titulo || !l.autor || !l.editora || !l.ano || !l.total) return 'Preencha todos os campos.';
  if (!Number.isInteger(Number(l.ano)) || l.ano < 1000 || l.ano > new Date().getFullYear()) return 'Ano inválido.';
  if (!Number.isInteger(Number(l.total)) || l.total < 1) return 'Exemplares deve ser um número maior que zero.';
  return null;
}

// GET /api/livros?busca=machado  ->  lista de livros (título, autor ou editora)
app.get('/api/livros', (req, res) => {
  const busca = `%${req.query.busca || ''}%`;
  const livros = db.prepare(`SELECT * FROM livros
    WHERE norm(titulo) LIKE norm(?) OR norm(autor) LIKE norm(?) OR norm(editora) LIKE norm(?)
    ORDER BY titulo`).all(busca, busca, busca);
  res.json(livros);
});

// GET /api/livros/3
app.get('/api/livros/:id', (req, res) => {
  const livro = db.prepare('SELECT * FROM livros WHERE id = ?').get(req.params.id);
  if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });
  res.json(livro);
});

// POST /api/livros   { titulo, autor, editora, ano, total }
app.post('/api/livros', (req, res) => {
  const l = req.body || {};
  const erro = validarLivro(l);
  if (erro) return res.status(400).json({ erro });

  const resultado = db.prepare('INSERT INTO livros (titulo, autor, editora, ano, total, disponiveis) VALUES (?, ?, ?, ?, ?, ?)')
    .run(l.titulo, l.autor, l.editora, l.ano, l.total, l.total); // no início, todos os exemplares estão disponíveis
  res.status(201).json(db.prepare('SELECT * FROM livros WHERE id = ?').get(resultado.lastInsertRowid));
});

// PUT /api/livros/3   { titulo, autor, editora, ano, total }
app.put('/api/livros/:id', (req, res) => {
  const atual = db.prepare('SELECT * FROM livros WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Livro não encontrado.' });

  const l = req.body || {};
  const erro = validarLivro(l);
  if (erro) return res.status(400).json({ erro });

  // Os exemplares que estão emprestados continuam emprestados
  const emprestados = atual.total - atual.disponiveis;
  if (l.total < emprestados) {
    return res.status(400).json({ erro: `Há ${emprestados} exemplar(es) emprestado(s). O total não pode ser menor.` });
  }

  db.prepare('UPDATE livros SET titulo = ?, autor = ?, editora = ?, ano = ?, total = ?, disponiveis = ? WHERE id = ?')
    .run(l.titulo, l.autor, l.editora, l.ano, l.total, l.total - emprestados, atual.id);
  res.json(db.prepare('SELECT * FROM livros WHERE id = ?').get(atual.id));
});

// DELETE /api/livros/3   (somente admin)
app.delete('/api/livros/:id', exigirAdmin, (req, res) => {
  const livro = db.prepare('SELECT * FROM livros WHERE id = ?').get(req.params.id);
  if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });

  const emAberto = db.prepare('SELECT COUNT(*) AS total FROM emprestimos WHERE livro_id = ? AND devolvido IS NULL').get(livro.id).total;
  if (emAberto > 0) {
    return res.status(409).json({ erro: `"${livro.titulo}" tem ${emAberto} empréstimo(s) em aberto. Registre a devolução primeiro.` });
  }

  const excluir = db.transaction(() => {
    // guarda o título no histórico, para os relatórios continuarem mostrando o nome
    db.prepare('UPDATE emprestimos SET livro_titulo = ? WHERE livro_id = ?').run(livro.titulo, livro.id);
    db.prepare('DELETE FROM livros WHERE id = ?').run(livro.id);
  });
  excluir();
  res.status(204).end();
});


// ---------------------------------------------------------------------
// USUÁRIOS
// ---------------------------------------------------------------------

function validarUsuario(u) {
  if (!u.nome || !u.doc || !u.telefone || !u.email) return 'Preencha todos os campos.';
  if (String(u.telefone).replace(/\D/g, '').length < 10) return 'Telefone inválido (informe o DDD).';
  if (!/^\S+@\S+\.\S+$/.test(u.email)) return 'E-mail inválido.';
  return null;
}

// GET /api/usuarios?busca=camilly  ->  lista (nome, CPF/matrícula ou e-mail)
app.get('/api/usuarios', (req, res) => {
  const busca = `%${req.query.busca || ''}%`;
  const usuarios = db.prepare(`SELECT * FROM usuarios
    WHERE norm(nome) LIKE norm(?) OR doc LIKE ? OR norm(email) LIKE norm(?)
    ORDER BY nome`).all(busca, busca, busca);
  res.json(usuarios);
});

// GET /api/usuarios/2
app.get('/api/usuarios/:id', (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(usuario);
});

// POST /api/usuarios   { nome, doc, telefone, email }
app.post('/api/usuarios', (req, res) => {
  const u = req.body || {};
  const erro = validarUsuario(u);
  if (erro) return res.status(400).json({ erro });

  const repetido = db.prepare('SELECT id FROM usuarios WHERE doc = ?').get(u.doc);
  if (repetido) return res.status(409).json({ erro: 'Este CPF ou matrícula já está cadastrado.' });

  const resultado = db.prepare('INSERT INTO usuarios (nome, doc, telefone, email) VALUES (?, ?, ?, ?)')
    .run(u.nome, u.doc, u.telefone, u.email);
  res.status(201).json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(resultado.lastInsertRowid));
});

// PUT /api/usuarios/2   { nome, doc, telefone, email }
app.put('/api/usuarios/:id', (req, res) => {
  const atual = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const u = req.body || {};
  const erro = validarUsuario(u);
  if (erro) return res.status(400).json({ erro });

  const repetido = db.prepare('SELECT id FROM usuarios WHERE doc = ? AND id <> ?').get(u.doc, atual.id);
  if (repetido) return res.status(409).json({ erro: 'Este CPF ou matrícula já está cadastrado.' });

  db.prepare('UPDATE usuarios SET nome = ?, doc = ?, telefone = ?, email = ? WHERE id = ?')
    .run(u.nome, u.doc, u.telefone, u.email, atual.id);
  res.json(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(atual.id));
});


// ---------------------------------------------------------------------
// EMPRÉSTIMOS E DEVOLUÇÕES
// ---------------------------------------------------------------------

// Busca os empréstimos já com o título do livro e os dados do usuário
const SQL_EMPRESTIMOS = `
  SELECT e.*, COALESCE(l.titulo, e.livro_titulo, '(livro excluído)') AS titulo,
         u.nome, u.doc, u.telefone, u.email
  FROM emprestimos e
  LEFT JOIN livros l ON l.id = e.livro_id
  JOIN usuarios u    ON u.id = e.usuario_id`;

// Acrescenta a situação (prazo, atraso ou devolvido) e os dias de atraso
function completar(e) {
  const fim = e.devolvido || dataISO();
  e.dias_atraso = Math.max(0, Math.round((new Date(fim) - new Date(e.prevista)) / 86400000));
  if (e.devolvido) e.situacao = 'devolvido';
  else if (e.prevista < dataISO()) e.situacao = 'atraso';
  else e.situacao = 'prazo';
  return e;
}

// GET /api/emprestimos?situacao=ativos&busca=camilly
// situacao: ativos (padrão) | atraso | devolvidos | todos
app.get('/api/emprestimos', (req, res) => {
  const situacao = req.query.situacao || 'ativos';
  const busca = `%${req.query.busca || ''}%`;

  let lista = db.prepare(`${SQL_EMPRESTIMOS}
    WHERE norm(COALESCE(l.titulo, e.livro_titulo)) LIKE norm(?) OR norm(u.nome) LIKE norm(?) OR u.doc LIKE ?
    ORDER BY e.prevista`).all(busca, busca, busca).map(completar);

  if (situacao === 'ativos') lista = lista.filter((e) => e.situacao !== 'devolvido');
  if (situacao === 'atraso') lista = lista.filter((e) => e.situacao === 'atraso');
  if (situacao === 'devolvidos') lista = lista.filter((e) => e.situacao === 'devolvido');
  res.json(lista);
});

// POST /api/emprestimos   { usuario_id, livro_id, data?, prevista? }
app.post('/api/emprestimos', (req, res) => {
  const dados = req.body || {};
  const data = dados.data || dataISO();
  const prevista = dados.prevista || somaDias(data, 7); // prazo padrão: 7 dias

  if (!dados.usuario_id || !dados.livro_id) return res.status(400).json({ erro: 'Escolha o usuário e o livro.' });
  if (prevista < data) return res.status(400).json({ erro: 'A devolução não pode ser antes do empréstimo.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(dados.usuario_id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const livro = db.prepare('SELECT * FROM livros WHERE id = ?').get(dados.livro_id);
  if (!livro) return res.status(404).json({ erro: 'Livro não encontrado.' });
  if (livro.disponiveis < 1) return res.status(409).json({ erro: 'Este livro não tem exemplar disponível.' });

  const registrar = db.transaction(() => {
    const r = db.prepare('INSERT INTO emprestimos (livro_id, usuario_id, livro_titulo, data, prevista) VALUES (?, ?, ?, ?, ?)')
      .run(livro.id, usuario.id, livro.titulo, data, prevista);
    db.prepare('UPDATE livros SET disponiveis = disponiveis - 1 WHERE id = ?').run(livro.id); // um exemplar a menos
    return r.lastInsertRowid;
  });
  const id = registrar();
  res.status(201).json(completar(db.prepare(`${SQL_EMPRESTIMOS} WHERE e.id = ?`).get(id)));
});

// POST /api/emprestimos/5/devolucao   { devolvido? }
app.post('/api/emprestimos/:id/devolucao', (req, res) => {
  const emprestimo = db.prepare('SELECT * FROM emprestimos WHERE id = ?').get(req.params.id);
  if (!emprestimo) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });
  if (emprestimo.devolvido) return res.status(409).json({ erro: 'Este empréstimo já foi devolvido.' });

  const devolvido = (req.body && req.body.devolvido) || dataISO();
  if (devolvido < emprestimo.data) return res.status(400).json({ erro: 'A devolução não pode ser antes do empréstimo.' });

  const devolver = db.transaction(() => {
    db.prepare('UPDATE emprestimos SET devolvido = ? WHERE id = ?').run(devolvido, emprestimo.id);
    db.prepare('UPDATE livros SET disponiveis = MIN(total, disponiveis + 1) WHERE id = ?').run(emprestimo.livro_id); // volta para a estante
  });
  devolver();
  res.json(completar(db.prepare(`${SQL_EMPRESTIMOS} WHERE e.id = ?`).get(emprestimo.id)));
});


// ---------------------------------------------------------------------
// RELATÓRIOS E TELA INICIAL
// ---------------------------------------------------------------------

// GET /api/relatorios/historico/1?de=2026-10-01&ate=2026-11-30
// Histórico de empréstimos de um usuário em um período (de/ate opcionais)
app.get('/api/relatorios/historico/:usuarioId', (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.usuarioId);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const de = req.query.de || '0000-01-01';
  const ate = req.query.ate || '9999-12-31';
  const emprestimos = db.prepare(`${SQL_EMPRESTIMOS} WHERE e.usuario_id = ? AND e.data BETWEEN ? AND ? ORDER BY e.data DESC`)
    .all(usuario.id, de, ate).map(completar);
  res.json({ usuario, emprestimos });
});

// GET /api/relatorios/livros  ->  totais + livros com disponíveis e emprestados
app.get('/api/relatorios/livros', (req, res) => {
  const livros = db.prepare('SELECT *, total - disponiveis AS emprestados FROM livros ORDER BY titulo').all();
  const total = livros.reduce((soma, l) => soma + l.total, 0);
  const disponiveis = livros.reduce((soma, l) => soma + l.disponiveis, 0);
  res.json({ total, disponiveis, emprestados: total - disponiveis, livros });
});

// GET /api/relatorios/atrasos  ->  empréstimos em atraso (maior atraso primeiro)
app.get('/api/relatorios/atrasos', (req, res) => {
  const atrasos = db.prepare(`${SQL_EMPRESTIMOS} WHERE e.devolvido IS NULL AND e.prevista < ?`)
    .all(dataISO()).map(completar)
    .sort((a, b) => b.dias_atraso - a.dias_atraso);
  res.json(atrasos);
});

// GET /api/inicio  ->  números da tela inicial
app.get('/api/inicio', (req, res) => {
  const livros = db.prepare('SELECT COUNT(*) AS titulos, COALESCE(SUM(disponiveis), 0) AS disponiveis FROM livros').get();
  const ativos = db.prepare(`${SQL_EMPRESTIMOS} WHERE e.devolvido IS NULL ORDER BY titulo`).all().map(completar);
  res.json({
    titulos: livros.titulos,
    disponiveis: livros.disponiveis,
    ativos: ativos.length,
    atrasados: ativos.filter((e) => e.situacao === 'atraso').length,
    devolucoesHoje: ativos.filter((e) => e.prevista === dataISO())
  });
});


// ---------------------------------------------------------------------
// Liga o servidor (quando rodado com "npm start"; nos testes não liga)
// ---------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORTA, () => {
    console.log(`Sistema disponível em http://localhost:${PORTA}`);
    console.log('Admin: admin@biblioteca.com (0001) | Bibliotecário: bibliotecario@biblioteca.com (0002) | senha 123456');
  });
}

module.exports = app;

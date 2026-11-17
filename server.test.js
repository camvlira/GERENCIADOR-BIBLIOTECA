// =====================================================================
// server.test.js — testes dos serviços da API
// Para rodar: npm test
// Usa um banco novo só na memória (não mexe no database/biblioteca.db).
// =====================================================================
process.env.BANCO = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('./server');

let servidor, endereco, tokenAdmin, tokenBibliotecario;

// Chama a API e devolve { status, dados }
async function chamar(metodo, caminho, corpo, token) {
  const resposta = await fetch(endereco + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await resposta.text();
  return { status: resposta.status, dados: texto ? JSON.parse(texto) : null };
}

before(async () => {
  servidor = app.listen(0); // qualquer porta livre
  await new Promise((pronto) => servidor.once('listening', pronto));
  endereco = `http://localhost:${servidor.address().port}/api`;
  tokenAdmin = (await chamar('POST', '/login', { login: 'admin@biblioteca.com', senha: '123456' })).dados.token;
  tokenBibliotecario = (await chamar('POST', '/login', { login: '0002', senha: '123456' })).dados.token;
});

after(() => servidor.close());

// ---------- Login e controle de acesso ----------

test('login com senha certa devolve token e perfil', async () => {
  const r = await chamar('POST', '/login', { login: '0001', senha: '123456' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.dados.token);
  assert.strictEqual(r.dados.perfil, 'admin');
});

test('login com senha errada devolve 401', async () => {
  const r = await chamar('POST', '/login', { login: 'admin@biblioteca.com', senha: 'errada' });
  assert.strictEqual(r.status, 401);
});

test('rota protegida sem token devolve 401', async () => {
  const r = await chamar('GET', '/livros');
  assert.strictEqual(r.status, 401);
});

test('bibliotecário (não admin) não pode excluir livro: 403', async () => {
  const r = await chamar('DELETE', '/livros/8', null, tokenBibliotecario);
  assert.strictEqual(r.status, 403);
});

// ---------- Livros ----------

test('pesquisa de livros ignora acentos', async () => {
  const r = await chamar('GET', '/livros?busca=atica', null, tokenAdmin);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.dados.length, 2); // Dom Casmurro e Iracema (editora Ática)
});

test('cadastro de livro válido', async () => {
  const r = await chamar('POST', '/livros', { titulo: 'Teste', autor: 'A', editora: 'E', ano: 2020, total: 2 }, tokenAdmin);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.dados.disponiveis, 2);
});

test('cadastro de livro sem título devolve 400', async () => {
  const r = await chamar('POST', '/livros', { autor: 'A', editora: 'E', ano: 2020, total: 2 }, tokenAdmin);
  assert.strictEqual(r.status, 400);
});

test('alterar livro não deixa o total ficar menor que os emprestados', async () => {
  // O Cortiço (id 2): 2 exemplares, os 2 emprestados
  const r = await chamar('PUT', '/livros/2', { titulo: 'O Cortiço', autor: 'Aluísio Azevedo', editora: 'Moderna', ano: 1890, total: 1 }, tokenAdmin);
  assert.strictEqual(r.status, 400);
});

test('excluir livro: bloqueia com empréstimo em aberto e permite sem', async () => {
  assert.strictEqual((await chamar('DELETE', '/livros/1', null, tokenAdmin)).status, 409);
  assert.strictEqual((await chamar('DELETE', '/livros/8', null, tokenAdmin)).status, 204);
});

// ---------- Usuários ----------

test('cadastro de usuário e CPF/matrícula repetido', async () => {
  const novo = { nome: 'Lucas', doc: '999', telefone: '(85) 90000-0000', email: 'lucas@exemplo.com' };
  assert.strictEqual((await chamar('POST', '/usuarios', novo, tokenAdmin)).status, 201);
  assert.strictEqual((await chamar('POST', '/usuarios', novo, tokenAdmin)).status, 409);
});

// ---------- Empréstimos e devoluções ----------

test('empréstimo diminui os exemplares disponíveis', async () => {
  const antes = (await chamar('GET', '/livros/3', null, tokenAdmin)).dados.disponiveis;
  const r = await chamar('POST', '/emprestimos', { usuario_id: 2, livro_id: 3 }, tokenAdmin);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.dados.situacao, 'prazo');
  const depois = (await chamar('GET', '/livros/3', null, tokenAdmin)).dados.disponiveis;
  assert.strictEqual(depois, antes - 1);
});

test('não empresta livro sem exemplar disponível: 409', async () => {
  const r = await chamar('POST', '/emprestimos', { usuario_id: 1, livro_id: 6 }, tokenAdmin);
  assert.strictEqual(r.status, 409);
});

test('devolução aumenta os disponíveis e não pode ser feita duas vezes', async () => {
  const antes = (await chamar('GET', '/livros/2', null, tokenAdmin)).dados.disponiveis;
  const r = await chamar('POST', '/emprestimos/2/devolucao', {}, tokenAdmin);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.dados.situacao, 'devolvido');
  const depois = (await chamar('GET', '/livros/2', null, tokenAdmin)).dados.disponiveis;
  assert.strictEqual(depois, antes + 1);
  assert.strictEqual((await chamar('POST', '/emprestimos/2/devolucao', {}, tokenAdmin)).status, 409);
});

test('consulta de empréstimos em atraso', async () => {
  const r = await chamar('GET', '/emprestimos?situacao=atraso', null, tokenAdmin);
  assert.strictEqual(r.status, 200);
  assert.ok(r.dados.length > 0);
  assert.ok(r.dados.every((e) => e.situacao === 'atraso' && e.dias_atraso > 0));
});

// ---------- Relatórios ----------

test('relatório: histórico do usuário', async () => {
  const r = await chamar('GET', '/relatorios/historico/1', null, tokenAdmin);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.dados.usuario.nome, 'Camilly Lira');
  assert.strictEqual(r.dados.emprestimos.length, 3);
});

test('relatório: livros disponíveis e emprestados', async () => {
  const r = await chamar('GET', '/relatorios/livros', null, tokenAdmin);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.dados.total, r.dados.disponiveis + r.dados.emprestados);
});

test('relatório: atrasos, do maior para o menor', async () => {
  const r = await chamar('GET', '/relatorios/atrasos', null, tokenAdmin);
  assert.strictEqual(r.status, 200);
  const dias = r.dados.map((e) => e.dias_atraso);
  assert.deepStrictEqual(dias, [...dias].sort((a, b) => b - a));
});

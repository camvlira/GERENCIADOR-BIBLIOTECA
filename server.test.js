// =====================================================================
// server.test.js — testes de interface com Selenium
// Para rodar: npm test
// O servidor usa um banco em memória: não altera database/biblioteca.db.
// Requer Google Chrome instalado.
// =====================================================================

process.env.BANCO = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const app = require('./server');

let servidor;
let endereco;
let driver;

// ---------- Funções de ajuda ----------

// Espera o elemento existir e aparecer na tela
const esperar = async (seletor, tempo = 8000) => {
  const elemento = await driver.wait(until.elementLocated(By.css(seletor)), tempo);
  await driver.wait(until.elementIsVisible(elemento), tempo);
  return elemento;
};

const clicar = async (seletor) => {
  const elemento = await esperar(seletor);
  await driver.wait(until.elementIsEnabled(elemento), 5000);
  await elemento.click();
  return elemento;
};

const preencher = async (seletor, valor) => {
  const elemento = await esperar(seletor);
  await elemento.clear();
  await elemento.sendKeys(String(valor));
  return elemento;
};

// Espera (até 8 segundos) o texto aparecer dentro do elemento.
// Procura o elemento de novo a cada tentativa, porque as telas são redesenhadas.
const aguardarTexto = async (seletor, texto) => {
  await driver.wait(async () => {
    try {
      const elemento = await driver.findElement(By.css(seletor));
      return (await elemento.getText()).includes(texto);
    } catch {
      return false;
    }
  }, 8000, `Esperava ver "${texto}" em ${seletor}`);
};

const textoDe = async (seletor) => driver.findElement(By.css(seletor)).getText();

// Abre uma tela e espera o título (h1) dela aparecer
async function abrirTela(caminho, titulo) {
  await driver.get(endereco + '/#' + caminho);
  await aguardarTexto('h1', titulo);
}

async function abrirSistema() {
  // Apaga a sessão e recarrega a página: cada teste começa sem ninguém logado.
  await driver.get(endereco + '/#/login');
  await driver.executeScript('sessionStorage.clear(); localStorage.clear();');
  await driver.navigate().refresh();
  await esperar('#form-login');
}

async function login(usuario, senha = '123456') {
  await abrirSistema();
  await preencher('#login', usuario);
  await preencher('#senha', senha);
  await clicar('#form-login button[type="submit"]');
}

async function loginAdmin() {
  await login('admin@biblioteca.com');
  await driver.wait(until.urlContains('#/inicio'), 8000);
  await aguardarTexto('h1', 'Início');
}

async function abrirLivros() {
  await abrirTela('/livros', 'Livros');
  await aguardarTexto('.info', 'Resultados');
}

async function abrirNovoLivro() {
  await abrirTela('/livros/novo', 'Cadastro de livro');
}

async function preencherLivro({
  titulo,
  autor = 'Autor de teste',
  editora = 'Editora de teste',
  ano = '2024',
  exemplares = '2'
}) {
  if (titulo !== undefined) await preencher('#titulo', titulo);
  await preencher('#autor', autor);
  await preencher('#editora', editora);
  await preencher('#ano', ano);
  await preencher('#exemplares', exemplares);
}

// Clica em "Excluir" na linha do livro e confirma na janela
async function excluirLivroDaLista(titulo) {
  const botao = await driver.wait(
    until.elementLocated(By.xpath(`//tr[td[contains(., '${titulo}')]]//button[@data-excluir]`)),
    8000
  );
  await botao.click();
  await driver.wait(until.elementLocated(By.css('dialog[open]')), 5000);
  await clicar('dialog[open] button[value="ok"]');
}

// ---------- Liga o servidor e abre o navegador ----------

before(async () => {
  servidor = app.listen(0);
  await new Promise((pronto) => servidor.once('listening', pronto));
  endereco = `http://localhost:${servidor.address().port}`;

  // Windows: abre o Chrome normalmente.
  // Linux/EC2: executa o Chrome sem janela.
    const opcoes = new chrome.Options();

  // Desliga o gerenciador de senhas do Chrome (o aviso de "senha vazada" trava os testes)
  opcoes.setUserPreferences({
    credentials_enable_service: false,
    'profile.password_manager_enabled': false,
    'profile.password_manager_leak_detection': false
  });
  opcoes.addArguments('--disable-features=PasswordLeakDetection');
  opcoes.addArguments('--incognito');

  if (process.platform === 'linux') {
    opcoes.addArguments('--headless=new');
    opcoes.addArguments('--no-sandbox');
    opcoes.addArguments('--disable-dev-shm-usage');
  }

  driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(opcoes)
    .build();

  await driver.manage().window().setRect({ width: 1365, height: 900 });
});

after(async () => {
  if (driver) await driver.quit();
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
});

// ---------- Login e controle de acesso ----------

test('login com senha correta permite acessar o sistema', async () => {
  await login('admin@biblioteca.com');
  await driver.wait(until.urlContains('#/inicio'), 8000);
  await aguardarTexto('.perfil', 'Administrador(a)');
});

test('login com senha incorreta mostra mensagem de erro', async () => {
  await login('admin@biblioteca.com', 'senha-errada');
  await aguardarTexto('#erro', 'incorretos');
});

test('página protegida redireciona para o login sem sessão', async () => {
  await abrirSistema();
  await driver.get(endereco + '/#/livros');
  await driver.wait(until.urlContains('#/login'), 8000);
  assert.ok(await driver.findElement(By.id('form-login')).isDisplayed());
});

test('bibliotecário não visualiza a ação de excluir livros', async () => {
  await login('0002');
  await driver.wait(until.urlContains('#/inicio'), 8000);
  await aguardarTexto('.perfil', 'Bibliotecário(a)');
  await abrirLivros();
  const botoesExcluir = await driver.findElements(By.css('[data-excluir]'));
  assert.equal(botoesExcluir.length, 0);
});

// ---------- Livros ----------

test('pesquisa de livros ignora acentos', async () => {
  await loginAdmin();
  await abrirLivros();
  await preencher('#q-livros', 'atica');
  await clicar('#pesquisar');
  await aguardarTexto('.info', 'Resultados: 2 livros encontrados');
  const linhas = await driver.findElements(By.css('table tbody tr'));
  assert.equal(linhas.length, 2);
  const conteudo = await textoDe('table tbody');
  assert.match(conteudo, /Dom Casmurro/);
  assert.match(conteudo, /Iracema/);
});

test('cadastro de livro válido aparece na lista', async () => {
  await loginAdmin();
  await abrirNovoLivro();
  await preencherLivro({ titulo: 'Livro Selenium Cadastro' });
  await clicar('#form-livro button[type="submit"]');
  await aguardarTexto('#toast', 'Livro salvo');
  await abrirTela('/livros?q=selenium', 'Livros');
  await aguardarTexto('table tbody', 'Livro Selenium Cadastro');
  assert.match(await textoDe('table tbody'), /Livro Selenium Cadastro/);
});

test('cadastro de livro sem título apresenta validação', async () => {
  await loginAdmin();
  await abrirNovoLivro();
  await preencherLivro({});
  await clicar('#form-livro button[type="submit"]');
  await aguardarTexto('#toast', 'Preencha todos os campos');
  assert.ok((await driver.findElement(By.id('titulo')).getAttribute('class')).includes('invalido'));
});

test('edição não permite reduzir o total abaixo dos exemplares emprestados', async () => {
  await loginAdmin();
  // O Cortiço (id 2): 2 exemplares, os 2 emprestados
  await abrirTela('/livros/editar/2', 'Editar livro');
  await preencher('#exemplares', '1');
  await clicar('#form-livro button[type="submit"]');
  await aguardarTexto('#toast', 'total não pode ser menor');
  assert.match(await textoDe('#toast'), /total não pode ser menor/i);
});

test('exclusão de livro com empréstimo em aberto é bloqueada', async () => {
  await loginAdmin();
  await abrirLivros();
  await excluirLivroDaLista('Dom Casmurro');
  await aguardarTexto('#toast', 'empréstimo');
  assert.match(await textoDe('#toast'), /empréstimo/i);
});

test('exclusão de livro sem empréstimo em aberto é permitida', async () => {
  await loginAdmin();
  await abrirLivros();
  await excluirLivroDaLista('Grande Sertão: Veredas');
  await aguardarTexto('#toast', 'Livro excluído');
  await driver.wait(async () => {
    try {
      return !(await textoDe('table tbody')).includes('Grande Sertão: Veredas');
    } catch {
      return false;
    }
  }, 8000);
  assert.doesNotMatch(await textoDe('table tbody'), /Grande Sertão: Veredas/);
});

// ---------- Usuários ----------

test('cadastro de usuário impede CPF ou matrícula repetido', async () => {
  await loginAdmin();
  const dados = {
    nome: 'Usuário Selenium',
    doc: '999888777',
    telefone: '(85) 90000-0000',
    email: 'selenium@exemplo.com'
  };

  await abrirTela('/usuarios/novo', 'Cadastro de usuário');
  for (const [campo, valor] of Object.entries(dados)) await preencher('#' + campo, valor);
  await clicar('#form-usu button[type="submit"]');
  await aguardarTexto('#toast', 'Usuário salvo');
  await aguardarTexto('h1', 'Usuários');

  await abrirTela('/usuarios/novo', 'Cadastro de usuário');
  for (const [campo, valor] of Object.entries(dados)) await preencher('#' + campo, valor);
  await clicar('#form-usu button[type="submit"]');
  await aguardarTexto('#toast', 'já está cadastrado');
  assert.match(await textoDe('#toast'), /já está cadastrado/i);
});

// ---------- Empréstimos e devoluções ----------

test('empréstimo válido é registrado e reduz exemplares disponíveis', async () => {
  await loginAdmin();
  await abrirTela('/emprestimos/novo', 'Novo empréstimo');

  await preencher('#q-usuario', '2023001');
  await clicar('#b-usuario');
  await aguardarTexto('#s-usuario', 'Camilly Lira');

  await preencher('#q-livro', 'Vidas Secas');
  await clicar('#b-livro');
  await clicar('#r-livro button[data-i="0"]');
  await aguardarTexto('#s-livro', 'Vidas Secas');

  await clicar('#confirmar');
  await aguardarTexto('#toast', 'Empréstimo registrado');

  // Vidas Secas tinha 3 de 4 disponíveis
  await abrirTela('/livros?q=vidas', 'Livros');
  await aguardarTexto('table tbody', '2 de 4');
});

test('não permite selecionar livro sem exemplar disponível para empréstimo', async () => {
  await loginAdmin();
  await abrirTela('/emprestimos/novo', 'Novo empréstimo');

  await preencher('#q-livro', 'O Cortiço');
  await clicar('#b-livro');
  const resultado = await esperar('#r-livro button[data-i="0"]');
  assert.match(await resultado.getText(), /O Cortiço/);
  assert.equal(await resultado.isEnabled(), false);
});

test('devolução é registrada e o empréstimo deixa a lista de ativos', async () => {
  await loginAdmin();
  // Empréstimo 2: O Cortiço com João Pereira (já vem selecionado)
  await abrirTela('/devolucao?emp=2', 'Registrar devolução');
  await aguardarTexto('#sel-dev', 'João Pereira');
  await clicar('#confirmar-dev');
  await aguardarTexto('#toast', 'Devolução registrada');

  // Depois de confirmar, o sistema volta para a lista de empréstimos ativos
  await driver.wait(until.urlContains('#/emprestimos'), 8000);
  await aguardarTexto('.info', 'empréstimos encontrados');
  assert.doesNotMatch(await textoDe('table tbody'), /João Pereira/);
});

test('consulta de empréstimos em atraso mostra registros atrasados', async () => {
  await loginAdmin();
  await abrirTela('/emprestimos?s=atraso', 'Empréstimos');
  await aguardarTexto('table tbody', 'Em atraso');
  const linhas = await driver.findElements(By.css('table tbody tr'));
  assert.ok(linhas.length > 0);
  for (const linha of linhas) assert.match(await linha.getText(), /Em atraso/);
});

// ---------- Relatórios ----------

test('relatório de histórico apresenta os empréstimos do usuário', async () => {
  await loginAdmin();
  await abrirTela('/relatorios/historico?usuario=1', 'Relatórios');
  await aguardarTexto('#view', 'Camilly Lira');
  assert.match(await textoDe('#view'), /Camilly Lira/);
});

test('relatório de livros apresenta os totais', async () => {
  await loginAdmin();
  await abrirTela('/relatorios/disponiveis', 'Relatórios');
  await aguardarTexto('#view', 'Total de exemplares');
  assert.match(await textoDe('#view'), /Emprestados/);
});

test('relatório de atrasos apresenta os empréstimos em atraso', async () => {
  await loginAdmin();
  await abrirTela('/relatorios/atraso', 'Relatórios');
  await aguardarTexto('#view', 'Maior atraso');
  assert.match(await textoDe('table tbody'), /Capitães da Areia/);
});
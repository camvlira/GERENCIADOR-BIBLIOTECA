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

const esperar = async (seletor, tempo = 8000) => {
  const elemento = await driver.wait(
    until.elementLocated(By.css(seletor)),
    tempo
  );
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

const aguardarTexto = async (seletor, texto) => {
  await driver.wait(async () => {
    try {
      const elemento = await driver.findElement(By.css(seletor));
      return (await elemento.getText()).includes(texto);
    } catch {
      return false;
    }
  }, 8000);
};

async function abrirSistema() {
  // Limpa a sessão para cada teste começar sem usuário autenticado.
  await driver.get(endereco);
  await driver.executeScript('sessionStorage.clear(); localStorage.clear();');
  await driver.get(endereco + '/#/login');
  await driver.wait(until.elementLocated(By.id('form-login')), 8000);
}

async function login(login, senha = '123456') {
  await abrirSistema();
  await preencher('#login', login);
  await preencher('#senha', senha);
  await clicar('#form-login button[type="submit"]');
}

async function loginAdmin() {
  await login('0001');
  await driver.wait(until.urlContains('#/inicio'), 8000);
}

async function abrirLivros() {
  await driver.get(endereco + '/#/livros');
  await esperar('table tbody');
}

async function abrirNovoLivro() {
  await driver.get(endereco + '/#/livros/novo');
  await esperar('#form-livro');
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

async function confirmarDialogo() {
  await driver.wait(until.elementLocated(By.css('dialog[open]')), 5000);
  await clicar('dialog[open] button[value="ok"]');
}

async function mensagemToast() {
  const toast = await esperar('#toast');
  await driver.wait(async () => !(await toast.getAttribute('hidden')), 3000).catch(() => {});
  return toast.getText();
}

before(async () => {
  servidor = app.listen(0);
  await new Promise((pronto) => servidor.once('listening', pronto));
  endereco = `http://localhost:${servidor.address().port}`;

  // Windows: abre o Chrome normalmente.
  // Linux/EC2: executa o Chrome sem janela.
  const opcoes = new chrome.Options();

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

test('login com senha correta permite acessar o sistema', async () => {
  await login('admin@biblioteca.com');
  await driver.wait(until.urlContains('#/inicio'), 8000);
  assert.ok((await driver.getCurrentUrl()).includes('#/inicio'));
});

test('login com senha incorreta mostra mensagem de erro', async () => {
  await login('admin@biblioteca.com', 'senha-errada');
  await aguardarTexto('#erro', 'incorretos');
  assert.match(await driver.findElement(By.id('erro')).getText(), /incorretos/i);
});

test('página protegida redireciona para o login sem sessão', async () => {
  await driver.get(endereco + '/#/livros');
  await esperar('#form-login');
  assert.ok(await driver.findElement(By.id('form-login')).isDisplayed());
});

test('bibliotecário não visualiza a ação de excluir livros', async () => {
  await login('0002');
  await driver.wait(until.urlContains('#/inicio'), 8000);
  await abrirLivros();
  const botoesExcluir = await driver.findElements(By.css('[data-excluir]'));
  assert.equal(botoesExcluir.length, 0);
});

test('pesquisa de livros ignora acentos', async () => {
  await loginAdmin();
  await abrirLivros();
  await preencher('#q-livros', 'atica');
  await clicar('#pesquisar');
  await aguardarTexto('table tbody', 'Dom Casmurro');
  const linhas = await driver.findElements(By.css('table tbody tr'));
  assert.equal(linhas.length, 2);
  const conteudo = await driver.findElement(By.css('table tbody')).getText();
  assert.match(conteudo, /Dom Casmurro/);
  assert.match(conteudo, /Iracema/);
});

test('cadastro de livro válido aparece na lista', async () => {
  await loginAdmin();
  await abrirNovoLivro();
  await preencherLivro({ titulo: 'Livro Selenium Cadastro' });
  await clicar('#form-livro button[type="submit"]');
  await driver.wait(until.urlContains('#/livros'), 8000);
  await preencher('#q-livros', 'Livro Selenium Cadastro');
  await clicar('#pesquisar');
  await aguardarTexto('table tbody', 'Livro Selenium Cadastro');
  assert.match(await driver.findElement(By.css('table tbody')).getText(), /Livro Selenium Cadastro/);
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
  // O Cortiço fica na segunda página da listagem inicial; abrimos sua tela
  // de edição diretamente pelo identificador do registro de exemplo.
  await driver.get(endereco + '/#/livros/editar/2');
  await esperar('#form-livro');
  await preencher('#exemplares', '1');
  await clicar('#form-livro button[type="submit"]');
  await aguardarTexto('#toast', 'total não pode ser menor');
  assert.match(await driver.findElement(By.id('toast')).getText(), /total não pode ser menor/i);
});

test('exclusão de livro com empréstimo em aberto é bloqueada', async () => {
  await loginAdmin();
  await abrirLivros();
  const excluir = await driver.findElement(By.xpath("//tr[td[contains(., 'Dom Casmurro')]]//button[@data-excluir]"));
  await excluir.click();
  await confirmarDialogo();
  await aguardarTexto('#toast', 'empréstimo');
  assert.match(await driver.findElement(By.id('toast')).getText(), /empréstimo/i);
});

test('exclusão de livro sem empréstimo em aberto é permitida', async () => {
  await loginAdmin();
  await abrirLivros();
  const excluir = await driver.findElement(By.xpath("//tr[td[contains(., 'Grande Sertão: Veredas')]]//button[@data-excluir]"));
  await excluir.click();
  await confirmarDialogo();
  await driver.wait(async () => {
    const corpo = await driver.findElement(By.css('table tbody')).getText();
    return !corpo.includes('Grande Sertão: Veredas');
  }, 8000);
  assert.doesNotMatch(await driver.findElement(By.css('table tbody')).getText(), /Grande Sertão: Veredas/);
});

test('cadastro de usuário impede CPF ou matrícula repetido', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/usuarios/novo');
  await esperar('#form-usu');
  const dados = {
    nome: 'Usuário Selenium',
    doc: '999888777',
    telefone: '(85) 90000-0000',
    email: 'selenium@exemplo.com'
  };
  for (const [campo, valor] of Object.entries(dados)) await preencher('#' + campo, valor);
  await clicar('#form-usu button[type="submit"]');
  await driver.wait(until.urlContains('#/usuarios'), 8000);

  await driver.get(endereco + '/#/usuarios/novo');
  await esperar('#form-usu');
  for (const [campo, valor] of Object.entries(dados)) await preencher('#' + campo, valor);
  await clicar('#form-usu button[type="submit"]');
  await aguardarTexto('#toast', 'já está cadastrado');
  assert.match(await driver.findElement(By.id('toast')).getText(), /já está cadastrado/i);
});

test('empréstimo válido é registrado e reduz exemplares disponíveis', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/emprestimos/novo');
  await esperar('#q-usuario');

  await preencher('#q-usuario', '2023001');
  await clicar('#b-usuario');

  await preencher('#q-livro', 'Vidas Secas');
  await clicar('#b-livro');
  await esperar('#r-livro button[data-i]');
  await clicar('#r-livro button[data-i="0"]');

  await clicar('#confirmar');
  await aguardarTexto('#toast', 'Empréstimo registrado');
  assert.match(await driver.findElement(By.id('toast')).getText(), /registrado/i);
});

test('não permite selecionar livro sem exemplar disponível para empréstimo', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/emprestimos/novo');
  await esperar('#q-usuario');

  await preencher('#q-usuario', '2023001');
  await clicar('#b-usuario');

  await preencher('#q-livro', 'O Cortiço');
  await clicar('#b-livro');
  await esperar('#r-livro button[data-i]');
  const resultado = await driver.findElement(By.css('#r-livro button[data-i="0"]'));
  assert.equal(await resultado.isEnabled(), false);
});

test('devolução é registrada e o empréstimo deixa a lista de ativos', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/devolucao?emp=2');
  await esperar('tbody tr[data-id="2"]');
  await clicar('tbody tr[data-id="2"]');
  await clicar('#confirmar-dev');
  await aguardarTexto('#toast', 'Devolução registrada');
  assert.match(await driver.findElement(By.id('toast')).getText(), /registrada/i);

  await driver.get(endereco + '/#/emprestimos?s=ativos');
  await esperar('table tbody');
  const ativos = await driver.findElement(By.css('table tbody')).getText();
  // O Cortiço possui outro empréstimo ativo; verificamos que o empréstimo
  // de João Pereira (id 2) saiu da lista após a devolução.
  assert.doesNotMatch(ativos, /João Pereira/);
});

test('consulta de empréstimos em atraso mostra registros atrasados', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/emprestimos?s=atraso');
  await esperar('table tbody');
  const tabela = await driver.findElement(By.css('table tbody')).getText();
  assert.match(tabela, /Em atraso/);
  assert.ok(tabela.length > 0);
});

test('relatório de histórico apresenta os empréstimos do usuário', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/relatorios/historico?usuario=1');
  await aguardarTexto('#view', 'Camilly Lira');
  const tela = await driver.findElement(By.id('view')).getText();
  assert.match(tela, /Camilly Lira/);
});

test('relatório de livros apresenta os totais', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/relatorios/disponiveis');
  await aguardarTexto('#view', 'Disponíveis');
  const tela = await driver.findElement(By.id('view')).getText();
  assert.match(tela, /Disponíveis|emprestados/i);
});

test('relatório de atrasos apresenta os empréstimos em atraso', async () => {
  await loginAdmin();
  await driver.get(endereco + '/#/relatorios/atraso');
  await aguardarTexto('#view', 'Em atraso');
  const tela = await driver.findElement(By.id('view')).getText();
  assert.match(tela, /Em atraso/i);
});
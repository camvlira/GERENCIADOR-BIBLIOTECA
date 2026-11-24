# Sistema de Controle de Biblioteca

**Equipe:** Camilly Lira e Rafaela Quevedo

## Sobre o projeto

Sistema web para controlar uma biblioteca: cadastro de livros e usuários, empréstimos, devoluções e relatórios.

- **Frontend:** HTML, CSS e JavaScript puro (pasta `public`).
- **Backend:** Node.js com Express, oferecendo uma API REST com login por token.
- **Banco de dados:** SQLite.
- **Testes:** Selenium WebDriver, que testa as telas no Google Chrome.
- **Nuvem:** o sistema roda em uma instância **EC2 da AWS** (Amazon Linux), acessível pelo navegador no endereço `http://IP_PUBLICO_DA_INSTANCIA:3000`. O código é baixado do GitHub para a instância, e o servidor fica no ar com o **pm2**.
- **Organização:** Trello para dividir as tarefas, e Git + GitHub para o controle de versão.

O passo a passo da publicação na AWS está na seção [Publicação na AWS (EC2)](#publicação-na-aws-ec2).

## Arquivos

```
server.js          servidor: banco de dados, rotas da API e controle de acesso
server.test.js     testes de interface com Selenium
package.json       dependências e comandos
public/
  index.html       página
  style.css        visual
  app.js           telas (JavaScript)
database/
  biblioteca.db    banco SQLite (criado sozinho na primeira vez)
```

## Como rodar

Precisa do Node.js instalado (<https://nodejs.org>).

```bash
npm install
npm start
```

Abra <http://localhost:3000>.

| Login | Senha | Perfil |
|---|---|---|
| `admin@biblioteca.com` ou `0001` | `123456` | admin: pode excluir livros |
| `bibliotecario@biblioteca.com` ou `0002` | `123456` | bibliotecario: não pode excluir |

Para voltar aos dados de exemplo, apague a pasta `database` e rode `npm start` de novo.

## Testes (Selenium)

Os testes usam o **Selenium WebDriver**, que abre o Google Chrome e usa o sistema como uma pessoa faria: digita nos campos, clica nos botões e confere o que aparece na tela.

São 18 testes, que cobrem:

- **Login e acesso:** senha correta e incorreta, página protegida sem login e bibliotecário sem o botão de excluir livros.
- **Livros:** pesquisa sem acento, cadastro válido, cadastro sem título, edição com exemplares emprestados e exclusão (bloqueada com empréstimo em aberto e permitida sem empréstimo).
- **Usuários:** bloqueio de CPF ou matrícula repetido.
- **Empréstimos e devoluções:** empréstimo que diminui os exemplares disponíveis, livro sem exemplar disponível, devolução e consulta de empréstimos em atraso.
- **Relatórios:** histórico do usuário, livros disponíveis e emprestados, e empréstimos em atraso.

Para rodar, precisa do **Google Chrome** instalado. Na pasta do projeto:

```bash
npm install
npm test
```

O `npm install` só precisa ser feito uma vez. Ele instala o Selenium (`selenium-webdriver`), e o Selenium baixa sozinho o driver do Chrome.

- No Windows, a janela do Chrome abre e dá para ver os testes acontecendo.
- No Linux (por exemplo, na instância EC2), o Chrome roda sem janela (modo *headless*).
- O gerenciador de senhas do Chrome fica desligado durante os testes, porque o aviso de "senha vazada" (a senha de teste é `123456`) travava o navegador.
- Os testes usam um banco na memória, então não alteram o `database/biblioteca.db`.

## Onde está cada requisito

| Requisito | Onde |
|---|---|
| Frontend: HTML, CSS, JavaScript | pasta `public` |
| Backend: Node.js, Web Service REST, rotas | `server.js` (uma rota para cada serviço) |
| Autenticação | `server.js`, rota `/api/login` (gera um token) e função `exigirLogin` |
| Autorização | `server.js`, função `exigirAdmin` (só o admin exclui livros) |
| SGBD SQLite | `server.js`, parte "Banco de dados" |
| Testes formais | `server.test.js` (testes de interface com Selenium) |
| Controle de versão | Git + GitHub (abaixo) |
| Organização da equipe | Trello (abaixo) |
| Hospedagem na nuvem | AWS EC2, com o servidor no ar pelo pm2 (abaixo) |

## Organização da equipe (Trello)

A equipe organizou o trabalho no **Trello**, no quadro **Gerenciador de Biblioteca**, com as duas integrantes como membros. Cada tarefa é um cartão. Os cartões passam pelas listas conforme o trabalho anda, e cada um tem uma checklist com os passos da tarefa.

**Link do Trello:** https://trello.com/invite/b/6b04b20cacd25898c4a073cc/ATTI3d794d661c894411da1942a8b0ccfec38E76383C/gerenciador-de-biblioteca

| Lista | Para que serve | Cartões |
|---|---|---|
| **Informações** | Referências do projeto | Repositório |
| **Backlog** | Material de planejamento | Ideação, Protótipo, Lista de Eventos |
| **Em andamento** | Tarefas sendo feitas no momento | — |
| **Em teste/revisão** | Tarefas prontas, sendo conferidas | Revisão cruzada do código |
| **Concluído** | Tarefas terminadas | Modelar e criar o banco SQLite; Criar rotas REST de livros; Implementar login com token (`/api/login`); Implementar autorização (`exigirLogin` e `exigirAdmin`); Criar o frontend (`index.html`, `style.css`, `app.js`); Escrever o README e subir no GitHub |

Os cartões têm etiquetas coloridas por tipo de tarefa. Na revisão cruzada, uma integrante confere o código feito pela outra antes de a tarefa ser dada como concluída.

## Git

```bash
git init
git add .
git commit -m "Primeira versão do sistema"
git branch -M main
git remote add origin https://github.com/USUARIO/biblioteca.git
git push -u origin main
```

Depois, a cada mudança: `git add .`, `git commit -m "o que mudou"` e `git push`.

## Publicação na AWS (EC2)

O sistema roda na nuvem, em uma instância EC2 da AWS com Amazon Linux. A instância tem o Node.js e o Git instalados. O código vem do repositório no GitHub, e o servidor fica no ar na porta 3000. O banco SQLite (`database/biblioteca.db`) fica no próprio disco da instância.

Os testes com Selenium também rodam na instância: lá o Chrome funciona sem janela (modo *headless*).

```
Navegador do usuário  --->  AWS EC2 (porta 3000)  --->  Node.js + Express  --->  SQLite
                                   ^
                                   |  git pull
                                GitHub
```

### 1. Preparar a instância

No console da AWS, no **Security Group** da instância, crie uma regra de entrada (Inbound rule):

| Tipo | Porta | Origem |
|---|---|---|
| TCP personalizado | 3000 | 0.0.0.0/0 |
| SSH | 22 | seu IP |

Sem a regra da porta 3000, o site não abre pelo navegador.

### 2. Conectar e instalar o Node.js

Conecte pela instância (botão **Connect** no console ou por SSH) e rode:

```bash
sudo su
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
. ~/.nvm/nvm.sh
nvm install --lts
yum install libatomic -y
node -v
```

### 3. Instalar o Git e baixar o código

```bash
sudo yum install git -y
git --version
git clone https://github.com/camvlira/GERENCIADOR-BIBLIOTECA.git
cd GERENCIADOR-BIBLIOTECA
ls
```

### 4. Instalar as dependências e iniciar

```bash
npm install
node server.js
```

### 5. Acessar o sistema

No navegador, abra:

```
http://IP_PUBLICO_DA_INSTANCIA:3000
```

Para descobrir o IP atual: console da AWS → **EC2 → Instances** → selecione a instância → campo **Public IPv4 address**.

> O IP público **muda** sempre que a instância é parada e iniciada de novo. Para ter um IP fixo, associe um **Elastic IP** à instância.

### 6. Iniciar o servidor depois de reiniciar a instância

Quando a instância é reiniciada (ou parada e iniciada), o servidor **não sobe sozinho**. Para colocá-lo no ar de novo:

1. Veja o novo IP público no console (campo **Public IPv4 address**).
2. Conecte na instância (**Connect** no console ou SSH).
3. Rode:

```bash
sudo su
. ~/.nvm/nvm.sh
cd GERENCIADOR-BIBLIOTECA
node server.js
```

O `. ~/.nvm/nvm.sh` é necessário porque o Node foi instalado pelo `nvm`. Sem ele, aparece `node: command not found`.

Os dados não se perdem ao reiniciar: o arquivo `database/biblioteca.db` continua no disco da instância.

### 7. Manter o servidor rodando (opcional)

Com `node server.js`, o sistema para quando o terminal fecha. Para deixar rodando em segundo plano:

```bash
npm install -g pm2
pm2 start server.js --name biblioteca
pm2 save
```

Comandos úteis: `pm2 status`, `pm2 logs biblioteca`, `pm2 restart biblioteca`, `pm2 stop biblioteca`.

**Para o servidor subir sozinho quando a instância reiniciar**, rode uma vez (depois do `pm2 start`):

```bash
pm2 startup
```

O comando mostra uma linha começando com `sudo env PATH=...`. Copie e execute essa linha, depois rode:

```bash
pm2 save
```

Se preferir não usar o `startup`, depois de reiniciar basta fazer:

```bash
sudo su
. ~/.nvm/nvm.sh
pm2 resurrect
```

### 8. Atualizar o sistema depois de mudanças

Depois de dar `git push` no computador local, na instância:

```bash
sudo su
. ~/.nvm/nvm.sh
cd GERENCIADOR-BIBLIOTECA
git pull
npm install
pm2 restart biblioteca
```

(Se estiver rodando sem o pm2, pare o servidor com `Ctrl + C` e inicie de novo com `node server.js`.)

### Observações

- O banco `database/biblioteca.db` é criado na própria instância na primeira execução. Se a instância for **excluída** (terminated), os dados se perdem.
- Se a página não abrir, confira: Security Group com a porta 3000 liberada, servidor rodando (`pm2 status` ou terminal com `node server.js` aberto), IP atualizado e endereço com `http://` (não `https://`).

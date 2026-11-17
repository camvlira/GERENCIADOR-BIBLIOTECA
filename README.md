# Sistema de Controle de Biblioteca

**Equipe:** Camilly Lira e Rafaela Quevedo

## Arquivos

```
server.js          servidor: banco de dados, rotas da API e controle de acesso
server.test.js     testes dos serviços
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

## Testes

```bash
npm test
```

## Onde está cada requisito

| Requisito | Onde |
|---|---|
| Frontend: HTML, CSS, JavaScript | pasta `public` |
| Backend: Node.js, Web Service REST, rotas | `server.js` (uma rota para cada serviço) |
| Autenticação | `server.js`, rota `/api/login` (gera um token) e função `exigirLogin` |
| Autorização | `server.js`, função `exigirAdmin` (só o admin exclui livros) |
| SGBD SQLite | `server.js`, parte "Banco de dados" |
| Testes formais | `server.test.js` |
| Controle de versão | Git + GitHub (abaixo) |

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

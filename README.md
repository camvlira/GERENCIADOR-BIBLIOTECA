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

Na pasta do projeto, rode:

```bash
npm install
npm test
```

O `npm install` só precisa ser feito uma vez. Os testes usam um banco na memória, então não alteram o `database/biblioteca.db`.

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

## Publicação na AWS (EC2)

O sistema roda em uma instância EC2 (Amazon Linux).

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

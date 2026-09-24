# Wedding Flix

Site completo de portfólio + entrega de casamentos: filmes (streaming adaptativo HLS, 1080p–4K) e álbuns de fotos, com área pública de portfólio e área privada por cliente.

## Estrutura do site

- **`/` — Portfólio público**: sem login, mostra filmes e álbuns marcados como "Público". É a vitrine pra atrair novos clientes.
- **`/index.html` — Minha área**: exige login. Cada cliente vê **só o que foi entregue pra ele** (filme + álbum de fotos). O admin, quando loga, vê tudo.
- **`/admin.html` — Painel admin**: cadastra filmes e álbuns, escolhe se cada um é público (portfólio) ou privado de um cliente específico, e gerencia contas de clientes.
- **`/album.html?id=X` — Visualização de álbum**: grade de fotos, clique amplia (lightbox), download por foto ou álbum inteiro (.zip), e comentários (só o cliente dono do álbum e o admin podem comentar).
- **`/watch.html?id=X` — Player**: toca o filme em HLS adaptativo; se vertical, abre no formato retrato.

## O que você precisa antes de rodar

1. **Node.js 18+**
2. **ffmpeg** instalado (`ffmpeg -version` deve funcionar) — converte os filmes pra HLS.
3. Conta **Cloudflare** com bucket **R2** e domínio customizado apontando pra ele.

## Passo a passo

```bash
cd DunaStudio
npm install
cp .env.example .env
```

Edite o `.env` com suas credenciais (veja comentários no próprio arquivo: `JWT_SECRET`, conta admin, credenciais R2, domínio público do bucket).

```bash
npm start
```

Acesse `http://localhost:3000`.

### Primeiro uso

1. Entre em `/login.html` com o email/senha de admin do `.env` → cai direto no painel admin.
2. Crie as contas de clientes em "Contas de clientes" (seção do admin).
3. Cadastre um filme ou álbum:
   - Em **"Quem pode ver"**, escolha **Público** (vai pro portfólio, visível sem login) ou o **email de um cliente específico** (só ele — e você — vão ver, na área "Minha área" dele).
4. Para álbuns: depois de criar, a tela já abre o campo de upload de fotos — selecione várias de uma vez. Miniaturas são geradas automaticamente.
5. Envie o email/senha pro cliente. Ele entra em `/login.html` e vê tudo dele em "Minha área".
6. Pra cadastrar um contrato: no painel admin, escolha o cliente, escreva o texto do contrato, e liste os eventos nesse formato (um por bloco, separado por linha em branco):
   ```
   Cerimônia | 14/11/2026
   2 fotógrafos
   Álbum impresso 30x30cm

   Recepção | 14/11/2026
   1 fotógrafo
   Making-of incluso
   ```
   A primeira linha de cada bloco é `Nome do evento | data` (data opcional); as linhas seguintes viram a lista de itens contratados daquele evento.

## Sobre a privacidade do conteúdo privado

Importante entender como funciona: os arquivos no R2 ficam em pastas com nomes aleatórios e imprevisíveis (UUID), e o app só revela essas URLs pra quem tem permissão (login do cliente dono, ou admin). Isso é o mesmo modelo usado por ferramentas populares de entrega de fotógrafos (Pixieset, Pic-Time etc.) — na prática é bastante seguro pro dia a dia, mas **não é criptografia de acesso**: se alguém de alguma forma descobrir a URL direta de um arquivo privado (ex: inspecionando o tráfego de rede do próprio cliente autorizado), conseguiria acessá-lo sem logar. Pra a grande maioria dos estúdios isso é suficiente; se no futuro você quiser um nível de segurança mais alto (URLs assinadas com expiração), é possível evoluir o projeto pra isso — é só pedir.

## Sobre o tempo de processamento

A conversão HLS roda no seu servidor via ffmpeg — depende da CPU disponível. As fotos são redimensionadas (thumbnail) automaticamente no upload, isso é bem mais rápido que vídeo.

## Estrutura do projeto

```
DunaStudio/
├── server.js
├── db.js                  # usuários, vídeos, álbuns, fotos, comentários
├── middleware/auth.js      # sessão (obrigatória, opcional, admin)
├── routes/
│   ├── auth.js              # login, clientes
│   ├── videos.js            # filmes: upload, HLS, público/privado
│   └── albums.js            # álbuns: fotos, download, zip, comentários
├── utils/
│   ├── hls.js                # conversão HLS (detecta vertical/horizontal, 1080p–4K)
│   ├── thumbnail.js           # miniaturas de fotos (sharp)
│   ├── r2.js                   # upload/download/exclusão no Cloudflare R2
│   └── mime.js
└── public/
    ├── portfolio.html          # home pública
    ├── index.html               # Minha área (privado)
    ├── album.html                # visualização de álbum
    ├── watch.html                 # player de filme
    ├── admin.html                  # painel admin
    └── login.html
```

- **`/contract.html?id=X` — Contrato**: mostra os eventos contratados (com o que está incluso em cada um), o texto do contrato, e um campo de assinatura por desenho (mouse ou dedo). Depois de assinado, o cliente pode baixar o PDF com a assinatura.

- **`/pacotes.html` — Contratação de serviço**: pública, lista os pacotes com preço, permite personalizar itens (recalcula o valor em tempo real) e leva ao checkout do Mercado Pago. Depois do pagamento, cai em `/checkout-sucesso.html`.

## Configurando pagamentos (Mercado Pago) e notificação por e-mail

1. **Mercado Pago**: crie uma conta em mercadopago.com.br, vá em "Seu negócio" → "Configurações" → "Credenciais" → pegue o **Access Token de produção** e cole em `MP_ACCESS_TOKEN` no `.env`.
2. **`SITE_URL`**: precisa ser a URL pública real do seu site (não `localhost`) pra funcionar em produção — é pra onde o Mercado Pago redireciona o cliente depois de pagar, e pra onde ele avisa sobre o status do pagamento (webhook).
3. **E-mail de notificação (opcional, mas recomendado)**: em myaccount.google.com/apppasswords, gere uma "senha de app" do Gmail (exige verificação em duas etapas ativada na conta). Cole o e-mail em `GMAIL_USER` e a senha gerada em `GMAIL_APP_PASSWORD`. Toda vez que um pagamento for aprovado, você recebe um e-mail em `NOTIFY_EMAIL` com os detalhes da venda.
4. **Cadastrando pacotes**: no admin, cada item do pacote leva `Nome | valor | incluso ou opcional`. Itens "incluso" compõem o preço padrão mostrado no card; itens "opcional" o cliente pode adicionar clicando em "Personalizar", com o total recalculado na hora.

**Nota sobre assinatura mensal**: por enquanto o checkout é só pagamento único (cartão, Pix ou boleto, tudo já coberto pelo Checkout Pro do Mercado Pago). Cobrança recorrente mensal é uma API separada da Mercado Pago (Assinaturas/Preapproval) — dá pra evoluir o projeto pra isso quando quiser.

## Novidades: compartilhamento, convidados, loja física e depoimentos

- **Compartilhar álbum ou seção**: no álbum, o ícone ⚙ no cabeçalho abre o painel pra gerar um link público (com ou sem permissão de download) — dá pra compartilhar o álbum inteiro ou, com o ícone 🔗 em cada seção, só aquela parte (ex: só a "Recepção"). Quem recebe o link não precisa de login. Página: `/compartilhado.html?t=TOKEN`.
- **Fotos dos convidados**: no mesmo painel ⚙, ative "Convidados podem enviar fotos" — gera um link (`/convidados.html?t=TOKEN`) pra colocar num QR code na festa. As fotos que chegam caem automaticamente numa seção "Fotos dos convidados" dentro do álbum do casal.
- **Loja de produtos físicos**: cadastre produtos no admin (porta-retrato, fotolivro, caixa de pendrive etc.). Na ampliação de qualquer foto do álbum, o cliente vê "🖼️ Pedir produto físico" e finaliza a compra pelo Mercado Pago (mesma infraestrutura dos pacotes).
- **Depoimentos**: o cliente envia pela página `/depoimento.html` (link no menu da Minha área). Você aprova no admin, e ele aparece automaticamente na home pública, em "O que os casais dizem".

**Deixado pra uma próxima etapa** (pedem mais infraestrutura): cápsula do tempo por e-mail no aniversário de casamento (precisa de um agendador rodando), e comentários ancorados num timestamp específico do vídeo.

## Upload automático do Lightroom

Tem uma ferramenta separada em `lightroom-uploader/` que vigia uma pasta de exportação do Lightroom e sobe as fotos direto pro álbum escolhido, sem passar pelo painel admin manualmente. Veja `lightroom-uploader/README.md`.

## Segurança antes de colocar em produção

- Troque `JWT_SECRET` e a senha do admin.
- Rode atrás de HTTPS (Nginx + Let's Encrypt, ou Caddy).
- Faça backup do `data/wedding-flix.db` regularmente.

## Publicando em um caminho do domínio (ex: dunabranding.com.br/studio)

O site pode ficar dentro de um caminho em vez da raiz do domínio. Para isso, no `.env`:

```
BASE_PATH=/studio
SITE_URL=https://dunabranding.com.br/studio
```

Todas as páginas, a API (`/studio/api/...`) e o cookie de login passam a usar esse caminho. Acessar `/studio` redireciona para `/studio/`. Deixe `BASE_PATH` vazio para servir na raiz. No `lightroom-uploader`, use `SERVER_URL=https://dunabranding.com.br/studio`.

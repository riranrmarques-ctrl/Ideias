# DunaStudio no Cloudflare + Supabase

Esta é a versão do DunaStudio que roda só com Cloudflare e Supabase, no mesmo padrão do painel de TVs:

- **Páginas e API**: um único Worker, `dunastudio`, em `dunabranding.com.br/studio`. As páginas ficam embutidas no próprio arquivo do Worker (`dist/dunastudio-worker.js`).
- **Login e banco**: Supabase (tabelas `studio_*`)
- **Filmes e fotos**: bucket R2 `dunastudio` (privado; o Worker entrega com links assinados que valem 12 horas)

A pasta `DunaStudio/` (fora de `cloudflare/`) guarda a versão antiga com servidor Node, que não é mais necessária.

## O que mudou em relação à versão com servidor

- Filmes: envie em **MP4 (H.264)**, já exportado. O envio vai direto do navegador para o R2, em partes de 50 MB, e o filme toca por streaming progressivo (sem conversão HLS). Mantenha a página aberta até aparecer "Filme publicado".
- Duração, orientação (vertical/horizontal) e qualidade (4K, 1080p...) são lidas do arquivo no navegador. Sem capa, o site usa um quadro do filme.
- Miniaturas das fotos, o `.zip` do álbum e o PDF do contrato são gerados no navegador.
- Login pelo Supabase, com "Esqueci minha senha".
- E-mail de venda aprovada: pelo Resend (opcional).

## Instalação (uma vez)

### 1. Supabase
1. Abra o projeto no Supabase → **SQL Editor** → **New query**.
2. Cole todo o conteúdo de `supabase.sql` e toque em **Run**.
3. Em **Authentication → URL Configuration**, adicione `https://dunabranding.com.br/studio/login.html` em **Redirect URLs** (para o "Esqueci minha senha").
4. Em **Project Settings → API**, anote: **Project URL**, **anon public key** e **service_role key** (secreta).

### 2. Cloudflare: criar o Worker
1. **Workers & Pages → Create → Worker**, com o nome `dunastudio` → **Deploy**.
2. **Edit code**. O código vai em 3 arquivos, que ficam em `dist/partes/`:
   - `worker.js`: apague o código de exemplo do arquivo principal e cole este.
   - `paginas.js`: crie um arquivo novo com esse nome exato (ícone de novo arquivo no editor) e cole.
   - `scripts.js`: mesma coisa.
   Depois toque em **Deploy**. Se preferir colar um arquivo só, use `dist/dunastudio-worker.js`.
3. **Settings → Bindings → Add → R2 bucket**: nome da variável `MEDIA`, bucket `dunastudio`.
4. **Settings → Domains & Routes → Add → Route**: `dunabranding.com.br/studio*`, zona `dunabranding.com.br`.

### 3. Atualizações
Quando o código mudar, gere os arquivos de novo com `node build.js` e cole as partes novas em **Edit code**. As variáveis e ligações continuam.

### 4. Cloudflare: variáveis do Worker
Em **Workers & Pages → dunastudio → Settings → Variables and Secrets**:

| Nome | Tipo | Valor |
|---|---|---|
| `SUPABASE_URL` | Text | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | Text | anon public key |
| `ADMIN_EMAILS` | Text | seu e-mail de admin (vários separados por vírgula) |
| `SITE_URL` | Text | `https://dunabranding.com.br/studio` |
| `SUPABASE_SERVICE_KEY` | **Secret** | service_role key |
| `MEDIA_SIGNING_SECRET` | **Secret** | um texto longo e aleatório (40+ caracteres) |
| `MP_ACCESS_TOKEN` | Secret (opcional) | Access Token de produção do Mercado Pago |
| `RESEND_API_KEY`, `NOTIFY_EMAIL`, `MAIL_FROM` | opcionais | e-mail de venda aprovada pelo Resend |

### 5. Primeiro acesso
Entre em `https://dunabranding.com.br/studio/login.html` com o e-mail que está em `ADMIN_EMAILS` (a conta precisa existir no Supabase: **Authentication → Users → Add user**). Crie os clientes no painel admin. Se o e-mail já tiver conta no Supabase, o painel só libera o acesso ao Studio, e o cliente continua com a senha que já tinha.

## Rotas

A rota `dunabranding.com.br/studio*` faz esse Worker responder só pelo `/studio`. As outras rotas do domínio (painel, tvs, news...) continuam com o Worker que já existe.

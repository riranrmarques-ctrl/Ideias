# Ideias

## Wedding Flix (Duna)

Portal de portfólio e entrega de casamentos: filmes em streaming (HLS), álbuns de fotos, contratos com assinatura, pacotes e loja com Mercado Pago.

- `DunaStudio/`: o projeto real (Node.js + Express + SQLite + Cloudflare R2). Veja `DunaStudio/README.md` para rodar.
- `docs/index.html`: demonstração que roda só no navegador, com dados de exemplo. É esse arquivo que o GitHub Pages publica.
- `demo/`: fonte da demonstração. `demo/pages/` tem as páginas do site adaptadas e `demo/pages/js/mock-api.js` simula o backend. Para gerar o `docs/index.html` de novo: `node demo/build.js`.

### Contas da demonstração

Senha `demo123` para todas:

- `admin@duna.demo`: painel admin
- `ana.pedro@email.com`: cliente com filme, álbum e contrato assinado
- `julia.rafael@email.com`: cliente com contrato pendente de assinatura

Na demonstração, tudo o que você cria fica salvo só no seu navegador. Os filmes não tocam, e downloads e pagamentos são simulados.

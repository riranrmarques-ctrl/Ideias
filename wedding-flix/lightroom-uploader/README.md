# Lightroom → Wedding Flix (upload automático)

Vigia uma pasta no seu computador e sobe as fotos exportadas do Lightroom direto pro álbum escolhido — sem precisar abrir o painel admin.

## Como usar

1. **Configure**:
   ```bash
   cd lightroom-uploader
   cp .env.example .env
   ```
   Edite o `.env`: `SERVER_URL` (endereço do seu Wedding Flix) e as credenciais de admin.

2. **No Lightroom**, configure o "Exportar para" apontando pra uma pasta fixa (ex: `Área de Trabalho/Exportar-WeddingFlix`) — pode deixar salvo como um preset de exportação, assim não precisa escolher a pasta toda vez.

3. **Rode o script** antes de exportar:
   ```bash
   cd lightroom-uploader
   node index.js
   ```
   - Ele pede login (usa as credenciais do `.env`, automático).
   - Mostra a lista de álbuns cadastrados — digite o número do álbum daquele casamento.
   - Pergunta a pasta pra vigiar (Enter usa a padrão sugerida).

4. **No Lightroom, exporte normalmente** pra essa mesma pasta. Assim que cada foto termina de ser escrita no disco, o script já sobe ela sozinha — você vê no terminal:
   ```
   ✔ Enviado: DSC_0142.jpg
   ✔ Enviado: DSC_0143.jpg
   ```
5. Quando terminar, `Ctrl+C` pra parar. Fotos já enviadas vão pra uma subpasta `_enviado/`, então rodar de novo não duplica nada.

## Observações

- O script só reconhece `.jpg .jpeg .png .tif .tiff .webp`. RAW não é enviado (o Lightroom já deve estar exportando os arquivos finais/editados nesses formatos).
- Ele espera o arquivo "parar de crescer" antes de enviar, então não tem risco de subir uma foto pela metade durante uma exportação grande.
- Pra cada casamento novo, é só rodar `node index.js` de novo e escolher o álbum correspondente (crie o álbum no painel admin antes, mesmo vazio).

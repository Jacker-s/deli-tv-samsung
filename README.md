# Deli TV - Samsung Smart TV (Tizen OS)

Aplicativo oficial **Deli TV** desenvolvido para Smart TVs Samsung com sistema operacional **Tizen OS**.

## 📺 Informações do Pacote

- **Nome da Aplicação:** Deli TV
- **Package ID:** `comdelitv1`
- **Application ID:** `comdelitv1.DeliTV`
- **Versão:** 2.4.2
- **Tizen Profile:** `tv-samsung` (Tizen 5.0+)
- **Orientação:** Landscape

## 🚀 Instalação na Samsung Smart TV

### Pré-requisitos
1. **Samsung Smart TV** conectada à mesma rede local (Wi-Fi ou cabo) do computador.
2. Ativar o **Developer Mode** na TV:
   - Abra o menu de **Apps** na TV.
   - Pressione no controle: `1`, `2`, `3`, `4`, `5`.
   - Ative a opção **Developer Mode** e digite o IP local do seu computador.
   - Reinicie a TV (segurando o botão Power por 3 segundos).
3. **Tizen Studio** e **Tizen CLI** instalados no computador.

### Comandos de Instalação via Terminal
Conecte à TV pelo IP dela:
```bash
sdb connect <IP_DA_TV>
```

Instale o pacote assinado diretamente:
```bash
tizen install -n DeliTV-Samsung-TV-2.4.2-signed.wgt -t <TARGET_DEVICE_NAME>
```

## 🛠️ Estrutura do Projeto

- `index.html` - Interface principal do aplicativo
- `app.js` - Lógica de navegação, reprodução de mídia e controle remoto Tizen
- `style.css` - Estilos e layout otimizado para TV
- `config.xml` - Manifesto de configuração Tizen WGT
- `hls.min.js` & `shaka-player.compiled.js` - Players de streaming adaptativo (HLS e DASH)
- `icon.png` - Ícone do aplicativo
- `DeliTV-Samsung-TV-2.4.2-signed.wgt` - Pacote Tizen compilado e assinado pronto para distribuição/instalação

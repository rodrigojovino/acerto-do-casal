# Release do APK

O workflow `.github/workflows/release.yml` roda quando uma tag `vX.Y.Z` é enviada ao GitHub. Ele testa o domínio, gera o build web, compila o APK release assinado e anexa ao Release da tag.

## 1. Gerar a keystore (uma vez só)

> **A keystore é a identidade do app.** Se ela for perdida, o Android não aceita atualizações do app já instalado: será preciso desinstalar (perdendo os dados locais) e reinstalar. Guarde o arquivo `.jks` e a senha **fora do repositório e fora deste PC** (gerenciador de senhas, pendrive guardado, nuvem pessoal criptografada).

No PowerShell, numa pasta **fora** do repositório:

```powershell
New-Item -ItemType Directory -Force "$HOME\chaves" | Out-Null
keytool -genkeypair -v `
  -keystore "$HOME\chaves\acerto.jks" `
  -alias acerto `
  -keyalg RSA -keysize 2048 `
  -validity 10000
```

O `keytool` pergunta:

- **Senha da keystore**: use uma senha forte. Ela vai para o Secret `ANDROID_KEYSTORE_PASSWORD`.
- **Nome, unidade, organização, cidade, estado, país**: podem ser genéricos (ex.: país `BR`). Ficam visíveis no certificado do APK, então não coloque nada que não queira público.
- O formato padrão é PKCS12. Nele, a senha da chave é a mesma da keystore. Use o mesmo valor em `ANDROID_KEYSTORE_PASSWORD` e em `ANDROID_KEY_PASSWORD`.

O `.gitignore` já bloqueia `*.jks`, `*.keystore` e `*.b64`, mas o certo é nunca gerar esses arquivos dentro do repositório.

## 2. Impressão digital SHA-256 do certificado

Necessária para registrar o app na conta de distribuição limitada do Google (verificação de desenvolvedor do Android). Também será usada mais tarde no Firebase, para o login Google no Android.

```powershell
keytool -list -v -keystore "$HOME\chaves\acerto.jks" -alias acerto
```

Na saída, copie a linha **`SHA256:`**, no formato `AB:CD:12:...`, com 32 pares de hexadecimais. A linha `SHA1:` também pode ser útil para o Firebase.

A mesma impressão digital pode ser conferida:

- no log do workflow, no passo "Verificar assinatura e renomear" (linha `certificate SHA-256 digest`, sem os dois-pontos);
- num APK já gerado: `keytool -printcert -jarfile acerto-do-casal-X.Y.Z.apk`.

## 3. Converter a keystore para base64

O GitHub Secrets só guarda texto. Este comando copia a keystore em base64 direto para a área de transferência, sem gravar arquivo:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\chaves\acerto.jks")) | Set-Clipboard
```

## 4. Cadastrar no GitHub

Em **Settings > Secrets and variables > Actions**:

### Secrets (aba "Secrets")

| Nome | Valor |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | conteúdo copiado no passo 3 |
| `ANDROID_KEYSTORE_PASSWORD` | senha da keystore |
| `ANDROID_KEY_ALIAS` | `acerto` |
| `ANDROID_KEY_PASSWORD` | senha da chave (igual à da keystore no formato PKCS12) |

### Variables (aba "Variables")

A config web do Firebase é pública, então vai em Variables, não em Secrets. Os mesmos nomes do `.env.example`:

| Nome |
| --- |
| `VITE_FIREBASE_API_KEY` |
| `VITE_FIREBASE_AUTH_DOMAIN` |
| `VITE_FIREBASE_PROJECT_ID` |
| `VITE_FIREBASE_STORAGE_BUCKET` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `VITE_FIREBASE_APP_ID` |

O workflow falha logo no início, indicando o nome que falta, se algum Secret ou Variable não estiver cadastrado.

## 5. Publicar uma versão

```powershell
git tag v0.1.0
git push origin v0.1.0
```

- A tag precisa ser `vX.Y.Z`, com minor e patch até 99.
- O `versionCode` do Android é calculado a partir dela (`v1.2.3` → `10203`). Por isso ele sempre cresce junto com a versão, e o Android aceita a atualização.
- Rodar de novo o workflow da mesma tag substitui o APK no Release.

O APK fica em **Releases** no GitHub, como `acerto-do-casal-X.Y.Z.apk`. No celular, baixe e instale. Na primeira vez o Android pede permissão para instalar apps do navegador.

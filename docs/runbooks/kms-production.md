# KMS Production — runbook

Em `NODE_ENV=production`:

- `GOVAI_KMS_PROVIDER=dev` → boot fail.
- `KMS_DEV_SEED` setado → boot fail.

Para production, configurar o provider AWS real (implementado em
`packages/core-identity/src/kms/aws-kms.ts`):

- `GOVAI_KMS_PROVIDER=aws`
- `GOVAI_KMS_AWS_REGION` (ex.: `us-east-1`)
- `GOVAI_KMS_AWS_KEY_ID` (ex.: `alias/govai-foundation`)
- `GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE` (caminho **fora do repo**)
- `GOVAI_KMS_SEED_CACHE_TTL_SECONDS` (opcional, default 900)
- Credenciais AWS via instance role / workload identity (SSO em dev).
- Não usar env vars com material de chave em claro. O master seed vive **apenas**
  como ciphertext (KMS-encrypted) em arquivo fora do repositório.

Providers `gcp`/`azure` permanecem `planned` (`ProductionKmsRequired` falha no uso).

## Modelo criptográfico (Option B)

AWS KMS só faz `Decrypt` do master seed (uma vez por janela de cache + TTL). HKDF
e HMAC-SHA256 são **locais**. Não há `GenerateMac`/`VerifyMac`; a role de runtime
precisa apenas de `kms:Decrypt` na key. Encryption context fixo do Decrypt:
`{ app: "govai", purpose: "master-seed", version: "1" }` (todos strings; `version`
é a string `"1"`, nunca número).

## Como montar o ciphertext file

1. Provisione a key/alias e gere o master seed via o gate de provisioning
   (fora deste repo). O resultado é um arquivo ciphertext-only, modo `600`, em um
   diretório `700` fora do repositório (ex.:
   `~/.govai/secrets/govai-kms-master-seed.ciphertext`).
2. Em produção, monte esse arquivo no host/container fora da árvore do repo e
   aponte `GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE` para ele.
3. Nunca copie o ciphertext para dentro do repo. O `.gitignore` bloqueia
   `*.ciphertext`, `*.seed`, `*master-seed*`, `*.key`, `*.pem`, `*.bin` como defesa.

## Validar decrypt sem imprimir o segredo

Confirme apenas a **contagem de bytes** (deve ser 32), nunca o conteúdo:

```
aws kms decrypt \
  --profile <profile> --region us-east-1 \
  --key-id alias/govai-foundation \
  --ciphertext-blob "fileb://$GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE" \
  --encryption-context app=govai,purpose=master-seed,version=1 \
  --output text --query Plaintext | base64 --decode | wc -c
```

Não redirecione o plaintext para arquivo nem para o terminal.

## Validação manual pós-merge (NÃO rodar em CI)

Este PR apenas prepara o código; ele não prova, sozinho, que o KMS real está
operacional. Após o merge, em um host com a role/credenciais corretas:

1. Configure as env vars de produção (acima) e monte o ciphertext file fora do repo.
2. Suba o app com `NODE_ENV=production GOVAI_KMS_PROVIDER=aws`.
3. O boot probe (`apps/api/src/server.ts`) chama `deriveKey`, exercitando o
   `Decrypt` do master seed e falhando cedo se o KMS não estiver acessível.
4. Confirme que o `AwsKms` desembrulha o master seed (boot sem erro).
5. Não imprima plaintext nem derived key. Use a contagem de bytes acima se precisar
   validar o decrypt manualmente.
6. Nunca rode esta validação contra AWS real em CI.

## Rotação

- **KMS key rotation:** habilitada na CMK (anual), transparente para decrypt.
- **Master-seed rotation:** gerar novo seed, KMS-encrypt, substituir o ciphertext
  file e bumpar a versão de key para que as derived keys mudem deterministicamente.
- **Compromise:** revogar acesso à key, rotacionar seed, re-encriptar dados
  dependentes; registrar no audit chain.

## Recuperação se o ciphertext file sumir

Sem o ciphertext file (ou sem acesso ao KMS), o boot **falha fechado** — isso é
intencional. Recoloque o arquivo a partir do secret store fora do repo e reinicie.
O master seed em claro nunca é persistido; só existe o ciphertext + o KMS.

## Inspeção segura do alias/key

```
aws kms describe-key --profile <profile> --region us-east-1 --key-id alias/govai-foundation
aws kms get-key-rotation-status --profile <profile> --region us-east-1 --key-id alias/govai-foundation
```

Não inclua plaintext, URLs OIDC temporárias, access keys ou conteúdo do ciphertext
em nenhum log ou ticket.

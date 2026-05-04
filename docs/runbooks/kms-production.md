# KMS Production — runbook

Em `NODE_ENV=production`:

- `GOVAI_KMS_PROVIDER=dev` → boot fail.
- `KMS_DEV_SEED` setado → boot fail.

Para production, configurar provider real:
- `GOVAI_KMS_PROVIDER=aws` (ou `gcp`, `azure`)
- Credenciais via instance role / workload identity.
- Não usar env vars com chaves materiais.

Implementação dos providers `aws/gcp/azure` está como `planned` —
ver `packages/core-identity/src/kms/index.ts:ProductionKmsRequired` que falha boot até
provider concreto ser implementado.

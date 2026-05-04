Verdict: **NEEDS_FIXES**

**Findings**

- **HIGH** — Capability overrides are not fully enforced or surfaced. `resolveEffectiveLevel()` returns an effective `status`, but `resolveCapability()` drops it and `/v1/capabilities` returns the baseline facet status instead. `POST /v1/runs` also guards only `resolved.capability.status`, so a tenant `status_override='blocked'` would not block execution in the hermetic path, and would be dangerous once capabilities become `supported`.  
  Refs: [capability-resolution.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/capability-resolution.ts:96>), [capabilities.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/capabilities.ts:51>), [run-orchestrator.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/run-orchestrator.ts:67>)

- **HIGH** — Provider network failures are not mapped to `run.failed` + audit + `502`. `fetch()` failures thrown before an HTTP response bypass the `ProviderInvokeError` branch, roll back the transaction, and become route-level `500 internal_error`; no `run.failed` audit event is appended. The test currently accepts this thrown path, so it does not enforce the required behavior.  
  Refs: [provider-invoke.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/provider-invoke.ts:123>), [run-orchestrator.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/run-orchestrator.ts:163>), [runs.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/runs.ts:82>), [governed-run-e2e.test.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/tests/integration/governed-run-e2e.test.ts:169>)

- **MEDIUM** — Unknown capabilities return `400 invalid_request`, not the required `404 capability_not_registered`. The route schema uses `z.enum(...)`, so unknown capability IDs never reach `resolveCapability()` or the `CapabilityNotRegisteredError` mapping.  
  Refs: [runs.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/runs.ts:13>), [runs.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/runs.ts:31>), [runs.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/runs.ts:78>)

- **MEDIUM** — The 18 new tests miss several critical assertions. `CAP.2` says blocked status surfaces but only checks level/override flag; `E2E.5` does not exercise `/v1/runs` returning `502` with `run.failed`; audit pagination by `before_seq` is implemented but untested.  
  Refs: [capabilities-by-org.test.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/tests/integration/capabilities-by-org.test.ts:42>), [governed-run-e2e.test.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/tests/integration/governed-run-e2e.test.ts:129>), [audit-events.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/audit-events.ts:46>)

**Notes**

`GET /v1/audit-events` is correctly metadata-only from the route read path, and the 501 helper uses the structured schema without `pipeline_incomplete_in_baseline`. RLS context is set inside transactions for the three runtime reads/writes I checked. I did not run tests, per request; no obvious static regression appeared in the existing audit-chain kernel.
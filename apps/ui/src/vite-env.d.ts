/// <reference types="vite/client" />

// Build-time PUBLIC configuration. Every value here is inlined into the client bundle, so no
// secret may ever be added to this interface (see .env.example).
interface ImportMetaEnv {
  readonly VITE_GOVAI_API_BASE_URL?: string;
  readonly VITE_GOVAI_BUILD_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

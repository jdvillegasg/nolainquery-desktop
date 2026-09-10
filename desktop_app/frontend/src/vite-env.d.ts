/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_API_URL: string
  readonly VITE_PORTAL_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

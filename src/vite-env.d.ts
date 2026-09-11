/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_POSTS_REPOSITORY?: "mock" | "http";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __ATELIER_TEST__: boolean | undefined;

interface ImportMetaEnv {
  readonly WXT_SUPABASE_URL?: string;
  readonly WXT_SUPABASE_ANON_KEY?: string;
  /** Production Workers API origin, e.g. https://atelier-api.<account>.workers.dev */
  readonly WXT_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export interface Env {
  /** Arquivos do site (dist/ gerado pelo Vite). */
  ASSETS?: { fetch(request: Request): Promise<Response> }
  // Secrets (wrangler secret put … ou painel do Cloudflare). Nunca vão para o navegador.
  ERP_TOKEN?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  /** Opcional: token fixo para automações sem usuário. O acesso normal é login do Supabase Auth com perfil admin. */
  ADMIN_TOKEN?: string
  // Variáveis (vars do wrangler.jsonc).
  ERP_API_URL?: string
  /** Esquema do cabeçalho Authorization. Padrão: "Authentication" (Authorization: Authentication TOKEN). */
  ERP_AUTH_SCHEME?: string
  /** "true" para enviar também X-ERP-Token. */
  ERP_SEND_X_TOKEN?: string
  /** Registros por página (offset/limit). O ERP devolve no máximo 100. */
  ERP_PAGE_SIZE?: string
  /** Onde enviar offset/limit: "query" (padrão) ou "body". */
  ERP_PAGINATION?: string
  /** Fuso das datas sem fuso devolvidas pelo ERP. Padrão "-03:00" (Belém). */
  ERP_UTC_OFFSET?: string
  /** Fuso da loja para "hoje" e janelas de releitura. Padrão "America/Belem". */
  STORE_TIME_ZONE?: string
  /** Subrequests por execução (Free: 50 por invocação; pago: 1000). Padrão 45. */
  SYNC_MAX_SUBREQUESTS?: string
}

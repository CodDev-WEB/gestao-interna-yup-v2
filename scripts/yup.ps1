<#
  Operação do Worker gestao-interna-yup.

  .\scripts\yup.ps1 segredos   Grava os Secrets no Worker (pede o token do ERP e a chave service_role do Supabase)
  .\scripts\yup.ps1 login      Entra com e-mail e senha do Supabase Auth (perfil admin); a sessão fica salva
  .\scripts\yup.ps1 validar    Testa ERP, Supabase e confere todas as colunas no ERP real
  .\scripts\yup.ps1 contar     Quantos registros cada tabela tem no ERP
  .\scripts\yup.ps1 carga      Executa uma rodada de sincronização (repita até "Nada a sincronizar")
  .\scripts\yup.ps1 carga-completa  Repete as rodadas até terminar (log em carga.log); a 1ª carga leva horas
  .\scripts\yup.ps1 status     Estado de cada job
  .\scripts\yup.ps1 ligar      Liga a sincronização automática (cron a cada 5 min)
  .\scripts\yup.ps1 desligar   Desliga a sincronização automática

  A sessão (tokens do Supabase Auth, nunca a senha) fica em %USERPROFILE%\.yup-sessao.json, fora do repositório.
  Cada resultado também é gravado em resultado-<acao>.json na pasta do projeto (fora do git).
#>
param([Parameter(Mandatory = $true)][ValidateSet('segredos', 'login', 'validar', 'contar', 'carga', 'carga-completa', 'status', 'ligar', 'desligar')][string]$Acao)

$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$Projeto = Split-Path -Parent $PSScriptRoot
Set-Location $Projeto
$Url = 'https://gestao-interna-yup.jordano-19-silva.workers.dev'
$SupabaseUrl = 'https://udrsdiuzztelysxiozpl.supabase.co'
$SessionFile = Join-Path $env:USERPROFILE '.yup-sessao.json'

function Plain([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

function PutSecret([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "Valor vazio para $Name." }
  Write-Host "Gravando $Name..." -NoNewline
  $ErrorActionPreference = 'Continue'
  # Sem quebra de linha no fim: grava o valor exato via arquivo temporário (apagado em seguida).
  $tmp = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($tmp, $Value.Trim())
  $saida = cmd /c "npx --no-install wrangler secret put $Name < `"$tmp`"" 2>&1
  Remove-Item $tmp -Force
  $code = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($code -ne 0) { Write-Host ''; $saida | Select-Object -Last 5 | ForEach-Object { Write-Host "  $_" }; throw "wrangler secret put $Name falhou." }
  Write-Host ' ok'
}

function Call([string]$Method, [string]$Path, $Body, [int]$Timeout, [string]$Token) {
  $req = @{ Method = $Method; Uri = "$Url$Path"; TimeoutSec = $Timeout; UseBasicParsing = $true; ContentType = 'application/json; charset=utf-8' }
  if ($Token) { $req.Headers = @{ Authorization = "Bearer $Token" } }
  if ($null -ne $Body) { $req.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress)) }
  try { $r = Invoke-WebRequest @req; return @{ status = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json) } }
  catch {
    $resp = $_.Exception.Response
    if (-not $resp) { return @{ status = 0; body = @{ error = $_.Exception.Message } } }
    $text = $_.ErrorDetails.Message
    if (-not $text) { try { $text = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch { $text = '' } }
    try { $parsed = $text | ConvertFrom-Json } catch { $parsed = @{ error = $text } }
    return @{ status = [int]$resp.StatusCode; body = $parsed }
  }
}

function SaveSession($s) {
  @{ access_token = $s.access_token; refresh_token = $s.refresh_token; email = $s.user.email } | ConvertTo-Json | Out-File -Encoding utf8 $SessionFile
}

# Chamada autenticada; renova a sessão uma vez se ela tiver expirado.
function Api([string]$Method, [string]$Path, $Body = $null, [int]$Timeout = 120) {
  if (-not (Test-Path $SessionFile)) { throw "Sem sessão. Rode primeiro: .\scripts\yup.ps1 login" }
  $s = Get-Content $SessionFile -Raw | ConvertFrom-Json
  $r = Call $Method $Path $Body $Timeout $s.access_token
  if ($r.status -eq 401) {
    $n = Call POST '/api/auth/refresh' @{ refresh_token = $s.refresh_token } 30 $null
    if ($n.status -ne 200) { throw "Sessão expirada. Rode: .\scripts\yup.ps1 login" }
    SaveSession $n.body
    $r = Call $Method $Path $Body $Timeout $n.body.access_token
  }
  return $r
}

function Save([string]$Name, $Data) {
  $file = Join-Path $Projeto "resultado-$Name.json"
  $Data | ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 $file
  $Data | ConvertTo-Json -Depth 8
  Write-Host "`nResultado salvo em $file"
}

switch ($Acao) {
  'segredos' {
    $ErrorActionPreference = 'Continue'
    $quem = npx --no-install wrangler whoami 2>&1 | Out-String
    $ErrorActionPreference = 'Stop'
    if ($quem -match 'not authenticated') { Write-Host 'Faça login no Cloudflare (vai abrir o navegador; clique em Allow).'; npx --no-install wrangler login; if ($LASTEXITCODE -ne 0) { throw 'Login no Cloudflare falhou.' } }
    # Lê da área de transferência (colar em campo oculto no console do Windows corrompe o valor).
    function FromClipboard([string]$Pergunta, [scriptblock]$Valido, [string]$Formato) {
      for (;;) {
        Read-Host "$Pergunta`n  Copie o valor (Ctrl+C) e aperte Enter aqui" | Out-Null
        $v = (Get-Clipboard -Raw)
        if ($v) { $v = $v.Trim() }
        if ($v -and $v -match '^[\x21-\x7e]+$' -and (& $Valido $v)) { Set-Clipboard -Value ' '; Write-Host '  ok (área de transferência limpa)'; return $v }
        Write-Host "  O que está copiado não parece $Formato. Copie de novo." -ForegroundColor Yellow
      }
    }
    $erp = FromClipboard '1/2 TOKEN da API do Santarém Sistemas (o mesmo do Gestão à Vista).' { param($v) $v.Length -ge 16 } 'um token (16+ caracteres, sem espaços)'
    $key = FromClipboard '2/2 Chave secreta do Supabase: Project Settings > API Keys > service_role (eyJ...) ou Secret key (sb_secret_...).' { param($v) $v.StartsWith('sb_secret_') -or ($v.StartsWith('eyJ') -and $v.Length -gt 100) } 'a chave service_role (eyJ...) ou sb_secret_'
    PutSecret 'ERP_TOKEN' $erp
    PutSecret 'SUPABASE_URL' $SupabaseUrl
    PutSecret 'SUPABASE_SERVICE_ROLE_KEY' $key
    $erp = $null; $key = $null
    Start-Sleep -Seconds 5
    $h = Invoke-RestMethod "$Url/api/health"
    Save 'segredos' @{ health = $h }
    Write-Host "`nPróximo passo: .\scripts\yup.ps1 login"
  }
  'login' {
    $email = Read-Host 'E-mail do usuário admin (Supabase Auth)'
    $senha = Plain (Read-Host 'Senha' -AsSecureString)
    $r = Call POST '/api/auth/login' @{ email = $email; password = $senha } 30 $null
    $senha = $null
    if ($r.status -ne 200) { Save 'login' @{ status = $r.status; erro = $r.body.error }; throw "Login recusado: $($r.body.error)" }
    SaveSession $r.body
    Save 'login' @{ status = 200; usuario = $r.body.user.email }
    Write-Host "`nSessão salva. Próximo passo: .\scripts\yup.ps1 validar"
  }
  'validar' {
    $out = [ordered]@{}
    $out.erp_test = Api POST '/api/erp/test'
    $out.supabase_test = Api GET '/api/supabase/test'
    # Em duas partes para ficar abaixo do limite de 100 s por requisição.
    $out.schema_cadastros = Api POST '/api/erp/schema-check' @{ datasets = @('mercadoria_secao', 'mercadoria_grupo', 'mercadoria_subgrupo', 'mercadoria_marca', 'natureza_operacao', 'local_estoque', 'mercadoria', 'mercadoria_variacao', 'pessoa', 'mercadoria_fornecedor', 'mercadoria_estoque') } 110
    $out.schema_movimento = Api POST '/api/erp/schema-check' @{ datasets = @('mercadoria_custo', 'mercadoria_estoque_lote', 'mercadoria_tabela_preco', 'inventario', 'inventario_mercadoria', 'documento', 'documento_mercadoria', 'documento_mercadoria_custo', 'documento_cancelamento_historico', 'mercadoria_tabela_preco_historico', 'mercadoria_estoque_historico') } 110
    Save 'validar' $out
  }
  'contar' {
    $out = [ordered]@{}
    $out.parte1 = Api POST '/api/erp/counts' @{ datasets = @('mercadoria_secao', 'mercadoria_grupo', 'mercadoria_subgrupo', 'mercadoria_marca', 'natureza_operacao', 'local_estoque', 'mercadoria', 'mercadoria_variacao', 'pessoa', 'mercadoria_fornecedor', 'mercadoria_estoque') } 110
    $out.parte2 = Api POST '/api/erp/counts' @{ datasets = @('mercadoria_custo', 'mercadoria_estoque_lote', 'mercadoria_tabela_preco', 'inventario', 'inventario_mercadoria', 'documento', 'documento_mercadoria', 'documento_mercadoria_custo', 'documento_cancelamento_historico', 'mercadoria_tabela_preco_historico', 'mercadoria_estoque_historico') } 110
    Save 'contar' $out
  }
  'carga'    { Save 'carga' (Api POST '/api/sync/run' $null 300) }
  'carga-completa' {
    # Repete execuções até não haver nada devido. O ERP limita a ~1.800 linhas/min: a 1ª carga leva horas.
    $log = Join-Path $Projeto 'carga.log'
    $total = 0; $falhas = 0; $n = 0
    for (;;) {
      $n++
      $r = Api POST '/api/sync/run' $null 300
      $b = $r.body
      $linhas = [int]$b.rows
      $total += $linhas
      $jobs = ($b.jobs | ForEach-Object { "$($_.dataset)+$($_.rows)$(if ($_.completed) { '(ok)' })" }) -join ' '
      "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') #$n http=$($r.status) status=$($b.status) linhas=$linhas total=$total | $jobs | $($b.message)" | Tee-Object -FilePath $log -Append
      if ($b.message -eq 'Nada a sincronizar agora.') { "CONCLUIDO" | Tee-Object -FilePath $log -Append; break }
      if ($r.status -ne 200 -or $b.status -eq 'error') { $falhas++; if ($falhas -ge 10) { "PAROU: 10 falhas seguidas" | Tee-Object -FilePath $log -Append; break }; Start-Sleep -Seconds 60 } else { $falhas = 0 }
      if ($b.status -eq 'skipped') { Start-Sleep -Seconds 30 }
    }
  }
  'status'   { Save 'status' (Api GET '/api/sync/status') }
  'ligar'    { Save 'ligar' (Api POST '/api/sync/settings' @{ auto_enabled = $true }) }
  'desligar' { Save 'desligar' (Api POST '/api/sync/settings' @{ auto_enabled = $false }) }
}

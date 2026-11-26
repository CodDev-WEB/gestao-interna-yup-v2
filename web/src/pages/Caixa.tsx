// Conferência de caixa diária. 1ª etapa: mostra onde o ERP guarda o caixa e as formas de pagamento
// (descoberta automática, só leitura). Com isso mapeado, a conferência dia a dia entra nesta mesma tela.

import { useApi } from '../api'
import { haQuanto } from '../format'
import { Empty, ErrorState, Loading, PageHead } from '../ui'

type Descoberta = { started_at: string; details: { tabelas?: Record<string, string[]>; exemplos?: Record<string, unknown>; erro_colunas?: string } } | null

export default function Caixa() {
  const { data, error, reload, loading } = useApi<Descoberta>('dash/erp-caixa')
  const tabelas = Object.entries(data?.details?.tabelas ?? {})
  const exemplos = data?.details?.exemplos ?? {}
  return (
    <>
      <PageHead section="Controle dos dados" title="Conferência de caixa">
        Fechamento do caixa de cada dia: o que as vendas dizem que entrou, por forma de pagamento, contra o que o caixa registrou (abertura, sangrias, suprimentos e fechamento), com a diferença ao centavo.
      </PageHead>
      <div className="notice info" role="status">
        <span>Etapa 1 de 2: o sistema está mapeando onde o ERP guarda o caixa e as formas de pagamento (leitura automática, sem alterar nada no ERP). Com esse mapa, a conferência dia a dia passa a aparecer nesta tela.</span>
      </div>
      {error ? <ErrorState message={error} onRetry={reload} /> : loading && data === null ? <Loading rows={4} /> : !data ? (
        <Empty>O mapeamento ainda não rodou. Ele roda sozinho na próxima sincronização (em até 5 minutos). <button type="button" className="btn secondary small" onClick={reload}>Ver de novo</button></Empty>
      ) : (
        <>
          <p className="hint">Mapeado {haQuanto(data.started_at)}: {tabelas.length} tabelas do ERP ligadas a caixa e pagamento.{data.details.erro_colunas ? ` Erro ao ler o ERP: ${data.details.erro_colunas}` : ''}</p>
          {tabelas.length === 0 ? <Empty>Nenhuma tabela de caixa ou pagamento encontrada no ERP.</Empty> : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Tabelas do ERP ligadas a caixa e pagamento</caption>
                <thead><tr><th>Tabela no ERP</th><th className="r">Colunas</th><th>Colunas</th><th>Exemplo</th></tr></thead>
                <tbody>{tabelas.map(([t, cols]) => (
                  <tr key={t}>
                    <td>{t}</td>
                    <td className="r">{cols.length}</td>
                    <td className="wrap"><small>{cols.map(c => c.split(':')[0]).join(', ')}</small></td>
                    <td className="wrap"><small>{exemplos[t] ? JSON.stringify(exemplos[t]).slice(0, 400) : '—'}</small></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}

import { KPI_VERSION } from './kpi.ts';

/** Output di get_kpi_catalog (contracts/schemas/tools/get_kpi_catalog.schema.json, $defs/output). */
export interface KpiCatalogEntry {
  code: string;
  name: string;
  formula: string;
  unit: 'EUR' | '%' | 'COUNT' | 'DAYS' | 'INDEX';
  description?: string;
  available?: boolean;
}

export interface KpiCatalog {
  kpiVersion: string;
  kpis: KpiCatalogEntry[];
  dimensions: string[];
}

const RATE = 'Rapporto espresso come frazione (0.18 = 18%); unit "%" indica la presentazione.';
const NO_WINDOW =
  'Nessuna finestra di maturazione: usa tutti gli affidi con incassi cumulati ad asOf; confrontare recuperatori con mix di date di inizio diversi puo distorcere il risultato.';
const rr =(d: string, label: string): KpiCatalogEntry => ({
  code: d === 'END' ? 'RR_END' : `RR_${d}`,
  name: `Recovery rate ${label}`,
  formula: `Σ incassi entro ${label} dall'inizio affido / Σ esposizione iniziale`,
  unit: '%',
  description: `${RATE} Solo affidi con osservazione completa della finestra.`,
});

/** `commissionsAvailable`: false se il dataset non ha le provvigioni (COST_RATIO / NET_RECOVERY non disponibili). */
export function getKpiCatalog(options: { commissionsAvailable?: boolean } = {}): KpiCatalog {
  const comm = options.commissionsAvailable ?? true;
  return {
    kpiVersion: KPI_VERSION,
    kpis: [
      rr('30', '30 giorni'),
      rr('60', '60 giorni'),
      rr('90', '90 giorni'),
      rr('180', '180 giorni'),
      rr('END', 'fine affido'),
      {
        code: 'CURE_RATE',
        name: 'Tasso di regolarizzazione',
        formula: 'Affidi conclusi con esito regolarizzata o chiusa / affidi conclusi',
        unit: '%',
        description: RATE,
      },
      {
        code: 'FIRST_PAY_DAYS',
        name: 'Tempo al primo incasso',
        formula: 'Mediana dei giorni tra inizio affido e primo incasso (solo affidi con incasso)',
        unit: 'DAYS',
      },
      {
        code: 'PAY_RATE',
        name: 'Tasso di pratiche con incasso',
        formula: 'Affidi con almeno un incasso / affidi',
        unit: '%',
        description: `${RATE} ${NO_WINDOW}`,
      },
      { code: 'AVG_RECOVERED', name: 'Incasso medio per affido', formula: 'Σ incassi / numero affidi', unit: 'EUR', description: NO_WINDOW },
      {
        code: 'RETURN_NO_PAY',
        name: 'Restituite senza incasso',
        formula: 'Affidi conclusi senza incassi / affidi conclusi',
        unit: '%',
        description: RATE,
      },
      {
        code: 'PTP_KEPT',
        name: 'Promesse di pagamento mantenute',
        formula: 'Promesse onorate / promesse registrate (solo se presenti nei rapportini)',
        unit: '%',
        description: 'Non calcolabile: i dati non contengono le promesse di pagamento.',
        available: false,
      },
      {
        code: 'COST_RATIO',
        name: 'Costo per euro recuperato',
        formula: 'Σ provvigioni / Σ incassi',
        unit: '%',
        description: `${RATE} ${NO_WINDOW}`,
        available: comm,
      },
      { code: 'NET_RECOVERY', name: 'Recupero netto', formula: 'Σ incassi − Σ provvigioni', unit: 'EUR', description: NO_WINDOW, available: comm },
    ],
    dimensions: ['collector', 'fascia', 'product', 'exposureClass', 'classification', 'region'],
  };
}

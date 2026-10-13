/** Record di affido (pagina 04 ATF, "Unita di analisi: l'affido"). Date ISO YYYY-MM-DD. */

export type Esito = 'REGOLARIZZATA' | 'CHIUSA' | 'RESTITUITA' | 'FASCIA_SUCCESSIVA' | 'IN_CORSO';

export interface Incasso {
  data: string;
  /** Importo in EUR; negativo = dato sporco. */
  importo: number;
}

export interface Segmento {
  prodotto: string;
  /** Classe di esposizione: "<5k", "5-20k", ">20k". */
  classeEsposizione: string;
  classificazione: string;
  regione: string;
}

export interface Affido {
  /** pratica + recuperatore + data inizio. */
  idAffido: string;
  pratica: string;
  recuperatore: string;
  /** Fascia al momento dell'affido; null = non ricostruibile. */
  fasciaAffido: string | null;
  /** null = dato mancante (sporco). */
  dataInizio: string | null;
  /** null se in corso (o mancante per un affido concluso: dato sporco). */
  dataFine: string | null;
  /** null o <= 0 = dato mancante/sporco. */
  esposizioneIniziale: number | null;
  segmento: Segmento;
  incassi: Incasso[];
  esito: Esito;
  /** Provvigioni riconosciute; null = non disponibili. */
  provvigioni: number | null;
}

/** Incasso senza un affido corrispondente (controllo qualita PAYMENT_WITHOUT_ASSIGNMENT). */
export interface IncassoSenzaAffido {
  pratica: string;
  recuperatore: string;
  data: string;
  importo: number;
}

export interface Dataset {
  /** Data di riferimento dei dati (fissata dal generatore, mai la data corrente). */
  asOf: string;
  seed: number;
  affidi: Affido[];
  incassiSenzaAffido: IncassoSenzaAffido[];
}

export interface Scope {
  from?: string;
  to?: string;
  fasce?: string[];
  collectors?: string[];
  products?: string[];
  regions?: string[];
}

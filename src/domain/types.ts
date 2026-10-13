import type { Cents } from './money';
import type { HHmm, ISODate } from './time';
import type { ClientShifts, ShiftKey } from './shifts';

export type ID = string;

export type ClientKind = 'ski_school' | 'asd' | 'other';

export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  ski_school: 'Scuola di sci',
  asd: 'Associazione sportiva',
  other: 'Altro committente',
};

export interface Client {
  id: ID;
  name: string;
  kind: ClientKind;
  /** Colore per distinguere il committente nel calendario. */
  color: string;
  /** Minuti di trasferimento da riservare prima/dopo un impegno in un luogo diverso. */
  travelMinutes: number;
  /** Modalità di documentazione (testo libero: fattura, ricevuta, ...). */
  documentationMode: string;
  /** Periodicità concordata (testo libero: non si presume mensile o stagionale). */
  billingPeriodicity: string;
  /** Termine di pagamento in giorni dalla data del documento (null = non configurato). */
  paymentTermsDays: number | null;
  paymentMethod: string;
  adminNotes: string;
  notes: string;
  active: boolean;
  /** Orari dei turni (mattina, pomeriggio, giornata intera), se usati con questo committente. */
  shifts?: ClientShifts;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType =
  | 'private_lesson'
  | 'training'
  | 'race'
  | 'trip'
  | 'meeting'
  | 'personal'
  | 'other';

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  private_lesson: 'Lezione privata',
  training: 'Allenamento',
  race: 'Gara',
  trip: 'Trasferta',
  meeting: 'Riunione',
  personal: 'Impegno personale',
  other: 'Altro',
};

export const ACTIVITY_TYPES = Object.keys(ACTIVITY_TYPE_LABEL) as ActivityType[];

/** Le attività personali non hanno committente né compenso. */
export function isWorkType(t: ActivityType): boolean {
  return t !== 'personal';
}

export type LessonLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export const LESSON_LEVEL_LABEL: Record<LessonLevel, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzato',
  expert: 'Esperto',
};

export const LESSON_LEVELS = Object.keys(LESSON_LEVEL_LABEL) as LessonLevel[];

export type ActivityStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled';

export const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  planned: 'Pianificato',
  confirmed: 'Confermato',
  completed: 'Completato',
  cancelled: 'Cancellato',
};

export type RateMode = 'hourly' | 'per_lesson' | 'daily';

export const RATE_MODE_LABEL: Record<RateMode, string> = {
  hourly: 'Oraria',
  per_lesson: 'Per lezione',
  daily: 'Giornaliera',
};

export type RoundingMode = 'none' | 'nearest' | 'up' | 'down';

export const ROUNDING_MODE_LABEL: Record<RoundingMode, string> = {
  none: 'Nessuno (minuto esatto)',
  nearest: 'Al più vicino',
  up: 'Per eccesso',
  down: 'Per difetto',
};

/** Regola di compenso. Copiata integralmente nell'attività al momento dell'uso (snapshot). */
export interface RateTerms {
  mode: RateMode;
  /** Importo base: €/ora, €/lezione o €/giorno, in centesimi. */
  amountCents: Cents;
  /** Maggiorazione percentuale in punti base (1% = 100). */
  surchargeBps: number;
  /** Commissione percentuale trattenuta dal committente, in punti base. */
  commissionBps: number;
  /** Trattenuta fissa per attività, in centesimi. */
  fixedDeductionCents: Cents;
  /** Arrotondamento dei minuti riconosciuti (solo tariffa oraria). */
  roundingStepMinutes: number;
  roundingMode: RoundingMode;
  currency: 'EUR';
}

export interface Rate extends RateTerms {
  id: ID;
  clientId: ID;
  /** null = valida per tutte le tipologie del committente. */
  activityType: ActivityType | null;
  label: string;
  validFrom: ISODate;
  /** null = senza scadenza. */
  validTo: ISODate | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppliedRate extends RateTerms {
  /** Tariffa di origine, se scelta tra quelle configurate; null se inserita manualmente. */
  rateId: ID | null;
  label: string;
}

export interface Activity {
  id: ID;
  title: string;
  type: ActivityType;
  clientId: ID | null;
  date: ISODate;
  start: HHmm;
  /** Se <= start l'attività termina il giorno successivo. */
  end: HHmm;
  /** Minuti di pausa non retribuiti, sottratti dalla durata prevista. */
  breakMinutes: number;
  /**
   * Minuti effettivamente lavorati, se diversi dal previsto (attività incompleta,
   * prolungata...). null = uguale al previsto.
   */
  actualMinutes: number | null;
  /** Numero di lezioni/giornate per tariffe "per lezione" e "giornaliera". */
  units: number;
  status: ActivityStatus;
  location: string;
  notes: string;
  /** Tariffa effettivamente applicata (snapshot). null per attività senza compenso. */
  rate: AppliedRate | null;
  /** Correzione manuale del compenso maturato (+/-), con motivazione. */
  manualAdjustmentCents: Cents;
  manualAdjustmentReason: string;
  /** Compenso riconosciuto in caso di cancellazione. */
  cancellationFeeCents: Cents;
  /** Minuti di promemoria prima dell'inizio (null = nessuno). */
  reminderMinutesBefore: number | null;
  /** Serie ricorrente di appartenenza. */
  seriesId?: ID;
  /** Turno (mattina, pomeriggio, giornata intera): gli orari seguono quelli del committente. */
  shift?: ShiftKey;
  /** Livello degli allievi (facoltativo). */
  level?: LessonLevel;
  /** UID esterno (es. importazione ICS) per evitare duplicati. Mai null: assente se non presente. */
  externalUid?: string;
  createdAt: string;
  updatedAt: string;
}

export type AvailabilityKind = 'available' | 'unavailable' | 'bookable';

export const AVAILABILITY_KIND_LABEL: Record<AvailabilityKind, string> = {
  available: 'Disponibile a lavorare',
  bookable: 'Accetto nuove lezioni',
  unavailable: 'Non disponibile',
};

export interface AvailabilityRule {
  id: ID;
  kind: AvailabilityKind;
  /** Regola ricorrente: giorni della settimana (0 = lunedì). Vuoto se regola per data. */
  weekdays: number[];
  /** Regola per singolo giorno (eccezione). Se presente, sostituisce le regole ricorrenti di quel giorno. */
  date: ISODate | null;
  start: HHmm;
  end: HHmm;
  validFrom: ISODate | null;
  validTo: ISODate | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type LedgerKind = 'reimbursement' | 'expense' | 'set_aside';

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  reimbursement: 'Rimborso',
  expense: 'Spesa',
  set_aside: 'Accantonamento',
};

export interface LedgerEntry {
  id: ID;
  kind: LedgerKind;
  clientId: ID | null;
  activityId: ID | null;
  date: ISODate;
  /** Per gli accantonamenti un importo negativo indica un prelievo. */
  amountCents: Cents;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentManualStatus = 'to_verify' | 'to_prepare' | 'to_issue' | 'issued';
export type DocumentStatus = DocumentManualStatus | 'partially_paid' | 'paid' | 'overdue';

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  to_verify: 'Da verificare',
  to_prepare: 'Da preparare',
  to_issue: 'Da emettere',
  issued: 'Emesso',
  partially_paid: 'Parzialmente pagato',
  paid: 'Pagato',
  overdue: 'Scaduto',
};

export interface WorkDocument {
  id: ID;
  clientId: ID;
  /** Numero/identificativo del documento (es. numero fattura). */
  number: string;
  kind: string;
  /** Data di emissione (null finché non emesso). */
  issueDate: ISODate | null;
  periodFrom: ISODate | null;
  periodTo: ISODate | null;
  amountCents: Cents;
  dueDate: ISODate | null;
  /** Stato manuale; gli stati di pagamento/scadenza sono derivati dai pagamenti. */
  status: DocumentManualStatus;
  notes: string;
  /** Riferimento all'allegato salvato nella tabella files. */
  fileId: ID | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: ID;
  documentId: ID | null;
  clientId: ID;
  date: ISODate;
  amountCents: Cents;
  method: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFile {
  id: ID;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

export type GoalMetric =
  | 'private_lesson_hours'
  | 'training_hours'
  | 'worked_hours'
  | 'accrued'
  | 'collected'
  | 'worked_days'
  | 'free_days';

export const GOAL_METRIC_LABEL: Record<GoalMetric, string> = {
  private_lesson_hours: 'Ore di lezioni private',
  training_hours: 'Ore di allenamento',
  worked_hours: 'Ore lavorate totali',
  accrued: 'Guadagno maturato',
  collected: 'Guadagno incassato',
  worked_days: 'Giorni lavorati',
  free_days: 'Giorni liberi',
};

export interface Goal {
  id: ID;
  metric: GoalMetric;
  label: string;
  /** Ore e giorni: unità intere (minuti per le ore); importi: centesimi. */
  target: number;
  periodFrom: ISODate;
  periodTo: ISODate;
  clientId: ID | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: ID;
  entity: string;
  entityId: ID;
  action: 'create' | 'update' | 'delete' | 'status' | 'import' | 'restore';
  /** Campi modificati: valore precedente e nuovo. */
  changes: Record<string, { from?: unknown; to?: unknown }>;
  reason: string;
  at: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

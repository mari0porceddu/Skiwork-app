/** Formato del backup completo e sua validazione (nessun dato viene scritto se la validazione fallisce). */
import { z } from 'zod';

export const BACKUP_APP = 'skiwork';
export const BACKUP_FORMAT_VERSION = 1;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data non valida (YYYY-MM-DD)');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'orario non valido (HH:mm)');
const cents = z.number().int('importo non intero (centesimi)');
const id = z.string().min(1);
const stamp = z.string();
const activityType = z.enum(['private_lesson', 'training', 'race', 'trip', 'meeting', 'personal', 'other']);

const rateTerms = {
  mode: z.enum(['hourly', 'per_lesson', 'daily']),
  amountCents: cents,
  surchargeBps: z.number().int(),
  commissionBps: z.number().int(),
  fixedDeductionCents: cents,
  roundingStepMinutes: z.number().int().min(0),
  roundingMode: z.enum(['none', 'nearest', 'up', 'down']),
  currency: z.literal('EUR'),
};

export const clientSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(['ski_school', 'asd', 'other']),
  color: z.string(),
  travelMinutes: z.number().int().min(0),
  documentationMode: z.string(),
  billingPeriodicity: z.string(),
  paymentTermsDays: z.number().int().min(0).nullable(),
  paymentMethod: z.string(),
  adminNotes: z.string(),
  notes: z.string(),
  active: z.boolean(),
  shifts: z.record(z.enum(['morning', 'afternoon', 'full_day']), z.object({ start: time, end: time })).optional(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const rateSchema = z.object({
  id,
  clientId: id,
  activityType: activityType.nullable(),
  label: z.string(),
  validFrom: date,
  validTo: date.nullable(),
  ...rateTerms,
  createdAt: stamp,
  updatedAt: stamp,
});

export const activitySchema = z.object({
  id,
  title: z.string(),
  type: activityType,
  clientId: id.nullable(),
  date,
  start: time,
  end: time,
  breakMinutes: z.number().int().min(0),
  actualMinutes: z.number().int().min(0).nullable(),
  units: z.number().int().min(0),
  status: z.enum(['planned', 'confirmed', 'completed', 'cancelled']),
  location: z.string(),
  notes: z.string(),
  rate: z.object({ rateId: id.nullable(), label: z.string(), ...rateTerms }).nullable(),
  manualAdjustmentCents: cents,
  manualAdjustmentReason: z.string(),
  cancellationFeeCents: cents,
  reminderMinutesBefore: z.number().int().min(0).nullable(),
  seriesId: id.optional(),
  shift: z.enum(['morning', 'afternoon', 'full_day']).optional(),
  level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  gcalEventId: z.string().optional(),
  gcalSyncedAt: z.string().optional(),
  gcalUpdated: z.string().optional(),
  needsDetails: z.boolean().optional(),
  externalUid: z.string().optional(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const availabilitySchema = z.object({
  id,
  kind: z.enum(['available', 'unavailable', 'bookable']),
  weekdays: z.array(z.number().int().min(0).max(6)),
  date: date.nullable(),
  start: time,
  end: time,
  validFrom: date.nullable(),
  validTo: date.nullable(),
  note: z.string(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const ledgerSchema = z.object({
  id,
  kind: z.enum(['reimbursement', 'expense', 'set_aside']),
  clientId: id.nullable(),
  activityId: id.nullable(),
  date,
  amountCents: cents,
  description: z.string(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const documentSchema = z.object({
  id,
  clientId: id,
  number: z.string(),
  kind: z.string(),
  issueDate: date.nullable(),
  periodFrom: date.nullable(),
  periodTo: date.nullable(),
  amountCents: cents,
  dueDate: date.nullable(),
  status: z.enum(['to_verify', 'to_prepare', 'to_issue', 'issued']),
  notes: z.string(),
  fileId: id.nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const paymentSchema = z.object({
  id,
  documentId: id.nullable(),
  clientId: id,
  date,
  amountCents: cents,
  method: z.string(),
  notes: z.string(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const goalSchema = z.object({
  id,
  metric: z.enum(['private_lesson_hours', 'training_hours', 'worked_hours', 'accrued', 'collected', 'worked_days', 'free_days']),
  label: z.string(),
  target: z.number().int().min(0),
  periodFrom: date,
  periodTo: date,
  clientId: id.nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const auditSchema = z.object({
  id,
  entity: z.string(),
  entityId: id,
  action: z.enum(['create', 'update', 'delete', 'status', 'import', 'restore']),
  changes: z.record(z.object({ from: z.unknown(), to: z.unknown() })),
  reason: z.string(),
  at: stamp,
});

export const fiscalParamSchema = z.object({
  id,
  key: z.enum(['revenue_basis', 'profitability_coefficient', 'substitute_tax_rate', 'contribution_rate', 'contribution_fixed', 'deduct_contributions', 'contributions_paid', 'advance_rate', 'advances_paid']),
  year: z.number().int(),
  clientId: id.nullable(),
  value: z.union([z.number().int(), z.string()]).nullable(),
  status: z.enum(['to_verify', 'verified', 'expired', 'not_applicable']),
  statusReason: z.string(),
  source: z.string(),
  validFrom: date.nullable(),
  validTo: date.nullable(),
  lastVerifiedAt: date.nullable(),
  createdAt: stamp,
  updatedAt: stamp,
});

export const fiscalDeadlineSchema = z.object({ id, date, title: z.string().min(1), amountCents: cents.nullable(), notes: z.string(), done: z.boolean(), createdAt: stamp, updatedAt: stamp });

export const settingSchema = z.object({ key: z.string().min(1), value: z.unknown() });

/** Allegati codificati come data URL base64. */
export const fileSchema = z.object({
  id,
  name: z.string(),
  type: z.string(),
  size: z.number().int().min(0),
  dataUrl: z.string().startsWith('data:'),
  createdAt: stamp,
});

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP),
  formatVersion: z.number().int().min(1).max(BACKUP_FORMAT_VERSION),
  dbVersion: z.number().int().min(1),
  exportedAt: stamp,
  tables: z.object({
    clients: z.array(clientSchema),
    rates: z.array(rateSchema),
    activities: z.array(activitySchema),
    availability: z.array(availabilitySchema),
    ledger: z.array(ledgerSchema),
    documents: z.array(documentSchema),
    payments: z.array(paymentSchema),
    goals: z.array(goalSchema),
    audit: z.array(auditSchema),
    settings: z.array(settingSchema),
    files: z.array(fileSchema).default([]),
    fiscalParams: z.array(fiscalParamSchema).default([]),
    fiscalDeadlines: z.array(fiscalDeadlineSchema).default([]),
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;

export interface ValidationResult {
  ok: boolean;
  data?: BackupFile;
  errors: string[];
}

/** Valida struttura e integrità referenziale del backup. */
export function validateBackup(raw: unknown): ValidationResult {
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(radice)'}: ${i.message}`),
    };
  }
  const t = parsed.data.tables;
  const errors: string[] = [];
  const unique = (name: string, rows: { id: string }[]) => {
    const s = new Set<string>();
    for (const r of rows) {
      if (s.has(r.id)) errors.push(`${name}: ID duplicato ${r.id}`);
      s.add(r.id);
    }
    return s;
  };
  const clients = unique('clients', t.clients);
  unique('rates', t.rates);
  const activities = unique('activities', t.activities);
  unique('availability', t.availability);
  unique('ledger', t.ledger);
  const documents = unique('documents', t.documents);
  unique('payments', t.payments);
  unique('goals', t.goals);
  const files = unique('files', t.files);
  const uids = new Set<string>();
  for (const a of t.activities) {
    if (a.clientId && !clients.has(a.clientId)) errors.push(`activities ${a.id}: committente inesistente`);
    if (a.externalUid) {
      if (uids.has(a.externalUid)) errors.push(`activities ${a.id}: UID esterno duplicato`);
      uids.add(a.externalUid);
    }
  }
  unique('fiscalParams', t.fiscalParams);
  unique('fiscalDeadlines', t.fiscalDeadlines);
  for (const f of t.fiscalParams) if (f.clientId && !clients.has(f.clientId)) errors.push(`fiscalParams ${f.id}: committente inesistente`);
  for (const r of t.rates) if (!clients.has(r.clientId)) errors.push(`rates ${r.id}: committente inesistente`);
  for (const d of t.documents) {
    if (!clients.has(d.clientId)) errors.push(`documents ${d.id}: committente inesistente`);
    if (d.fileId && !files.has(d.fileId)) errors.push(`documents ${d.id}: allegato mancante`);
  }
  for (const p of t.payments) {
    if (!clients.has(p.clientId)) errors.push(`payments ${p.id}: committente inesistente`);
    if (p.documentId && !documents.has(p.documentId)) errors.push(`payments ${p.id}: documento inesistente`);
  }
  for (const e of t.ledger) {
    if (e.clientId && !clients.has(e.clientId)) errors.push(`ledger ${e.id}: committente inesistente`);
    if (e.activityId && !activities.has(e.activityId)) errors.push(`ledger ${e.id}: attività inesistente`);
  }
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, data: parsed.data, errors: [] };
}

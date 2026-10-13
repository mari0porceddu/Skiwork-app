import type { Activity, AppliedRate, AvailabilityRule, Client, Goal, Payment, Rate, WorkDocument } from '../src/domain/types';

const T = '2026-01-01T00:00:00.000Z';

export function hourly(amountCents: number, extra: Partial<AppliedRate> = {}): AppliedRate {
  return {
    rateId: null,
    label: 'Test',
    mode: 'hourly',
    amountCents,
    surchargeBps: 0,
    commissionBps: 0,
    fixedDeductionCents: 0,
    roundingStepMinutes: 0,
    roundingMode: 'none',
    currency: 'EUR',
    ...extra,
  };
}

export function activity(p: Partial<Activity> = {}): Activity {
  return {
    id: p.id ?? 'a1',
    title: '',
    type: 'private_lesson',
    clientId: 'school',
    date: '2026-01-10',
    start: '09:00',
    end: '11:00',
    breakMinutes: 0,
    actualMinutes: null,
    units: 1,
    status: 'completed',
    location: '',
    notes: '',
    rate: hourly(5000),
    manualAdjustmentCents: 0,
    manualAdjustmentReason: '',
    cancellationFeeCents: 0,
    reminderMinutesBefore: null,
    createdAt: T,
    updatedAt: T,
    ...p,
  };
}

export function client(p: Partial<Client> = {}): Client {
  return {
    id: 'school',
    name: 'Scuola',
    kind: 'ski_school',
    color: '#000',
    travelMinutes: 0,
    documentationMode: '',
    billingPeriodicity: '',
    paymentTermsDays: 30,
    paymentMethod: '',
    adminNotes: '',
    notes: '',
    active: true,
    createdAt: T,
    updatedAt: T,
    ...p,
  };
}

export function rate(p: Partial<Rate> = {}): Rate {
  return { ...hourly(5000), id: 'r1', clientId: 'school', activityType: null, label: 'R', validFrom: '2026-01-01', validTo: null, createdAt: T, updatedAt: T, ...p } as Rate;
}

export function doc(p: Partial<WorkDocument> = {}): WorkDocument {
  return {
    id: 'd1',
    clientId: 'school',
    number: '1/2026',
    kind: 'Fattura',
    issueDate: '2026-01-31',
    periodFrom: '2026-01-01',
    periodTo: '2026-01-31',
    amountCents: 100000,
    dueDate: '2026-03-02',
    status: 'issued',
    notes: '',
    fileId: null,
    createdAt: T,
    updatedAt: T,
    ...p,
  };
}

export function payment(p: Partial<Payment> = {}): Payment {
  return { id: 'p1', documentId: 'd1', clientId: 'school', date: '2026-02-10', amountCents: 40000, method: 'Bonifico', notes: '', createdAt: T, updatedAt: T, ...p };
}

export function avail(p: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return { id: 'av1', kind: 'available', weekdays: [0, 1, 2, 3, 4, 5, 6], date: null, start: '08:00', end: '17:00', validFrom: null, validTo: null, note: '', createdAt: T, updatedAt: T, ...p };
}

export function goal(p: Partial<Goal> = {}): Goal {
  return { id: 'g1', metric: 'private_lesson_hours', label: '', target: 600, periodFrom: '2026-01-01', periodTo: '2026-01-10', clientId: null, createdAt: T, updatedAt: T, ...p };
}

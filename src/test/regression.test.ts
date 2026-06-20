import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import type { SampleImportRow } from '@shared/types';

const ADMIN_USER = { username: 'admin', password: '123456' };

const makeRow = (sampleNo: string, overrides?: Partial<SampleImportRow>): SampleImportRow => ({
  sampleNo,
  type: 'blood',
  collectedAt: '2025-06-21T10:00:00Z',
  collectedBy: '张采集',
  ...overrides,
});

const initAndLogin = async () => {
  const store = useAppStore.getState();
  await store.initializeDB();
  await store.login(ADMIN_USER.username, ADMIN_USER.password);
};

describe('Batch import with mixed duplicate and new samples', () => {
  it('should import valid rows and only record failures for duplicates in the same batch', async () => {
    await initAndLogin();

    const rows: SampleImportRow[] = [
      makeRow('S-MIX-001'),
      makeRow('S-MIX-002'),
      makeRow('S-MIX-001'),
      makeRow('S-MIX-003'),
      makeRow('S-MIX-002'),
      makeRow('S-MIX-004'),
    ];

    const result = await useAppStore.getState().importBatch(rows, 'BATCH-MIX-001');

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(4);
    expect(result.failedRows).toHaveLength(2);

    const failedNos = result.failedRows.map((f) => f.data.sampleNo);
    expect(failedNos).toEqual(['S-MIX-001', 'S-MIX-002']);

    const importedNos = useAppStore.getState().samples
      .filter((s) => s.sampleNo.startsWith('S-MIX-'))
      .map((s) => s.sampleNo)
      .sort();
    expect(importedNos).toEqual(['S-MIX-001', 'S-MIX-002', 'S-MIX-003', 'S-MIX-004']);

    const failedTransfers = useAppStore.getState().failedTransfers.filter(
      (f) => (f.payload?.batchNo as string) === 'BATCH-MIX-001'
    );
    expect(failedTransfers.length).toBe(2);
    expect(failedTransfers.every((f) => f.errorCode === 'DUPLICATE_SAMPLE_NO')).toBe(true);
  });

  it('should import new samples even when some rows have missing required fields', async () => {
    await initAndLogin();

    const rows: SampleImportRow[] = [
      makeRow('S-FIELD-001'),
      { sampleNo: '', type: 'blood', collectedAt: '2025-01-01', collectedBy: 'X' },
      makeRow('S-FIELD-002'),
      { sampleNo: 'S-FIELD-NODATE', type: 'blood', collectedAt: '', collectedBy: 'X' },
    ];

    const result = await useAppStore.getState().importBatch(rows, 'BATCH-FIELD-001');

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
    expect(result.failedRows).toHaveLength(2);

    const importedNos = useAppStore.getState().samples
      .filter((s) => s.sampleNo.startsWith('S-FIELD-'))
      .map((s) => s.sampleNo)
      .sort();
    expect(importedNos).toEqual(['S-FIELD-001', 'S-FIELD-002']);
  });

  it('should reject re-importing a sampleNo that already exists in DB from a previous batch', async () => {
    await initAndLogin();

    const batch1 = [makeRow('S-EXIST-001'), makeRow('S-EXIST-002')];
    const r1 = await useAppStore.getState().importBatch(batch1, 'BATCH-EXIST-1');
    expect(r1.importedCount).toBe(2);

    const batch2 = [makeRow('S-EXIST-001'), makeRow('S-EXIST-003')];
    const r2 = await useAppStore.getState().importBatch(batch2, 'BATCH-EXIST-2');

    expect(r2.success).toBe(true);
    expect(r2.importedCount).toBe(1);
    expect(r2.failedRows).toHaveLength(1);
    expect(r2.failedRows[0].errorCode).toBe('DUPLICATE_SAMPLE_NO');

    const allNos = useAppStore.getState().samples
      .filter((s) => s.sampleNo.startsWith('S-EXIST-'))
      .map((s) => s.sampleNo)
      .sort();
    expect(allNos).toEqual(['S-EXIST-001', 'S-EXIST-002', 'S-EXIST-003']);
  });
});

describe('Rollback audit chain completeness', () => {
  it('should produce complete rollback chain in exported audit data', async () => {
    await initAndLogin();
    const store = useAppStore.getState();

    const rows = [makeRow('S-RLB-001')];
    await store.importBatch(rows, 'BATCH-RLB-001');

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === 'S-RLB-001')!;
    expect(sample).toBeDefined();

    const locations = useAppStore.getState().locations;
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;

    const inboundResult = await store.performInbound(sample.id, storageLoc.id);
    expect(inboundResult).not.toBeNull();

    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];
    expect(tester).toBeDefined();

    const outboundResult = await store.performOutbound(sample.id, storageLoc.id, tester.id);
    expect(outboundResult).not.toBeNull();

    await store.logout();
    await store.login('auditor01', '123456');

    const rollbackResult = await useAppStore.getState().performRollback(outboundResult!.id, '出库操作有误，需要回退');
    expect(rollbackResult).not.toBeNull();

    const jsonExport = await useAppStore.getState().exportAuditData('json');
    const parsed = JSON.parse(jsonExport as string);

    expect(parsed.transfers).toBeDefined();
    expect(parsed.failedTransfers).toBeDefined();

    const sampleTransfers = parsed.transfers.filter(
      (t: any) => t.sampleNo === 'S-RLB-001'
    );

    const outboundRecord = sampleTransfers.find((t: any) => t.transferType === 'outbound');
    expect(outboundRecord).toBeDefined();
    expect(outboundRecord.isRolledBack).toBe(true);
    expect(outboundRecord.rolledBackBy).toBeTruthy();
    expect(outboundRecord.rolledBackAt).toBeTruthy();
    expect(outboundRecord.rollbackReason).toBe('出库操作有误，需要回退');

    const rollbackRecord = sampleTransfers.find((t: any) => t.transferType === 'rollback');
    expect(rollbackRecord).toBeDefined();
    expect(rollbackRecord.rollbackToRecordId).toBeTruthy();
    expect(rollbackRecord.remark).toContain('回退交接记录');

    const rollbackAuditLog = parsed.auditLogs.find(
      (l: any) => l.action === 'transfer:rollback'
    );
    expect(rollbackAuditLog).toBeDefined();
    expect(rollbackAuditLog.details.sampleNo).toBe('S-RLB-001');
    expect(rollbackAuditLog.details.reason).toBe('出库操作有误，需要回退');

    const csvExport = await useAppStore.getState().exportAuditData('csv');
    const csvStr = csvExport as string;
    expect(csvStr).toContain('回退至记录ID');
    expect(csvStr).toContain('失败记录');
  });

  it('should record failed transfer attempts in the audit chain', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FAIL-001')];
    await useAppStore.getState().importBatch(rows, 'BATCH-FAIL-001');

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === 'S-FAIL-001')!;

    const testingLoc = useAppStore.getState().locations.find(
      (l) => l.type === 'testing' && l.status === 'active'
    )!;

    const result = await useAppStore.getState().performTestReceive(sample.id, testingLoc.id);
    expect(result).toBeNull();

    await useAppStore.getState().getFailedTransfers();
    const fails = useAppStore.getState().failedTransfers.filter(
      (f) => f.sampleId === sample.id
    );
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(fails[0].errorCode).toBe('INVALID_STATUS_TRANSITION');

    const jsonExport = await useAppStore.getState().exportAuditData('json');
    const parsed = JSON.parse(jsonExport as string);
    expect(parsed.failedTransfers.length).toBeGreaterThanOrEqual(1);

    const sampleFail = parsed.failedTransfers.find(
      (f: any) => f.sampleNo === 'S-FAIL-001'
    );
    expect(sampleFail).toBeDefined();
    expect(sampleFail.errorCode).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('Data persistence after reinitialize', () => {
  it('should retain all data after re-initializing the store from IndexedDB', async () => {
    await initAndLogin();

    const rows = [makeRow('S-PERS-001'), makeRow('S-PERS-002')];
    await useAppStore.getState().importBatch(rows, 'BATCH-PERS-001');

    const locations = useAppStore.getState().locations;
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;

    const sample1 = useAppStore.getState().samples.find((s) => s.sampleNo === 'S-PERS-001')!;
    await useAppStore.getState().performInbound(sample1.id, storageLoc.id);

    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];

    const outboundResult = await useAppStore.getState().performOutbound(sample1.id, storageLoc.id, tester.id);
    expect(outboundResult).not.toBeNull();

    useAppStore.setState({
      currentUser: null,
      samples: [],
      batches: [],
      transferRecords: [],
      failedTransfers: [],
      auditLogs: [],
      isInitialized: false,
    });

    await useAppStore.getState().initializeDB();
    await useAppStore.getState().login('admin', '123456');

    const restoredSamples = useAppStore.getState().samples.filter(
      (s) => s.sampleNo.startsWith('S-PERS-')
    );
    expect(restoredSamples.length).toBe(2);

    const restoredSample1 = useAppStore.getState().samples.find(
      (s) => s.sampleNo === 'S-PERS-001'
    )!;
    expect(restoredSample1.currentStatus).toBe('in_transit');
    expect(restoredSample1.currentHolderId).toBe(tester.id);

    const restoredSample2 = useAppStore.getState().samples.find(
      (s) => s.sampleNo === 'S-PERS-002'
    )!;
    expect(restoredSample2.currentStatus).toBe('imported');

    const restoredBatches = useAppStore.getState().batches;
    expect(restoredBatches.some((b) => b.batchNo === 'BATCH-PERS-001')).toBe(true);

    const transfers = await useAppStore.getState().getTransferRecordsBySample(restoredSample1.id);
    expect(transfers.length).toBe(3);
    expect(transfers.map((t) => t.type).sort()).toEqual(['import', 'inbound', 'outbound']);
  });
});

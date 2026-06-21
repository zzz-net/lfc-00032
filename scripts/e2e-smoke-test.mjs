// E2E Smoke Test - Node.js version using fetch (native in Node 18+)
// Usage: node scripts/e2e-smoke-test.mjs

const BASE = process.env.BASE_URL || 'http://127.0.0.1:51877';
let passed = 0;
let failed = 0;
const failures = [];

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const gray = (s) => `\x1b[90m${s}\x1b[0m`;

const hd = (msg) => {
  const line = '='.repeat(70);
  console.log(`\n${cyan(line)}`);
  console.log(cyan(`  ${msg}`));
  console.log(`${cyan(line)}\n`);
};
const ok = (msg) => { console.log(`  ${green('[OK]')}  ${msg}`); passed++; };
const info = (msg) => { console.log(`  ${gray('...')}  ${msg}`); };
const fail = (msg, actual = null) => {
  console.log(`  ${red('[FAIL]')} ${msg}`);
  if (actual !== null) console.log(`         actual: ${JSON.stringify(actual).slice(0, 200)}`);
  failures.push(msg);
  failed++;
};
const assert = (cond, msg, actual = null) => {
  if (cond) ok(msg); else fail(msg, actual);
};

async function req(method, path, token, body = undefined) {
  const opts = {
    method,
    headers: {},
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(`${BASE}${path}`, opts);
  const raw = await resp.text();
  let body_ = null;
  try { body_ = raw ? JSON.parse(raw) : raw; } catch { body_ = raw; }
  return {
    ok: resp.ok,
    statusCode: resp.status,
    status: resp.status,
    body: body_,
    raw,
  };
}

async function login(username, password) {
  const r = await req('POST', '/api/auth/login', null, { username, password });
  assert(r.ok && r.body.success, `${username} login success`, r.body);
  return r.body.data;
}

async function main() {
  hd('Step 0. Health Check + Service Status');
  const health = await req('GET', '/api/health');
  assert(health.ok && health.body.success, 'health.success = true', health.body);
  assert(health.body.message === 'ok', 'health.message = ok', health.body?.message);
  info(`uptime=${health.body.service?.uptime}s`);

  const status = await req('GET', '/api/auth/service-status');
  assert(status.ok && status.body.success, 'service-status success');
  let serverStartedAt = status.body.data.startedAt;
  const serverInstanceId = status.body.data.instanceId;
  assert(!!serverStartedAt, 'startedAt present');
  assert(!!serverInstanceId, 'instanceId present');
  info(`serverStartedAt: ${serverStartedAt}`);
  info(`serverInstanceId: ${serverInstanceId}`);
  info(`permissionStates: ${status.body.data.permissionStates}`);

  hd('Step 1. Login - auditor01 (auditor role)');
  const audLogin = await login('auditor01', '123456');
  let audToken = audLogin.sessionId;
  assert(audLogin.user.role === 'auditor', 'role = auditor');
  assert(audLogin.debug.hasFlowTraceAccess === true, 'hasFlowTraceAccess = true');
  assert(audLogin.debug.permissionDecision === 'allow', 'permissionDecision = allow');
  assert(audLogin.debug.visibleFieldsCount >= 24, `visibleFieldsCount >= 24 (actual=${audLogin.debug.visibleFieldsCount})`);
  info(`sessionId: ${audToken}`);
  info(`visibleFieldsCount: ${audLogin.debug.visibleFieldsCount}`);

  const audPermSnap = await req('GET', '/api/auth/permission-snapshot', audToken);
  assert(audPermSnap.ok, 'auditor permission-snapshot ok');
  assert(audPermSnap.body.data.snapshot.currentDecision === 'allow', 'auditor currentDecision = allow');
  assert(audPermSnap.body.data.snapshot.isRevoked === false, 'auditor isRevoked = false');
  assert(audPermSnap.body.data.snapshot.visibleFields.length >= 24, 'auditor visibleFields >= 24');

  hd('Step 2. Login - warehouse01 (regular user)');
  const whLogin = await login('warehouse01', '123456');
  let whToken = whLogin.sessionId;
  assert(whLogin.user.role === 'warehouse', 'role = warehouse');
  assert(whLogin.debug.hasFlowTraceAccess === true, 'hasFlowTraceAccess = true');
  assert(whLogin.debug.permissionDecision === 'redact', 'permissionDecision = redact');
  assert(whLogin.debug.visibleFieldsCount < 24, `visibleFieldsCount < 24 (actual=${whLogin.debug.visibleFieldsCount})`);
  info(`visibleFieldsCount: ${whLogin.debug.visibleFieldsCount}`);

  const whPermSnap = await req('GET', '/api/auth/permission-snapshot', whToken);
  assert(whPermSnap.body.data.snapshot.currentDecision === 'redact', 'warehouse currentDecision = redact');
  assert(whPermSnap.body.data.snapshot.redactedFields.length > 0, 'warehouse redactedFields > 0');

  hd('Step 3. List page - auditor vs regular user field diff');
  const audList = await req('GET', '/api/flow-trace/list', audToken);
  assert(audList.ok && audList.body.success, 'auditor list 200');
  assert(audList.body.data.permission.decision === 'allow', 'auditor list decision = allow');
  const audSamples = audList.body.data.data;
  assert(audSamples.length >= 3, `samples >= 3 (actual=${audSamples.length})`);
  const sampleId = audSamples[0].id;
  const sampleNo = audSamples[0].sampleNo;
  info(`test sample: ${sampleNo} (id=${sampleId})`);
  const audSample = audSamples[0];
  assert(audSample.lockReason != null, `auditor sees lockReason=${audSample.lockReason}`);
  assert(audSample.failedAttempts != null, `auditor sees failedAttempts=${audSample.failedAttempts}`);
  assert(audSample.rollbackCount != null, `auditor sees rollbackCount=${audSample.rollbackCount}`);

  const whList = await req('GET', '/api/flow-trace/list', whToken);
  assert(whList.body.data.permission.decision === 'redact', 'regular user list decision = redact');
  const whSample = whList.body.data.data.find(s => s.id === sampleId);
  assert(whSample.lockReason == null, 'regular user lockReason redacted (undefined)');
  assert(whSample.failedAttempts === 0, 'regular user failedAttempts zeroed');
  assert(whSample.rollbackCount === 0, 'regular user rollbackCount zeroed');

  hd('Step 4. Detail page - auditor vs regular user field diff');
  const audDetail = await req('GET', `/api/flow-trace/detail/${sampleId}`, audToken);
  assert(audDetail.body.data.permission.decision === 'allow', 'auditor detail decision = allow');
  const audD = audDetail.body.data.data;
  assert(audD.sample.reviewedBy != null, `auditor sees reviewedBy=${audD.sample.reviewedBy}`);
  assert(audD.sample.archivedAt != null, `auditor sees archivedAt=${audD.sample.archivedAt}`);
  assert(audD.sample.lockReason != null, `auditor sees lockReason=${audD.sample.lockReason}`);
  assert(audD.latestValidTransfer != null, 'auditor sees latestValidTransfer');
  assert(audD.businessChain[0].operatorName !== '-', 'auditor sees operatorName');

  const whDetail = await req('GET', `/api/flow-trace/detail/${sampleId}`, whToken);
  assert(whDetail.body.data.permission.decision === 'redact', 'regular user detail decision = redact');
  const whD = whDetail.body.data.data;
  assert(whD.sample.reviewedBy == null, 'regular user reviewedBy undefined');
  assert(whD.sample.archivedAt == null, 'regular user archivedAt undefined');
  assert(whD.sample.lockReason == null, 'regular user lockReason undefined');
  assert(whD.latestValidTransfer == null, 'regular user latestValidTransfer = null');
  assert(Array.isArray(whD.blockedOperations) && whD.blockedOperations.length === 0, 'regular user blockedOperations = []');
  assert(Array.isArray(whD.rollbackHistory) && whD.rollbackHistory.length === 0, 'regular user rollbackHistory = []');

  hd('Step 5. 3 repeated queries, identical result');
  const results = [];
  for (let i = 0; i < 3; i++) {
    const r = await req('GET', `/api/flow-trace/detail/${sampleId}`, audToken);
    results.push(JSON.stringify(r.body.data.data));
    await new Promise(r => setTimeout(r, 50));
  }
  assert(new Set(results).size === 1, '3 detail queries return same content', new Set(results).size);

  hd('Step 6. JSON Export - auditor vs regular user');
  const audExport = await req('POST', `/api/flow-trace/export/${sampleId}`, audToken, { format: 'json' });
  assert(audExport.body.data.permission.decision === 'allow', 'auditor export decision = allow');
  const audExportObj = JSON.parse(audExport.body.data.data);
  assert(audExportObj.sample?.reviewedBy != null, `auditor JSON has reviewedBy=${audExportObj.sample?.reviewedBy}`);
  assert(audExportObj.sample?.lockReason != null, `auditor JSON has lockReason=${audExportObj.sample?.lockReason}`);
  info(`auditor JSON export size: ${(audExport.body.data.data.length / 1024).toFixed(2)} KB`);

  const whExport = await req('POST', `/api/flow-trace/export/${sampleId}`, whToken, { format: 'json' });
  assert(whExport.body.data.permission.decision === 'redact', 'regular user export decision = redact');
  const whExportObj = JSON.parse(whExport.body.data.data);
  assert(whExportObj.sample?.reviewedBy == null, 'regular user JSON reviewedBy undefined');
  assert(Array.isArray(whExportObj.redactedFields) && whExportObj.redactedFields.length > 0, 'regular user export has redactedFields array');
  assert(whExportObj.redactionNotice != null, 'regular user export has redactionNotice');

  hd('Step 7. CSV Export');
  const csvExport = await req('POST', `/api/flow-trace/export/${sampleId}`, audToken, { format: 'csv' });
  assert(csvExport.ok && csvExport.body.success, 'CSV export success');
  assert(csvExport.body.data.filename.endsWith('.csv'), `CSV filename = ${csvExport.body.data.filename}`);
  assert(typeof csvExport.body.data.data === 'string', 'CSV data is string');
  assert(csvExport.body.data.data.includes(','), 'CSV contains comma separator');
  assert(csvExport.body.data.data.includes(sampleNo), `CSV contains sampleNo ${sampleNo}`);
  info(`CSV file: ${csvExport.body.data.filename}`);
  info(`CSV length: ${csvExport.body.data.data.length} chars`);

  hd('Step 8. Revoke permission - admin revokes warehouse01');
  const adminLogin = await login('admin', '123456');
  const adminToken = adminLogin.sessionId;
  const revokeRes = await req('POST', `/api/flow-trace/permission/revoke/${whLogin.user.id}`, adminToken, { reason: 'E2E test revoke' });
  assert(revokeRes.ok && revokeRes.body.success, 'revoke success');
  assert(revokeRes.body.data.message != null, 'revoke message present');

  const whSnapAfter = await req('GET', '/api/auth/permission-snapshot', whToken);
  assert(whSnapAfter.body.data.snapshot.isRevoked === true, 'isRevoked = true after revoke');
  assert(whSnapAfter.body.data.snapshot.currentDecision === 'deny', 'currentDecision = deny after revoke');

  const listR = await req('GET', '/api/flow-trace/list', whToken);
  assert(listR.statusCode === 403, `revoked user list = 403 (actual=${listR.statusCode})`);
  assert(listR.body.success === false, '403 response success = false', listR.body);
  const forbidCode = listR.body.error?.code;
  assert(forbidCode === 'INSUFFICIENT_PERMISSION' || forbidCode === 'FLOW_TRACE_PERMISSION_DENIED',
    `403 error.code is permission-denied related (got ${forbidCode})`);

  hd('Step 9. Simulate server restart - verify revoke persistence');
  info(`original serverStartedAt: ${serverStartedAt}`);
  info('triggering nodemon restart (touch api/app.ts)...');
  const fs = await import('node:fs');
  const appPath = new URL('../api/app.ts', import.meta.url);
  const now = new Date();
  fs.utimesSync(appPath, now, now);
  await new Promise(r => setTimeout(r, 6000));
  let restarted = false;
  for (let i = 0; i < 20; i++) {
    try {
      const s2 = await req('GET', '/api/auth/service-status');
      if (s2.ok && s2.body.data.startedAt !== serverStartedAt) {
        restarted = true;
        serverStartedAt = s2.body.data.startedAt;
        info(`server restarted, new serverStartedAt: ${serverStartedAt}`);
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  assert(restarted, 'server restarted successfully (serverStartedAt changed)');

  info('checking old warehouse token after restart...');
  let afterSnap = await req('GET', '/api/auth/permission-snapshot', whToken);
  if (afterSnap.statusCode === 401) {
    info('restart caused re-auth (401), re-logging in warehouse01...');
    const whLogin2 = await login('warehouse01', '123456');
    whToken = whLogin2.sessionId;
    afterSnap = await req('GET', '/api/auth/permission-snapshot', whToken);
  }
  assert(afterSnap.ok, 'permission-snapshot accessible after restart');
  assert(afterSnap.body.data.snapshot.isRevoked === true, 'after restart, isRevoked = true (persistence OK)');
  assert(afterSnap.body.data.snapshot.currentDecision === 'deny', 'after restart, currentDecision = deny');

  const listR2 = await req('GET', '/api/flow-trace/list', whToken);
  assert(listR2.statusCode === 403, `after restart, revoked user list = 403 (persistence verified) actual=${listR2.statusCode}`);
  ok('REVOKE PERSISTENCE ACROSS RESTART - VERIFIED');

  hd('Step 10. Restore permission');
  const restoreRes = await req('POST', `/api/flow-trace/permission/restore/${whLogin.user.id}`, adminToken);
  assert(restoreRes.ok && restoreRes.body.success, 'restore permission success');
  const whSnap3 = await req('GET', '/api/auth/permission-snapshot', whToken);
  assert(whSnap3.body.data.snapshot.isRevoked === false, 'after restore, isRevoked = false');
  assert(whSnap3.body.data.snapshot.currentDecision === 'redact', 'after restore, currentDecision = redact');
  const whList3 = await req('GET', '/api/flow-trace/list', whToken);
  assert(whList3.body.data.permission.decision === 'redact', 'after restore, list decision = redact');

  hd('Step 11. Audit log persistence');
  const flushRes = await req('POST', '/api/auth/debug/flush-logs', adminToken);
  assert(flushRes.ok && flushRes.body.success, 'flush logs success');
  info(`flushed count: ${flushRes.body.data.flushedCount}`);

  const auditRes = await req('GET', '/api/flow-trace/audit-records', audToken);
  assert(auditRes.ok && auditRes.body.success, 'audit records query success');
  const records = auditRes.body.data.records;
  assert(records.length > 0, `audit records > 0 (actual=${records.length})`);
  const actions = [...new Set(records.map(r => r.action))];
  assert(actions.includes('viewDetail'), 'audit contains viewDetail');
  assert(actions.includes('export'), 'audit contains export');
  assert(actions.includes('login'), 'audit contains login');
  info(`audit actions: ${actions.join(', ')}`);
  info(`audit total count: ${records.length}`);
  const last = records[records.length - 1];
  assert(last.operationId != null, 'audit record has operationId');
  assert(last.permissionDecision != null, 'audit record has permissionDecision');
  assert(last.userId != null, 'audit record has userId');

  hd('Step 12. Unified error response format');
  const noAuthR = await req('GET', '/api/flow-trace/list');
  assert(noAuthR.statusCode === 401, `no token = 401 (actual=${noAuthR.statusCode})`);
  assert(noAuthR.body.success === false, '401 success = false');
  assert(noAuthR.body.error != null, '401 has error field');
  assert(noAuthR.body.error?.code != null, '401 has error.code');
  assert(noAuthR.body.requestId != null, '401 has requestId');
  assert(noAuthR.body.timestamp != null, '401 has timestamp');
  ok('401 response matches ApiResponse contract');

  const nfR = await req('GET', '/api/flow-trace/detail/non-existent-id', audToken);
  assert(nfR.statusCode === 404, `non-existent sample = 404 (actual=${nfR.statusCode})`);
  assert(nfR.body.success === false, '404 success = false');
  assert(nfR.body.error?.code === 'NOT_FOUND', `404 error.code = NOT_FOUND (got ${nfR.body.error?.code})`);
  ok('404 response matches ApiResponse contract');

  hd('Step 13. Logout');
  const logout = await req('POST', '/api/auth/logout', audToken);
  assert(logout.ok && logout.body.success, 'logout success');
  const meAfter = await req('GET', '/api/auth/me', audToken);
  assert(meAfter.statusCode === 401, `after logout = 401 (actual=${meAfter.statusCode})`);
  ok('token invalidated after logout');

  hd('E2E SMOKE TEST - RESULTS');
  console.log(`  ${green('PASSED:')} ${passed}`);
  if (failed > 0) {
    console.log(`  ${red('FAILED:')} ${failed}`);
    console.log('');
    failures.forEach((f, i) => console.log(`  ${red(i + 1 + '.')} ${f}`));
    process.exit(1);
  }
  console.log(`  ${cyan('ALL PASSED')}\n`);
  console.log(cyan(`  Coverage summary:`));
  console.log('');
  console.log('    01. Health check / service status');
  console.log('    02. Login (auditor01/warehouse01/admin)');
  console.log('    03. permission-snapshot debug endpoint');
  console.log('    04. List field diff (auditor vs regular)');
  console.log('    05. Detail field diff (reviewedBy/archivedAt/lockReason/latestValidTransfer)');
  console.log('    06. 3x repeat query consistency');
  console.log('    07. JSON export (full vs redacted + redactedFields + redactionNotice)');
  console.log('    08. CSV export (filename / comma / sampleNo)');
  console.log('    09. Permission revoke -> 403 with error contract');
  console.log('    10. nodemon restart -> revoke state persists');
  console.log('    11. Permission restore -> decision back to redact');
  console.log('    12. Audit records flushed (viewDetail/export/login)');
  console.log('    13. 401 / 404 unified error format');
  console.log('    14. Logout -> token invalidated');
  console.log('');
  console.log(gray('  Integration tests:  npx vitest run api/tests/flow-trace-integration.test.ts'));
  console.log(gray('  E2E smoke script:   node scripts/e2e-smoke-test.mjs'));
}

main().catch(e => {
  console.error(red('\nUnhandled error:'), e);
  process.exit(2);
});

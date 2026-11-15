import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, getScheduledPipelineDecision } from '../src/store.js';
import { fetchPaginatedAtsJobs } from '../src/ats-pagination.js';
import { createAsyncLimit } from '../src/async-limit.js';

const plan = { limits: { jobBoards: -1 } };
const options = { plan, autoDiscover: false };

async function workspace(id) {
  const store = createStore(); store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  const account = await store.addAccount(id, { displayName: 'Example' });
  const config = store.addConfig(id, { accountId: account.id, companyName: 'Example', atsType: 'custom_static', boardId: 'old-company-slug', apiUrl: 'https://example.test/careers', resolvedBoardUrl: 'https://example.test/careers', active: true, reviewStatus: 'approved', discoveryStatus: 'resolved' });
  return { store, config };
}

test('transient missing pages recover within one deadline and still verify the head', async () => {
  let failed = false; const requests=[];
  const result=await fetchPaginatedAtsJobs({ providerName:'Fixture', pageSize:2,maxPages:10,concurrency:2,timeBudgetMs:10000,
    recoverFailedPages:true,recheckFirstPage:true,jobKey:j=>j.id,readPage:async offset=>{
      requests.push(offset);
      if(offset===2&&!failed){failed=true;throw Object.assign(new Error('HTTP 503'),{retryable:true});}
      return {total:6,jobs:[{id:String(offset)},{id:String(offset+1)}]};
    }});
  assert.equal(result.complete,true); assert.equal(result.jobs.length,6);
  assert.equal(result.pagination.recoveredPages,1); assert.equal(result.pagination.verificationRequests,1);
  assert.deepEqual(requests,[0,2,4,2,0]);
});

test('page recovery never shortens a provider cooldown', async () => {
  const requests=[];
  const result=await fetchPaginatedAtsJobs({providerName:'Fixture',pageSize:2,maxPages:10,concurrency:2,timeBudgetMs:10000,
    recoverFailedPages:true,jobKey:j=>j.id,readPage:async offset=>{requests.push(offset);if(offset===2)throw Object.assign(new Error('HTTP 429'),{retryable:true,retryAfterMs:120000});return {total:6,jobs:[{id:String(offset)},{id:String(offset+1)}]};}});
  assert.equal(result.complete,false); assert.equal(result.pagination.pageRetries,0);
  assert.equal(result.pagination.retryAfterMs,120000); assert.deepEqual(requests,[0,2,4]);
});

test('provider limiter releases capacity after failures without exceeding its cap', async () => {
  const limit=createAsyncLimit(2);let active=0,maximum=0;
  const results=await Promise.allSettled(Array.from({length:7},(_,index)=>limit(async()=>{
    active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;if(index===1)throw new Error('fixture');return index;
  })));
  assert.equal(maximum,2);assert.equal(results.filter(r=>r.status==='fulfilled').length,6);
});

test('static careers handoff derives the linked board ID and preserves existing role workflow', async t => {
  const id='source-handoff'; const {store,config}=await workspace(id);let linked=false;
  const roleUrl='https://job-boards.greenhouse.io/mhi/jobs/12345';
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('example.test'))return new Response(linked?'<a href="https://job-boards.greenhouse.io/mhi">Open roles</a>':`<a href="${roleUrl}">Software Engineer</a><iframe src="https://job-boards.greenhouse.io/other"></iframe>`);
    assert.equal(String(url),'https://boards-api.greenhouse.io/v1/boards/mhi/jobs?content=true');
    return Response.json({jobs:[{id:12345,title:'Software Engineer',absolute_url:roleUrl,location:{name:'Toronto, ON'}}]});
  });
  // Multiple boards cannot be selected automatically. Preserve the initial
  // static role when the employer later identifies its one canonical board.
  await store.importLiveJobs(id,options);
  assert.equal((await store.getConfig(id,config.id)).atsType,'custom_static');
  const original=(await store.findJobs(id,{pageSize:10})).items[0];
  await store.patchJobPipeline(id,original.id,'saved');
  linked=true;
  const upgraded=await store.importLiveJobs(id,options);
  assert.equal(upgraded.stats.newJobs,0);assert.equal(upgraded.stats.closedJobs,0);
  const saved=await store.getConfig(id,config.id);
  assert.equal(saved.atsType,'greenhouse');assert.equal(saved.boardId,'mhi');assert.equal(saved.apiUrl,'');
  const jobs=await store.findJobs(id,{pageSize:10});assert.equal(jobs.total,1);assert.equal(jobs.items[0].id,original.id);assert.equal(jobs.items[0].pipelineStage,'saved');
});

test('a static first page with more results cannot close unseen saved roles', async t=>{
  const id='static-pagination';const {store}=await workspace(id);let second=false;
  t.mock.method(globalThis,'fetch',async()=>new Response(second?'<a href="/jobs/12345">Engineer</a><a rel="next" href="?page=2">Next</a>':'<a href="/jobs/12345">Engineer</a><a href="/jobs/67890">Recruiter</a>'));
  await store.importLiveJobs(id,options);second=true;
  const result=await store.importLiveJobs(id,options);
  assert.equal(result.stats.partialBoards,1);assert.equal(result.stats.closedJobs,0);
  assert.equal((await store.findJobs(id,{active:true})).total,2);
});

test('a recently successful workspace retries a newer failed run after backoff',()=>{
  const nowMs=Date.parse('2026-11-15T01:00:00Z');
  const settings={setupComplete:true,lastPipelineRun:'2026-11-15T00:00:00Z',lastPipelineStatus:'failed',lastPipelineAttemptAt:'2026-11-15T00:30:00Z'};
  assert.equal(getScheduledPipelineDecision({settings,nowMs}).reason,'recent_attempt');
  assert.equal(getScheduledPipelineDecision({settings,nowMs:nowMs+3600000}).due,true);
});

test('manual background refreshes update the same status and retry schedule as automatic ones',async t=>{
  const id='manual-source-schedule';const {store}=await workspace(id);
  store.completeSetup(id,{workspaceName:id,userName:'Owner',userEmail:'owner@example.test'},{runPipeline:false});
  t.mock.method(globalThis,'fetch',async()=>new Response('<h1>Careers</h1>'));
  const wait=async jobId=>{
    for(let attempt=0;attempt<100;attempt++){
      const job=await store.getBackgroundJob(id,jobId);
      if(job.finishedAt){await new Promise(resolve=>setImmediate(resolve));return job;}
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw new Error('Fixture import did not finish');
  };
  const accepted=await store.startLiveJobImport(id,options);const job=await wait(accepted.jobId);
  assert.equal(job.completionState,'completed_with_gaps');
  const runtime=await store.getRuntimeStatus(id);
  assert.equal(runtime.refreshSchedule.lastStatus,'completed_with_gaps');
  assert.equal(runtime.refreshSchedule.lastAttemptAt,job.startedAt);
  assert.equal(runtime.refreshSchedule.sourceRetries.count,1);
  assert.ok(Date.parse(runtime.refreshSchedule.nextEligibleAt)<Date.parse(job.finishedAt)+2*3600000);
  t.mock.method(store,'importLiveJobs',async()=>{throw new Error('Fixture save unavailable');});
  const failed=await wait((await store.startLiveJobImport(id,options)).jobId);
  assert.equal(failed.status,'failed');assert.equal((await store.getRuntimeStatus(id)).refreshSchedule.lastStatus,'failed');
});

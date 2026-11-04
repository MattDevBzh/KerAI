/** Reproducible synthetic Mac/Linux/Windows core-startup benchmark, not a VS Code UI measurement.
 * node scripts/benchmark-startup.mjs /absolute/baseline/checkout output.json
 * Five fresh Node processes and ten repeated loads in one process, identical fixture and dependencies.
 */
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const baseline = process.argv[2];
if (!baseline) throw new Error('Pass the baseline checkout path.');
const directory = await mkdtemp(path.join(tmpdir(), 'kerai-benchmark-'));
const output = process.argv[3] ?? 'startup-benchmark.json';
try {
  const files = [];
  for (const [name, root] of [
    ['before', path.resolve(baseline)],
    ['after', process.cwd()],
  ]) {
    const code = `
      import { StudioService } from ${JSON.stringify(path.join(root, 'src/host/StudioService.ts'))};
      import { Store } from ${JSON.stringify(path.join(root, 'src/core/store.ts'))};
      import { DeliveryService } from ${JSON.stringify(path.join(root, 'src/host/DeliveryService.ts'))};
      import { WorkflowEngine } from ${JSON.stringify(path.join(root, 'src/core/workflow.ts'))};
      import { mkdir, writeFile } from 'node:fs/promises';
      import { execFileSync } from 'node:child_process';
      import { join } from 'node:path';
      const defaults = ${JSON.stringify(path.join(root, 'defaults'))};
      export async function setup(base) {
        for (let p=0;p<2;p++) {
          const repo = join(base, 'repo'+p); await mkdir(repo, {recursive:true});
          const git = (...args) => execFileSync('git', ['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args], {cwd:repo,stdio:'pipe'});
          git('init','-b','main'); git('config','user.name','Benchmark'); git('config','user.email','benchmark@example.invalid');
          for (let i=0;i<2000;i++) await writeFile(join(repo,'file'+i+'.txt'),'base content\\n');
          git('add','.'); git('commit','-m','fixture');
          for (let i=0;i<300;i++) await writeFile(join(repo,'file'+i+'.txt'),'changed content\\n');
          for (let i=2000;i<3500;i++) await writeFile(join(repo,'file'+i+'.txt'),'untracked\\n');
          const service = new StudioService(repo, defaults, new Store(join(base,'state'+p)),()=>true);
          await service.initialize();
          const engine = new WorkflowEngine();
          const workflow = service.state.workflows.find(w=>w.id==='single');
          for (let i=0;i<100;i++) {
            const f=engine.createFeature(workflow,{title:'Session '+i,description:'Historic session',branch:'main'});
            const a=engine.beginRun(f.id,f.steps[0].id);
            a.artifact={name:'report.md',content:'Synthetic historical report. '.repeat(1000),updatedAt:new Date().toISOString()};
            a.status='interrupted'; f.steps[0].status='interrupted';
          }
          await service.dispose();
          await new Store(join(base,'state'+p)).save(engine.features,service.state.settings,[]);
        }
      }
      export async function run(base,count) {
        const rows=[];
        for(let i=0;i<count;i++) {
          globalThis.__gitCount=0;
          const start=performance.now(), services=[];
          const load=async p=>{
            const repo=join(base,'repo'+p), service=new StudioService(repo,defaults,new Store(join(base,'state'+p)),()=>true);
            services.push(service); await service.initialize();
            const delivery=new DeliveryService(repo);
            ${name === 'before' ? 'await delivery.inspect();' : 'await delivery.remoteUrl();'}
          };
          await load(0);
          let activeMs=performance.now()-start, activeGit=globalThis.__gitCount;
          await load(1);
          if(${name === 'before'}) { activeMs=performance.now()-start; activeGit=globalThis.__gitCount; }
          rows.push({ activeMs:Math.round(activeMs), allMs:Math.round(performance.now()-start),activeGit,allGit:globalThis.__gitCount });
          for(const service of services) await service.dispose();
        }
        return rows;
      }
    `;
    const file = path.join(directory, name + '.cjs');
    files.push(file);
    await build({
      stdin: { contents: code, resolveDir: process.cwd(), loader: 'ts' },
      outfile: file,
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'cjs',
      banner: {
        js: `const cp=require('node:child_process'); const originalSpawn=cp.spawn; cp.spawn=function(command,...args){if(command==='git')globalThis.__gitCount=(globalThis.__gitCount||0)+1;return originalSpawn.call(this,command,...args);};`,
      },
    });
  }
  const env = {
    ...process.env,
    NODE_PATH: path.join(process.cwd(), 'node_modules'),
    COPILOT_HOME: path.join(directory, 'personal'),
  };
  const call = (file, expression) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `const b=require(${JSON.stringify(file)}); (async()=>{const result=await ${expression};process.stdout.write(JSON.stringify(result??null))})().catch(e=>{console.error(e);process.exit(1)})`,
        ],
        { env, maxBuffer: 10_000_000 },
      ).toString(),
    );
  await mkdir(path.join(directory, 'personal'));
  call(files[1], `b.setup(${JSON.stringify(directory)})`);
  const result = {
    platform: process.platform,
    node: process.version,
    measuredAt: new Date().toISOString(),
    fixture: {
      projects: 2,
      trackedFilesPerProject: 2000,
      changedFilesPerProject: 300,
      untrackedFilesPerProject: 1500,
      sessionsPerProject: 100,
    },
    limitation:
      'Synthetic core initialization; no OS cache reset, VS Code rendering, real user projects, or Copilot connection.',
    before: {},
    after: {},
  };
  for (let index = 0; index < 2; index++) {
    const fresh = [];
    for (let i = 0; i < 5; i++)
      fresh.push(...call(files[index], `b.run(${JSON.stringify(directory)},1)`));
    result[index ? 'after' : 'before'] = {
      freshProcesses: fresh,
      repeated: call(files[index], `b.run(${JSON.stringify(directory)},10)`),
    };
  }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(output);
} finally {
  await rm(directory, { recursive: true, force: true });
}

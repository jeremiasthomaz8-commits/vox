import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/api.test.mjs','tests/photos.test.mjs','tests/postgres.test.mjs'],{env:{...process.env,TEST_DATABASE:'postgres'},stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;

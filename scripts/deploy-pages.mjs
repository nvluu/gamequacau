import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const git=(args,cwd=root)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const sourceCommit=git(['rev-parse','HEAD']);
if(git(['status','--porcelain']))throw new Error('Commit source changes before deployment.');
execFileSync('npm',['run','build'],{cwd:root,stdio:'inherit'});
const origin=git(['remote','get-url','origin']);
const directory=mkdtempSync(join(tmpdir(),'gamequacau-deploy-'));
try {
  git(['clone','--quiet','--depth','1','--branch','gh-pages',origin,directory]);
  const previous=JSON.parse(readFileSync(join(directory,'version.json'),'utf8'));
  if(!previous.source_commit)throw new Error('Deployment branch lacks our build metadata.');
  const files=git(['ls-files','-z'],directory).split('\0').filter(Boolean);
  if(files.some(f=>!(f.startsWith('assets/')||['index.html','favicon.svg','version.json','.nojekyll'].includes(f))))throw new Error('Deployment branch contains unexpected files; preserving them.');
  git(['rm','-r','--quiet','.'],directory);
  cpSync(join(root,'dist'),directory,{recursive:true});
  writeFileSync(join(directory,'.nojekyll'),'');
  const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  writeFileSync(join(directory,'version.json'),JSON.stringify({source_commit:sourceCommit,version})+'\n');
  git(['add','.'],directory);
  if(!git(['status','--porcelain'],directory)){console.log('Build already published.');}
  else {git(['commit','-m',`Deploy game ${version} (${sourceCommit.slice(0,7)})`],directory);execFileSync('git',['push','origin','gh-pages'],{cwd:directory,stdio:'inherit'});}
} finally {rmSync(directory,{recursive:true,force:true});}

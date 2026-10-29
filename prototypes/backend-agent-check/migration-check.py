#!/usr/bin/env python3
"""Main de usuario + canje real + importador/broker root en la VM propia; sin PCs físicos."""
import argparse,hashlib,importlib.util,io,json,os,secrets,shlex,subprocess,tarfile,time,uuid
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[2]
CASES=['create-lost','prepare-lost','counter-invalid','unsupported-policy','cancel-api-down','remove-lost','commit-lost','active-lock','four-to-lock','account-switch','password-change','account-logout','health-failed','commit-account-switch','commit-account-switch-lost']
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def main():
    parser=argparse.ArgumentParser();parser.add_argument('lab',type=Path);parser.add_argument('vm',type=Path);parser.add_argument('--api-base',required=True);args=parser.parse_args()
    uri=urlsplit(args.api_base);assert uri.scheme=='http' and uri.hostname=='127.0.0.1' and uri.port and uri.path in ('','/') and not(uri.username or uri.password or uri.query or uri.fragment)
    vm=load('migration_vm',args.vm/'vm-control.py');assert vm.SSH[-1]=='absorlab@127.0.0.1' and vm.SSH[vm.SSH.index('-p')+1]=='22223'
    native=load('migration_api',Path(__file__).with_name('native-renewal.py'));native.BASE=args.api_base;request=native.request
    output=args.lab/('migration-check-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
    def root(code,data=None,timeout=30):
        result=subprocess.run(vm.SSH+['sudo -n /usr/bin/python3 -I -B -c '+shlex.quote(code)],input=data,capture_output=True,timeout=timeout)
        if result.returncode:
            f=output/'root-stderr.txt';f.write_bytes(result.stderr);f.chmod(0o600);raise RuntimeError('owned_root_fixture_failed')
        return result.stdout
    accounts=[];tunnel=None;created=False;marked=False;results=[];report=None;value=None
    try:
        tunnel=subprocess.Popen(vm.SSH[:-1]+['-N','-o','ExitOnForwardFailure=yes','-R','127.0.0.1:28022:127.0.0.1:'+str(uri.port),vm.SSH[-1]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(.5);assert tunnel.poll() is None
        names=['absor-secure-broker-lab','absor-secret-provision-lab','absor-ipc-worker-lab','absor-agent-status-lab','absor-agent-control-lab']
        files={n:vm.remote('cat /home/absorlab/AbsorConnectLab/api-workers/agent/target/release/'+n) for n in names}
        units=['absorconnect-secure-lab.socket','absorconnect-secure-lab.service','absorconnect-ipc-worker-lab.service','absorconnect-ui-status-lab.socket','absorconnect-ui-control-lab.socket']
        files.update({n:(ROOT/'agent/linux-secure-lab'/n).read_bytes() for n in units})
        manifest={n:hashlib.sha256(raw).hexdigest() for n,raw in files.items()}
        contents={'artifacts/'+n:b for n,b in files.items()}
        contents.update({'migration-vm.py':(ROOT/'agent/linux-secure-lab/migration-vm.py').read_bytes(),'install-vm.py':(ROOT/'agent/linux-secure-lab/install-vm.py').read_bytes(),'manifest.json':json.dumps(manifest).encode()})
        payload=io.BytesIO()
        with tarfile.open(fileobj=payload,mode='w') as tar:
            for name,raw in contents.items():
                info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o444;info.uid=0;info.gid=0;tar.addfile(info,io.BytesIO(raw))
        root("from pathlib import Path;import tarfile,io,sys;home=Path('/opt/absorconnect-migration-lab');state=Path('/var/lib/absorconnect-migration-lab');assert not home.exists() and not state.exists();home.mkdir(mode=0o755);state.mkdir(mode=0o755);tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:').extractall(home)",payload.getvalue());created=True
        marked=json.loads(root("from pathlib import Path;import os,json;p=Path('/run/absorconnect-owned-vm-lab');created=not p.exists()\nif created:\n fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o444);os.write(fd,b'absorconnect-native-window-fixture-v1\\n');os.close(fd)\nelse:assert not p.is_symlink() and p.read_bytes()==b'absorconnect-native-window-fixture-v1\\n'\nprint(json.dumps(created))"))
        metadata=json.loads((args.lab/'node-linux-ui-20261028/runtime.json').read_text());node='/home/absorlab/AbsorConnectLab/ui-node-'+metadata['version']+'/bin/node'
        assert vm.remote(node+' --version').decode().strip()==metadata['version']
        bundle=output/'migration-runtime.cjs';subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),str(Path(__file__).with_name('migration-matrix-runtime.ts')),'--bundle','--platform=node','--format=cjs','--target=node22','--outfile='+str(bundle)],capture_output=True,check=True,timeout=30);bundle.chmod(0o600)
        remote='/home/absorlab/AbsorConnectLab/migration-matrix-runtime.cjs';vm.remote('test ! -e '+remote+' && cat > '+remote,bundle.read_bytes())
        # Cinco cuentas, máximo tres casos por cuenta: conservar los límites reales de 20/minuto.
        for index,scenario in enumerate(CASES):
            if index%3==0:
                password=secrets.token_urlsafe(32);status,account=request('POST','/api/auth/register',{'email':'migration-'+uuid.uuid4().hex+'@example.invalid','password':password,'deviceName':'Matriz efímera de traspaso'});assert status==201;accounts.append((account['token'],password))
            owner=accounts[-1][0];device=str(uuid.uuid4());key=secrets.token_urlsafe(32)
            info={'name':'Equipo de laboratorio de traspaso','platform':'linux','appVersion':'0.1.0','remote':{'state':'available','features':{'clipboard':False,'files':False,'audio':False}}}
            assert request('PUT','/api/devices/'+device,info,owner,key)[0]==200
            data={'scenario':scenario,'accountToken':owner,'deviceId':device,'deviceKey':key,'origin':'http://127.0.0.1:28022'}
            run=subprocess.run(vm.SSH+['ABSOR_CONNECT_API_URL=http://127.0.0.1:28022 '+node+' '+remote],input=json.dumps(data).encode(),capture_output=True,timeout=100)
            f=output/(scenario+'-stderr.txt');f.write_bytes(run.stderr);f.chmod(0o600)
            if run.returncode:
                state=root("import subprocess,json;from pathlib import Path;value={}\nfor unit in ['absorconnect-secure-lab.service','absorconnect-ipc-worker-lab.service']:\n r=subprocess.run(['systemctl','show',unit,'-p','ActiveState','-p','SubState','-p','ExecMainStatus'],capture_output=True,timeout=3);value[unit]=r.stdout.decode().splitlines()\np=Path('/var/lib/absorconnect-secure-lab/attempts.json')\nif p.exists():\n v=json.loads(p.read_text());value['failureCount']=len(v['failures']);value['hasLock']=v['locked_until'] is not None\nprint(json.dumps(value))")
                p=output/(scenario+'-native-state.json');p.write_bytes(state);p.chmod(0o600)
            assert run.returncode==0,'migration_case_failed_'+scenario
            result=json.loads(run.stdout);assert result['passed'] and result['sourceUnchanged'] and result['legacyCalls']==0
            if scenario in ('active-lock','four-to-lock'):assert result['nativeLockTested'] and result['lockSurvivedBrokerRestart']
            results.append(result)
            print(json.dumps({'passed':scenario}),flush=True)
        value={'schema':1,'ok':True,'cases':results,'productionTested':False,'physicalMachinesTested':False,'readyForUnattended':False,
          'artifactSha256':manifest,'runtimeSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'accountsRemoved':False,'servicesAndSecretsRemoved':False}
        report=output/'report.json';report.write_text(json.dumps(value,indent=2)+'\n');report.chmod(0o600)
    finally:
        if created:
            root("from pathlib import Path;import json,subprocess,shutil;home=Path('/opt/absorconnect-migration-lab');state=Path('/var/lib/absorconnect-migration-lab');p=state/'receipt.json'\nif p.exists():\n v=json.loads(p.read_text());raw=json.dumps({'transactionId':v['transactionId'],'deviceId':v['deviceId']}).encode();r=subprocess.run(['/usr/bin/python3','-I','-B',str(home/'migration-vm.py'),'remove'],input=raw,capture_output=True,timeout=30);assert r.returncode==0\nassert not any(Path(p).exists() for p in ['/opt/absorconnect-secure-lab','/etc/absorconnect-secure-lab','/var/lib/absorconnect-secure-lab']);shutil.rmtree(home);shutil.rmtree(state)",timeout=40)
        vm.remote('rm -f /home/absorlab/AbsorConnectLab/migration-matrix-runtime.cjs')
        if marked:root("from pathlib import Path;p=Path('/run/absorconnect-owned-vm-lab');assert p.read_bytes()==b'absorconnect-native-window-fixture-v1\\n';p.unlink()")
        errors=0
        for owner,password in accounts:
            try:assert request('DELETE','/api/me',{'password':password},owner)[0]==204
            except Exception:errors+=1
        if tunnel:tunnel.terminate();tunnel.wait(timeout=8)
        assert errors==0,'temporary_account_cleanup_failed'
        if report:
            value.update(accountsRemoved=True,servicesAndSecretsRemoved=True);report.write_text(json.dumps(value,indent=2)+'\n');report.chmod(0o600)
    print('Informe local: '+str(report))
if __name__=='__main__':main()

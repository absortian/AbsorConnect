"""Consulta local sin privilegios; no tiene autoridad de captura o configuración."""
import json,shlex,subprocess
SOCKET='/run/absorconnect-ui-lab/status.sock'
CLIENT='/opt/absorconnect-secure-lab/absor-agent-status-lab'
FIELDS={'v','nonce','owner','deviceId','agentVersion','instance','bootId','pid','publishedAtBoottimeMillis','state','readyForUnattended'}
def run(vm,root,worker,check,output,device,secrets_):
    def query():
        raw=vm.remote(CLIENT+' status --json')
        value=json.loads(raw)
        assert set(value)==FIELDS and value['v']==1 and value['owner']=='agent'
        assert value['deviceId']==device and value['readyForUnattended'] is False
        assert value['state']=='active'
        assert all(s.encode() not in raw for s in secrets_)
        return value
    first=query();pid=first['pid'];instance=first['instance'];nonces={first['nonce']}
    before=worker({'op':'status'});assert before['state']=='authenticated'
    for _ in range(10):
        value=query();assert value['pid']==pid and value['instance']==instance and value['nonce'] not in nonces;nonces.add(value['nonce'])
    after=worker({'op':'status'});assert after['state']=='authenticated' and after['operation_count']==before['operation_count']
    check('read-only-ui-reconnects-never-detach-or-mutate-authenticated-worker',freshNonces=len(nonces),noCredentialsInReply=True)
    probe=r'''import json,socket,struct,time
mode=MODE
s=socket.socket(socket.AF_UNIX);s.settimeout(1)
start=time.monotonic();connected=False;closed=False;denied=False
try:
 s.connect('/run/absorconnect-ui-lab/status.sock');connected=True
 if mode=='partial':raw=b'\x00\x00'
 elif mode=='oversize':raw=struct.pack('!I',513)
 else:
  value={'v':1,'nonce':'01'*16,'operation':'authenticate' if mode=='mutation' else 'status'}
  if mode=='secret-field':value['token']='untrusted'
  payload=json.dumps(value).encode();raw=struct.pack('!I',len(payload))+payload
 s.sendall(raw)
 try:closed=s.recv(1024)==b''
 except (ConnectionResetError,BrokenPipeError):closed=True
except PermissionError:denied=True
finally:s.close()
print(json.dumps({'connected':connected,'closed':closed,'filesystemDenied':denied,'elapsedMilliseconds':round((time.monotonic()-start)*1000)}))
'''
    for mode in ['mutation','secret-field','oversize','partial']:
        result=json.loads(vm.remote('/usr/bin/python3 -I -c '+shlex.quote(probe.replace('MODE',repr(mode)))))
        assert result['connected'] and result['closed'] and result['elapsedMilliseconds']<1000
        after=worker({'op':'status'});assert after['state']=='authenticated' and after['operation_count']==before['operation_count']
    check('ui-mutation-extra-field-oversize-and-partial-frame-denied-without-worker-effect')
    source=probe.replace('MODE',repr('foreign'))
    result=json.loads(root("import subprocess,json;r=subprocess.run(['setpriv','--no-new-privs','--reuid=65534','--regid=1000','--clear-groups','/usr/bin/python3','-I','-c',"+repr(source)+"],capture_output=True,timeout=3);assert r.returncode==0;print(r.stdout.decode())"))
    assert result['connected'] and result['closed']
    check('ui-peer-uid-denied-even-with-authorized-group',kernelIdentityTested=True)
    invalid=subprocess.run(vm.SSH+[CLIENT+' shell'],capture_output=True,timeout=3)
    assert invalid.returncode==78 and not invalid.stdout
    after=worker({'op':'status'});assert after['state']=='authenticated' and after['operation_count']==before['operation_count']
    check('ui-client-has-no-arbitrary-command-or-path-mode')
    snapshot={'schema':1,'readOnlyQueries':11,'freshNonces':len(nonces),'sameBroker':True,'workerRemainedAuthenticated':True,'workerOperationCountUnchanged':True,'credentialsInReply':False,'captureTested':False,'inputTested':False,'readyForUnattended':False}
    p=output/'ui-status-results.json';p.write_text(json.dumps(snapshot,indent=2)+'\n');p.chmod(0o600)

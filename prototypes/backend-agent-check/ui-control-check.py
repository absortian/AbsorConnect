"""Denegaciones del canal local de parada; ningún caso válido corta al trabajador."""
import json,shlex,subprocess

def run(vm,root,worker,check,output,device):
    probe=r'''import json,socket,struct,time
mode=MODE
s=socket.socket(socket.AF_UNIX);s.settimeout(1)
start=time.monotonic();connected=False;closed=False
try:
 s.connect('/run/absorconnect-ui-control-lab/control.sock');connected=True
 if mode=='partial':raw=b'\x00\x00'
 elif mode=='oversize':raw=struct.pack('!I',513)
 else:
  value={'v':1,'nonce':'01'*16,'deviceId':DEVICE,'operation':'stop'}
  if mode=='wrong-device':value['deviceId']='00000000-0000-4000-8000-000000000001'
  elif mode=='operation':value['operation']='restart'
  elif mode=='extra-field':value['path']='/tmp'
  elif mode=='bad-nonce':value['nonce']='x'
  elif mode=='foreign':pass
  else:raise RuntimeError('invalid_mode')
  payload=json.dumps(value).encode();raw=struct.pack('!I',len(payload))+payload
 s.sendall(raw)
 try:closed=s.recv(1024)==b''
 except (ConnectionResetError,BrokenPipeError):closed=True
finally:s.close()
print(json.dumps({'connected':connected,'closed':closed,'elapsedMilliseconds':round((time.monotonic()-start)*1000)}))
'''.replace('DEVICE',repr(device))
    before=worker({'op':'status'});assert before['state']=='authenticated'
    for mode in ['partial','oversize','wrong-device','operation','extra-field','bad-nonce']:
        result=json.loads(vm.remote('/usr/bin/python3 -I -c '+shlex.quote(probe.replace('MODE',repr(mode)))))
        assert result['connected'] and result['closed'] and result['elapsedMilliseconds']<1000
        after=worker({'op':'status'});assert after['state']=='authenticated' and after['operation_count']==before['operation_count']
    check('local-stop-malformed-frames-wrong-device-and-unannounced-operations-denied')
    source=probe.replace('MODE',repr('foreign'))
    result=json.loads(root("import subprocess,json;r=subprocess.run(['setpriv','--no-new-privs','--reuid=65534','--regid=1000','--clear-groups','/usr/bin/python3','-I','-c',"+repr(source)+"],capture_output=True,timeout=3);assert r.returncode==0;print(r.stdout.decode())"))
    assert result['connected'] and result['closed']
    check('local-stop-kernel-uid-denial-even-with-authorized-group')
    invalid=subprocess.run(vm.SSH+['/opt/absorconnect-secure-lab/absor-agent-control-lab stop --device-id '+device+' --json shell'],capture_output=True,timeout=3)
    assert invalid.returncode==78 and not invalid.stdout
    assert worker({'op':'status'})['state']=='authenticated'
    check('local-stop-client-has-no-shell-or-arbitrary-argument-mode')
    clean=json.loads(root("import json;from pathlib import Path;print(json.dumps({'noStopMarker':not Path('/var/lib/absorconnect-secure-lab/terminal').exists()}))"))
    assert clean['noStopMarker']
    check('denied-local-stop-requests-leave-session-and-persistent-state-unchanged')
    p=output/'ui-control-results.json';p.write_text(json.dumps({'schema':1,'denialInputs':8,'workerRemainedAuthenticated':True,'noStopMarker':True,'shellExposed':False,'readyForUnattended':False},indent=2)+'\n');p.chmod(0o600)

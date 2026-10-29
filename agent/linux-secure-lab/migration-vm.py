#!/usr/bin/env python3
"""Proveedor de traspaso SOLO para la VM propia. Rutas/artefactos fijados por root.

El instalador de la prueba copia este directorio protegido y sus artefactos antes
de ejecutar Main como usuario. No es un instalador distribuible ni permite rutas
o comandos elegidos por IPC. El recibo público no contiene material de alta.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
import uuid

HOME = Path('/opt/absorconnect-migration-lab')
RECEIPTS = Path('/var/lib/absorconnect-migration-lab')
RECEIPT = RECEIPTS/'receipt.json'
OPT = Path('/opt/absorconnect-secure-lab')
CONFIG = Path('/etc/absorconnect-secure-lab')
STATE = Path('/var/lib/absorconnect-secure-lab')
FIELDS = {'v','transactionId','deviceId','phase','canActivate','optionsImported','lockoutImported'}
PHASES = {'provisioning','prepared','committing','committed','intervention_required','removed'}


def protected(path, directory=False, public=False):
    meta=path.lstat()
    assert meta.st_uid==0 and meta.st_gid==0
    assert stat.S_ISDIR(meta.st_mode) if directory else stat.S_ISREG(meta.st_mode) and meta.st_nlink==1
    assert stat.S_IMODE(meta.st_mode)==(0o755 if directory else 0o444 if public else 0o600)
    return meta


def read(path, limit=4096, public=False):
    before=protected(path,public=public)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        after=os.fstat(f.fileno())
        assert (before.st_dev,before.st_ino)==(after.st_dev,after.st_ino)
        raw=f.read(limit+1)
    assert len(raw)<=limit
    return raw


def persist(value):
    data=json.dumps(value,separators=(',',':')).encode()
    temp=RECEIPTS/('receipt-'+uuid.uuid4().hex+'.next')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
    with os.fdopen(fd,'wb') as f:
        f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(temp,RECEIPT)
    fd=os.open(RECEIPTS,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def exact_id(value):
    return isinstance(value,str) and str(uuid.UUID(value,version=4))==value


def receipt():
    value=json.loads(read(RECEIPT,public=True))
    assert set(value)==FIELDS and value['v']==1 and value['phase'] in PHASES
    assert exact_id(value['deviceId']) and exact_id(value['transactionId'])
    assert all(type(value[k]) is bool for k in ['canActivate','optionsImported','lockoutImported'])
    return value


def installer():
    protected(HOME/'install-vm.py',public=True)
    spec=importlib.util.spec_from_file_location('owned_migration_install',str(HOME/'install-vm.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.STAGE=HOME/'artifacts'
    module.ARTIFACT_UID=0
    return module


def configure(module, mode):
    # main() solo acepta estos nombres fijos; no recibe argumentos de renderer.
    previous=sys.argv
    try:
        sys.argv=[str(HOME/'install-vm.py'),mode]
        module.main()
    finally:sys.argv=previous


def verified_installation(manifest):
    assert read(OPT/'owned-installation')==b'absorconnect-owned-security-install-v1\n'
    for name,digest in manifest.items():
        path=Path('/etc/systemd/system')/name if name.endswith(('.service','.socket')) else OPT/name
        meta=path.lstat()
        assert stat.S_ISREG(meta.st_mode) and meta.st_uid==0 and meta.st_gid==0 and meta.st_nlink==1
        assert not (stat.S_IMODE(meta.st_mode)&0o022)
        assert hashlib.sha256(path.read_bytes()).hexdigest()==digest
    assert read(CONFIG/'owned-installation')==b'absorconnect-encrypted-host-lab-v1\n'


def run():
    assert len(sys.argv)==2 and sys.argv[1] in ('inspect','prepare','commit','remove')
    mode=sys.argv[1]
    protected(HOME,True);protected(RECEIPTS,True)
    if mode=='inspect':
        if not RECEIPT.exists() and not RECEIPT.is_symlink():
            assert not any(p.exists() or p.is_symlink() for p in [OPT,CONFIG,STATE])
            print('{"v":1,"absent":true}');return
        print(json.dumps(receipt(),separators=(',',':')));return
    assert os.getuid()==0
    os.umask(0o022)
    marker=Path('/run/absorconnect-owned-vm-lab')
    assert read(marker,public=True)==b'absorconnect-native-window-fixture-v1\n'
    lock=os.open(RECEIPTS/'lock',os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    protected(RECEIPTS/'lock')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    # Nunca se escribe este buffer en un archivo o en un mensaje de error.
    raw=sys.stdin.buffer.read(4097);assert len(raw)<=4096
    data=json.loads(raw)
    if mode=='prepare':
        migration=data['migration'];tx=migration['transactionId'];device=migration['deviceId']
    else:
        assert set(data)=={'transactionId','deviceId'}
        tx=data['transactionId'];device=data['deviceId']
    assert exact_id(tx) and exact_id(device)
    manifest=json.loads(read(HOME/'manifest.json',public=True))
    native='absor-protected-channel-lab' in manifest
    worker='absorconnect-protected-worker-lab.service' if native else 'absorconnect-ipc-worker-lab.service'
    module=installer()
    own_mutation=False
    # Suprimir la salida del instalador: solo sale el recibo cerrado del proveedor.
    output=sys.stdout
    with open(os.devnull,'w') as sink:
        sys.stdout=sink
        try:
            if mode=='prepare':
                if RECEIPT.exists():
                    old=receipt();assert old['phase']=='removed' and old['transactionId']!=tx
                else:assert not RECEIPT.is_symlink()
                assert not any(p.exists() or p.is_symlink() for p in [OPT,CONFIG,STATE])
                options=migration['options']
                can=bool(migration['enabled'] is True and options['confirmLocal'] is False and options['preventSleep'] is False and set(options['features'])=={'clipboard','files','audio'} and all(v is False for v in options['features'].values()))
                result={'v':1,'transactionId':tx,'deviceId':device,'phase':'provisioning','canActivate':can,'optionsImported':False,'lockoutImported':False}
                persist(result);own_mutation=True
                # El Rust valida todos los campos/contadores ANTES del canje.
                import io
                previous=sys.stdin
                try:
                    sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps({'hashes':manifest,'enrollment':data}).encode()))
                    configure(module,'prepare-native-ui-control' if native else 'prepare-ui-control')
                finally:sys.stdin=previous
                verified_installation(manifest)
                assert read(CONFIG/'imported-attempts.json')== (STATE/'attempts.json').read_bytes()
                result.update(phase='prepared',optionsImported=True,lockoutImported=True);persist(result)
            else:
                if mode=='remove' and not RECEIPT.exists() and not RECEIPT.is_symlink():
                    assert not any(p.exists() or p.is_symlink() for p in [OPT,CONFIG,STATE])
                    sys.stdout=output;print('{"v":1,"absent":true}');return
                result=receipt()
                if mode=='remove' and result['phase']=='removed' and not any(p.exists() or p.is_symlink() for p in [OPT,CONFIG,STATE]):
                    sys.stdout=output;print('{"v":1,"absent":true}');return
                assert (result['transactionId'],result['deviceId'])==(tx,device)
                own_mutation=True
                if mode=='commit':
                    assert result['phase']=='prepared' and result['canActivate'] and result['optionsImported'] and result['lockoutImported']
                    verified_installation(manifest)
                    result['phase']='committing';persist(result)
                    subprocess.run(['systemctl','start','absorconnect-secure-lab.socket',worker],check=True,capture_output=True,timeout=20)
                    subprocess.run(['systemctl','is-active','--quiet','absorconnect-secure-lab.socket',worker],check=True,capture_output=True,timeout=5)
                    deadline=time.monotonic()+5
                    while True:
                        health=subprocess.run(['/usr/sbin/runuser','-u','absorlab','--',str(OPT/'absor-agent-status-lab'),'status','--json'],capture_output=True,timeout=2)
                        if health.returncode==0:
                            status=json.loads(health.stdout)
                            if status.get('deviceId')==device and status.get('owner')=='agent' and status.get('readyForUnattended') is False:break
                        assert time.monotonic()<deadline,'native_health_unconfirmed'
                        time.sleep(.1)
                    result['phase']='committed';persist(result)
                else:
                    if OPT.exists():
                        verified_installation(manifest)
                        configure(module,'remove-native-ui-control' if native else 'remove-ui-control')
                    assert not any(p.exists() or p.is_symlink() for p in [OPT,CONFIG,STATE])
                    result['phase']='removed';persist(result)
        except BaseException:
            # Una respuesta perdida o un fallo nunca se confunde con ausencia.
            if own_mutation and RECEIPT.exists():
                result=receipt();result['phase']='intervention_required';persist(result)
            raise
        finally:sys.stdout=output
    print(json.dumps(result,separators=(',',':')))


if __name__=='__main__':
    try:run()
    except BaseException:
        print('agent_migration_provider_unconfirmed',file=sys.stderr)
        sys.exit(78)

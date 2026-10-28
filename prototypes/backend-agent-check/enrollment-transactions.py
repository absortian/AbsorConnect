#!/usr/bin/env python3
"""Carreras HTTP reales de compensación; API/BD propias y cuentas efímeras."""
import argparse,concurrent.futures,hashlib,importlib.util,json,secrets,threading,uuid
from pathlib import Path
from urllib.parse import urlsplit

def main():
    parser=argparse.ArgumentParser();parser.add_argument('lab',type=Path);parser.add_argument('--api-base',required=True);args=parser.parse_args()
    uri=urlsplit(args.api_base);assert uri.scheme=='http' and uri.hostname=='127.0.0.1' and uri.port and uri.path in ('','/') and not(uri.username or uri.password or uri.query or uri.fragment)
    spec=importlib.util.spec_from_file_location('transaction_api',Path(__file__).with_name('native-renewal.py'));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api);api.BASE=args.api_base
    request=api.request
    output=args.lab/('enrollment-transactions-'+uuid.uuid4().hex);output.mkdir(mode=0o700)
    cases=[];accounts=[];clean=False;target=None
    try:
        def account():
            password=secrets.token_urlsafe(32)
            status,value=request('POST','/api/auth/register',{'email':'tx-'+uuid.uuid4().hex+'@example.invalid','password':password,'deviceName':'Carrera de laboratorio'})
            assert status==201,'temporary_account_creation_failed_'+str(status)
            accounts.append((value['token'],password))
            return value['token']
        def device(owner):
            identifier=str(uuid.uuid4());key=secrets.token_urlsafe(32);path='/api/devices/'+identifier
            info={'name':'Equipo transaccional ficticio','platform':'linux','appVersion':'0.1.0','remote':{'state':'available','features':{'clipboard':False,'files':False,'audio':False}}}
            assert request('PUT',path,info,owner,key)[0]==200
            return path,key,info
        def race(a,b):
            barrier=threading.Barrier(2)
            def run(fn):barrier.wait(timeout=5);return fn()
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                first=pool.submit(run,a);second=pool.submit(run,b)
                return first.result(timeout=12),second.result(timeout=12)
        owner=account()
        for episode in range(4):
            path,key,_=device(owner);tx=path+'/agent-enrollment-transactions/'+str(uuid.uuid4())
            created,cancelled=race(lambda:request('POST',tx,{},owner,key),lambda:request('DELETE',tx,{},owner,key))
            assert created[0] in (201,409) and cancelled==(200,{'state':'cancelled','legacyAllowed':True})
            assert request('GET',tx,token=owner,key=key)==(200,{'state':'cancelled','legacyAllowed':True})
            assert request('POST',tx,{},owner,key)[0]==409
            if created[0]==201:assert request('POST','/api/host-agent/enroll',{'enrollmentToken':created[1]['enrollmentToken'],'agentVersion':'0.1.0','capabilities':{}})[0]==400
            cases.append({'case':'create-versus-cancel','episode':episode+1,'passed':True,'lateCreateBlocked':True,'grantUnusable':True})
        owner=account()
        for episode in range(4):
            path,key,_=device(owner);tx=path+'/agent-enrollment-transactions/'+str(uuid.uuid4())
            status,grant=request('POST',tx,{},owner,key);assert status==201
            enrolled,cancelled=race(lambda:request('POST','/api/host-agent/enroll',{'enrollmentToken':grant['enrollmentToken'],'agentVersion':'0.1.0','capabilities':{}}),lambda:request('DELETE',tx,{},owner,key))
            assert enrolled[0] in (201,400) and cancelled==(200,{'state':'cancelled','legacyAllowed':True})
            if enrolled[0]==201:assert request('GET','/api/host-agent/remote-requests',token=enrolled[1]['token'])[0]==401
            assert request('GET',tx,token=owner,key=key)==(200,{'state':'cancelled','legacyAllowed':True})
            cases.append({'case':'consume-versus-cancel','episode':episode+1,'passed':True,'noSurvivingCredential':True})
        owner=account()
        for episode in range(3):
            path,key,_=device(owner);tx=path+'/agent-enrollment-transactions/'+str(uuid.uuid4())
            a,b=race(lambda:request('POST',tx,{},owner,key),lambda:request('POST',tx,{},owner,key))
            assert sorted([a[0],b[0]])==[201,409]
            winner=a[1] if a[0]==201 else b[1]
            assert request('POST','/api/host-agent/enroll',{'enrollmentToken':winner['enrollmentToken'],'agentVersion':'0.1.0','capabilities':{}})[0]==201
            assert request('DELETE',tx,{},owner,key)==(200,{'state':'cancelled','legacyAllowed':True})
            cases.append({'case':'duplicate-create','episode':episode+1,'passed':True,'oneGrantOnly':True})
        result={'schema':1,'ok':True,'cases':cases,'temporaryAccounts':len(accounts),'accountsRemoved':False,'productionTested':False,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        target=output/'report.json';target.write_text(json.dumps(result,indent=2)+'\n');target.chmod(0o600)
    finally:
        failures=0
        for owner,password in accounts:
            try:
                if request('DELETE','/api/me',{'password':password},owner)[0]!=204:failures+=1
            except Exception:failures+=1
        assert failures==0,'temporary_account_cleanup_failed'
        clean=True
        if target is not None:
            result['accountsRemoved']=clean;target.write_text(json.dumps(result,indent=2)+'\n');target.chmod(0o600)
    print('Informe local: '+str(target))

if __name__=='__main__':main()

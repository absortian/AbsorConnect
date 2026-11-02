#!/usr/bin/env python3
"""Contrato del runner; no conecta a VM ni ejecuta tareas administrativas en CI."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile
import unittest
from types import SimpleNamespace

from windows_ssh_system import SshSystem, payload, quote


class Remote:
    def __init__(self, wrong_nonce=False, failed=False):
        self.calls=[]
        self.sources=[]
        self.wrong_nonce=wrong_nonce
        self.failed=failed
        self.uploaded={}

    def powershell(self, source, timeout):
        self.calls.append(('powershell',timeout))
        self.sources.append(source)
        # Límite real del cliente SSH existente: UTF-16/base64 y prefijo fijo.
        encoded=base64.b64encode(('[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\n'+source).encode('utf-16le'))
        if len(encoded)+100>7600:
            raise AssertionError('ssh_encoded_command_bound')
        if len(self.sources)==1:
            return SimpleNamespace(returncode=0,stdout=b'{"ok":true}')
        nonce=re.search(r'quiet-([0-9a-f]{32})',source).group(1)
        expected=re.search(r"-cne '([0-9a-f]{64})'",source).group(1)
        if hashlib.sha256(self.uploaded['controller.ps1']).hexdigest()!=expected:
            raise AssertionError('controller_bytes_differ_from_manifest')
        expected_payload=re.search(r"\$payloadHash='([0-9a-f]{64})'",self.uploaded['controller.ps1'].decode()).group(1)
        if hashlib.sha256(self.uploaded['payload.ps1']).hexdigest()!=expected_payload:
            raise AssertionError('payload_bytes_differ_from_manifest')
        value={'schema':1,'nonce':'f'*32 if self.wrong_nonce else nonce,'ok':True,'result':{'ownVm':True},'systemSessionZero':True}
        return SimpleNamespace(returncode=1 if self.failed else 0,stdout=json.dumps(value).encode())

    def transfer(self, lines):
        self.calls.append(('sftp',len(lines)))
        for line in lines:
            _,source,target=shlex.split(line);self.uploaded[target.rsplit('/',1)[1]]=Path(source).read_bytes()
        return SimpleNamespace(returncode=0)


class RunnerTests(unittest.TestCase):
    def test_rejects_nonce_and_path_injection_before_any_transport(self):
        for nonce in ['','a'*31,'a'*32+"';exit",'../'+'a'*32]:
            with self.assertRaises(RuntimeError):payload(nonce,'@{ok=$true}')
        for value in ['x\ny','x\ry','x\0y']:
            with self.assertRaises(RuntimeError):quote(value)

    def test_rejects_oversized_and_empty_source(self):
        for source in ['', 'x'*12001]:
            with self.assertRaises(RuntimeError):payload('a'*32,source)

    def test_ssh_only_request_and_private_journal(self):
        with tempfile.TemporaryDirectory() as directory:
            remote=Remote()
            value=SshSystem(remote,directory).call('@{ownVm=$true}')
            self.assertTrue(value['ok'])
            self.assertEqual(remote.calls,[('powershell',15),('sftp',2),('powershell',45)])
            records=list(Path(directory).glob('*.json'))
            self.assertEqual(len(records),1)
            self.assertEqual(json.loads(records[0].read_text())['state'],'task_and_files_removed')
            if os.name!='nt':self.assertEqual(records[0].stat().st_mode&0o777,0o600)
            self.assertFalse(any('utmctl' in x for x in remote.sources))

    def test_wrong_result_nonce_never_certifies_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError,'runner_result_invalid'):
                SshSystem(Remote(wrong_nonce=True),directory).call('@{ownVm=$true}')
            record=json.loads(next(Path(directory).glob('*.json')).read_text())
            self.assertEqual(record['state'],'invalid_result')

    def test_failed_controller_never_certifies_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError,'runner_controller_failed'):
                SshSystem(Remote(failed=True),directory).call('@{ownVm=$true}')
            record=json.loads(next(Path(directory).glob('*.json')).read_text())
            self.assertEqual(record['state'],'controller_failed')

    @unittest.skipUnless(os.name=='nt','El parser de PowerShell se comprueba en Windows CI')
    def test_all_powershell_sources_parse_without_running_them(self):
        with tempfile.TemporaryDirectory() as directory:
            remote=Remote()
            SshSystem(remote,directory).call('@{ownVm=$true}')
            sources=remote.sources+[p.read_text() for p in Path(directory).glob('*.ps1')]
            manifest=Path(directory)/'sources.json'
            manifest.write_text(json.dumps(sources),encoding='utf-8')
            parser=Path(directory)/'parse.ps1'
            parser.write_text("param([string]$Manifest)\n$ErrorActionPreference='Stop';foreach($source in ([IO.File]::ReadAllText($Manifest)|ConvertFrom-Json)){$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count -ne 0){throw 'quiet_runner_syntax'}};Write-Output 'quiet_runner_syntax_ok'",encoding='utf-8')
            result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-File',str(parser),str(manifest)],capture_output=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace'))


if __name__=='__main__':unittest.main()

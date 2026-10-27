#!/usr/bin/env python3
"""Adaptador Electron → control efímero del laboratorio; no recibe K ni token real."""
import json
import os
from pathlib import Path
import sys
import urllib.request
from urllib.parse import urlsplit


def main():
    assert len(sys.argv)==3
    path=Path(sys.argv[2]);m=path.lstat()
    assert path.is_file() and not path.is_symlink() and m.st_uid==os.getuid() and m.st_mode&0o077==0 and m.st_size<=4096
    config=json.loads(path.read_text());origin=config['origin'];uri=urlsplit(origin)
    assert uri.scheme=='http' and uri.hostname=='127.0.0.1' and uri.port and not(uri.username or uri.password or uri.query or uri.fragment) and uri.path in ('','/')
    name=config['caseName'];assert name in ['correct','correct-reconnect','wrong-proof','fingerprint-mismatch','api-cut','api-revoked','linux-locked','worker-stall','broker-stall','broker-crash']
    assert config['protectedFixture'] and config['apiSignaling']
    req=urllib.request.Request(origin+'/protected/'+name+'/run',data=b'{}',headers={'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(req,timeout=100) as response:
        assert response.status==200
        raw=response.read(16385);assert len(raw)<=16384
        value=json.loads(raw);assert value['protectedIpc'] and value['systemd']['runtimeRemoved']
        print(json.dumps(value))


if __name__=='__main__':main()

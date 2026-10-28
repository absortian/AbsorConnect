#!/usr/bin/env python3
"""Formato Xauthority con datos públicos; no abre archivos, X11, red ni procesos."""
import importlib.util
from pathlib import Path
import sys
import unittest


@unittest.skipIf(sys.platform == 'win32', 'El lector pertenece a Linux')
class AuthorityRecordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('authority_probe', Path(__file__).with_name('linux-xauthority-fd-probe.py'))
        cls.probe = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.probe)

    @staticmethod
    def record(family=256, display=b'0', name=b'MIT-MAGIC-COOKIE-1', data=b'B'*16, address=b'public-fixture'):
        fields = [address, display, name, data]
        return family.to_bytes(2, 'big') + b''.join(len(v).to_bytes(2, 'big')+v for v in fields)

    def rejected(self, raw, display=0):
        with self.assertRaises(AssertionError):
            self.probe.authority_record(raw, display)

    def test_local_or_wildcard_exact_display(self):
        for family in [256, 65535]:
            self.assertEqual(self.probe.authority_record(self.record(family=family), 0), b'B'*16)

    def test_only_one_matching_record(self):
        self.rejected(self.record()+self.record())
        self.assertEqual(self.probe.authority_record(self.record(display=b'1')+self.record(), 0), b'B'*16)

    def test_internet_family_other_protocol_or_display_never_match(self):
        for raw in [self.record(family=0), self.record(name=b'other'), self.record(display=b'1'), self.record(display=b'00')]:
            self.rejected(raw)

    def test_cookie_length_is_exact(self):
        for size in [0, 1, 15, 17, 256]:
            self.rejected(self.record(data=b'B'*size))

    def test_truncation_at_each_byte_is_rejected(self):
        raw = self.record()
        for size in range(len(raw)):
            self.rejected(raw[:size])

    def test_trailing_data_cannot_be_ignored(self):
        for suffix in [b'\x00', b'\x00\x00', b'\x01\x00\xff\xff']:
            self.rejected(self.record()+suffix)

    def test_oversize_and_inconsistent_field_length(self):
        self.rejected(bytes(65537))
        self.rejected(b'\x01\x00\xff\xff'+b'X'*10)


if __name__ == '__main__':
    unittest.main()

"""Protecciones del mapeo NAT del laboratorio; no abre QMP ni toca una VM real."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mobile_fixture', Path(__file__).with_name('mobile-protected-runner.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Monitor:
    def __init__(self, vm):self.vm=vm
    def __enter__(self):return self
    def __exit__(self, *_):pass
    def call(self, method, arguments):
        assert method=='human-monitor-command'
        self.vm.calls.append(arguments['command-line'])
        if arguments['command-line'].startswith('hostfwd_remove') and getattr(self.vm,'fail_remove',False):
            self.vm.fail_remove=False;return 'Could not remove host forwarding rule'
        return ''


class VM:
    def __init__(self):self.calls=[]
    def Qmp(self):return Monitor(self)


class MappingTest(unittest.TestCase):
    def test_only_loopback_udp_and_identical_dtls_fingerprint(self):
        vm=VM();mapping=fixture.VmDirectMapping(vm)
        original='v=0\r\na=fingerprint:sha-256 AA:BB\r\nm=video 50001 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 10.0.2.15\r\na=candidate:1 1 udp 200 10.0.2.15 50001 typ host\r\na=candidate:2 1 udp 100 10.0.2.15 50001 typ host\r\n'
        answer=mapping.answer(original)
        self.assertIn('a=fingerprint:sha-256 AA:BB',answer)
        self.assertIn('c=IN IP4 10.0.2.2',answer)
        self.assertEqual(len(vm.calls),1)
        self.assertTrue(vm.calls[0].startswith('hostfwd_add udp:127.0.0.1:'))
        self.assertTrue(vm.calls[0].endswith('-10.0.2.15:50001'))
        mapping.close();mapping.close()
        self.assertEqual(len(vm.calls),2)
        self.assertTrue(vm.calls[1].startswith('hostfwd_remove udp:127.0.0.1:'))
        self.assertFalse(mapping.ports)

    def test_foreign_address_low_port_and_empty_sdp_have_no_effect(self):
        for candidate in ['a=candidate:1 1 udp 200 192.168.100.2 50001 typ host',
                          'a=candidate:1 1 udp 200 10.0.2.15 22 typ host','v=0']:
            vm=VM();mapping=fixture.VmDirectMapping(vm)
            with self.assertRaises(AssertionError):mapping.answer(candidate)
            self.assertEqual(vm.calls,[])

    def test_cleanup_failure_does_not_report_mapping_removed(self):
        vm=VM();mapping=fixture.VmDirectMapping(vm)
        mapping.answer('a=candidate:1 1 udp 200 10.0.2.15 50001 typ host\r\n')
        vm.fail_remove=True
        with self.assertRaises(AssertionError):mapping.close()
        self.assertTrue(mapping.ports)
        mapping.close()
        self.assertFalse(mapping.ports)

    def test_entire_sdp_is_validated_before_creating_any_mapping(self):
        vm=VM();mapping=fixture.VmDirectMapping(vm)
        with self.assertRaises(AssertionError):
            mapping.answer('a=candidate:1 1 udp 200 10.0.2.15 50001 typ host\r\na=candidate:2 1 udp 200 192.168.100.2 50002 typ host\r\n')
        self.assertFalse(vm.calls)


if __name__=='__main__':unittest.main()

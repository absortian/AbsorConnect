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


class ScreenshotRequestTest(unittest.TestCase):
    class Handler:
        def __init__(self, path, body):self.path=path;self.value=body;self.response=None
        def body(self, limit):
            assert limit==128
            return self.value
        def reply(self, status, body):self.response=(status,body)

    def controller(self, callback, runtime=True):
        return fixture.MobileController({'correct':{},'correct-reconnect':{}},{},None,None,{},runtime=runtime,screenshot=callback)

    def test_only_fixed_case_and_empty_body_reach_screenshot_callback(self):
        seen=[];controller=self.controller(seen.append)
        handler=self.Handler('/mobile/screenshot/correct',{})
        self.assertTrue(controller.post(handler))
        self.assertEqual(seen,['correct'])
        self.assertEqual(handler.response,(200,{'ok':True,'nativeGreenVerified':True}))
        handler=self.Handler('/mobile/screenshot/correct-reconnect',{})
        self.assertTrue(controller.post(handler))
        self.assertEqual(seen,['correct','correct-reconnect'])

    def test_parameters_unknown_case_and_non_runtime_never_capture(self):
        for path,body,runtime in [('/mobile/screenshot/correct',{'path':'untrusted'},True),
                                  ('/mobile/screenshot/foreign',{},True),
                                  ('/mobile/screenshot/correct',{},False)]:
            seen=[];controller=self.controller(seen.append,runtime)
            with self.assertRaises(AssertionError):controller.post(self.Handler(path,body))
            self.assertEqual(seen,[])


class PreparationRequestTest(unittest.TestCase):
    def test_preparation_is_runtime_only_with_no_parameters(self):
        for body,runtime in [({},True),({'path':'untrusted'},True),({},False)]:
            seen=[]
            controller=fixture.MobileController({'correct':{}},{},None,None,{},runtime=runtime,prepare=lambda:seen.append(True))
            handler=ScreenshotRequestTest.Handler('/mobile/prepare/correct',body)
            if body or not runtime:
                with self.assertRaises(AssertionError):controller.post(handler)
                self.assertFalse(seen)
            else:
                self.assertTrue(controller.post(handler));self.assertEqual(seen,[True])
                self.assertEqual(handler.response,(200,{'ok':True}))


if __name__=='__main__':unittest.main()

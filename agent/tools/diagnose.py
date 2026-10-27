#!/usr/bin/env python3
"""Resumen de informes de laboratorio por lista permitida; nunca consulta secretos o la red."""
import argparse
import hashlib
import json
import os
import stat
import sys

MAX_REPORT = 524288
FLAGS = (
    'protectedIpcTested', 'rustAuthenticationTested', 'apiRenewalTested',
    'apiSignalingTested', 'nativeWorkerConnected', 'turnTested', 'mobileTested',
    'physicalMachinesTested', 'productionTested', 'servicesAndSecretsRemoved',
    'temporaryAccountsRemoved', 'apiCredentialsKeptInBroker',
)


def summarize(report):
    if not isinstance(report, dict) or type(report.get('ok')) is not bool:
        raise ValueError('invalid_report')
    cases = report.get('cases')
    if not isinstance(cases, list) or len(cases) > 64:
        raise ValueError('invalid_report')
    result = {'schema': 1, 'laboratoryReport': True, 'ok': report['ok'],
              'caseCount': len(cases), 'certifiesUnattendedService': False}
    for flag in FLAGS:
        if type(report.get(flag)) is bool:
            result[flag] = report[flag]
    return result


def load(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_REPORT:
            raise ValueError('invalid_report')
        raw = source.read(MAX_REPORT + 1)
    if len(raw) > MAX_REPORT:
        raise ValueError('invalid_report')
    result = summarize(json.loads(raw))
    result['reportSha256'] = hashlib.sha256(raw).hexdigest()
    return result


def self_test():
    secret = 'NEVER_PRINT_THIS_TEST_SECRET'
    report = {'ok': True, 'cases': [{'name': secret}], 'token': secret,
              'readyForUnattended': True, 'protectedIpcTested': True,
              'apiSignalingTested': secret, 'error': secret}
    result = summarize(report)
    assert secret not in json.dumps(result)
    assert result['certifiesUnattendedService'] is False
    assert result['caseCount'] == 1 and result['protectedIpcTested'] is True
    assert 'apiSignalingTested' not in result and 'readyForUnattended' not in result
    for invalid in [None, [], {'ok': 1, 'cases': []}, {'ok': True, 'cases': [None] * 65}]:
        try:
            summarize(invalid)
        except ValueError:
            continue
        raise AssertionError('invalid_report_accepted')
    return {'schema': 1, 'diagnosticSelfTest': True, 'certifiesUnattendedService': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--report')
    group.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    try:
        result = self_test() if args.self_test else load(args.report)
    except (OSError, ValueError, TypeError, RecursionError):
        # No imprimir rutas, contenido, excepciones de JSON o campos de error libres.
        print('{"schema":1,"error":"invalid_report"}')
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())

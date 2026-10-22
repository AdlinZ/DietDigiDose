"""Synthetic APK fixtures run the production gate; no build, key or SDK download."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import warnings
import xml.etree.ElementTree as ET
import zipfile

SCRIPT = Path(__file__).with_name('check-apk-security.py')
spec = importlib.util.spec_from_file_location('apk_security', SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
FIXTURES = Path(__file__).with_name('fixtures') / 'apk-security'
CERT = 'ab' * 32


class AndroidNetworkPolicySourceTest(unittest.TestCase):
    def test_localhost_domain_declares_exact_match_for_android_release_lint(self):
        policy = ET.parse(gate.ROOT / 'client/plugins/android-security/ddd_network_security_config.xml').getroot()
        domains = policy.findall('.//domain')
        self.assertEqual(len(domains), 1)
        self.assertEqual((domains[0].text or '').strip(), 'localhost')
        self.assertEqual(domains[0].attrib, {'includeSubdomains': 'false'})
        self.assertEqual(policy.find('base-config').get('cleartextTrafficPermitted'), 'false')
        self.assertEqual(policy.find('domain-config').get('cleartextTrafficPermitted'), 'false')


class ApkSecurityTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.apk = Path(self.directory.name) / 'final-signed.apk'
        self.manifest = (FIXTURES / 'AndroidManifest.xml').read_text()
        self.table = (FIXTURES / 'resources.txt').read_text()
        rules = gate.ROOT / 'client/plugins/android-security'
        self.resources = {
            'res/xml/ddd_backup_rules.xml': (rules / 'ddd_backup_rules.xml').read_text(),
            'res/xml/ddd_data_extraction_rules.xml': (rules / 'ddd_data_extraction_rules.xml').read_text(),
            'res/xml/network_security_config.xml': (rules / 'ddd_network_security_config.xml').read_text(),
            'res/xml-v28/network_security_config.xml': (rules / 'ddd_network_security_config.xml').read_text(),
            'res/xml/clipboard_provider_paths.xml': '<paths><cache-path name="clipboard_files" path=".clipboard/"/></paths>',
        }
        self.assets = {'assets/index.android.bundle': b'public app configuration',
                       'assets/expo-updates.pem': b'-----BEGIN CERTIFICATE-----\n' + b'A' * 96 + b'\n-----END CERTIFICATE-----',
                       'assets/app.config.json': b'{"EXPO_PUBLIC_BACKEND_BASE_URL":"https://example.org"}',
                       'classes.dex': b'crypto code: -----BEGIN PRIVATE KEY----- (no key material)'}
        self.signature = f'Verifies\nSigner #1 certificate SHA-256 digest: {CERT}\n'
        self.args = SimpleNamespace(apk=str(self.apk), source_sha='12' * 20, application_id='com.dietdigidose.app.preview',
                                    version_code='264101', version_name='1.0.6', certificate_sha256=CERT,
                                    apkanalyzer='apkanalyzer', aapt2='aapt2', apksigner='apksigner')
        self.calls = []
        self.typed_overrides = {}

    def build_fixture(self):
        with zipfile.ZipFile(self.apk, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('AndroidManifest.xml', self.manifest)
            archive.writestr('resources.arsc', self.table)
            for name, content in (self.resources | self.assets).items():
                archive.writestr(name, content)

    def runner(self, command):
        self.calls.append(command)
        self.assertEqual(command[-1], str(self.apk), 'Inspect the final APK, never generated source XML')
        if command[0] == 'apksigner':
            self.assertEqual(command[1:-1], ['verify', '--verbose', '--print-certs'])
            return self.signature
        if command[:3] == ['aapt2', 'dump', 'resources']:
            return self.table
        if command[:4] == ['aapt2', 'dump', 'xmltree', '--file']:
            path = command[4]
            if path in self.typed_overrides:
                return self.typed_overrides[path]
            text = self.manifest if path == 'AndroidManifest.xml' else self.resources[path]
            return self.typed_dump(text)
        if command[1:3] == ['manifest', 'print']:
            return self.manifest
        self.assertEqual(command[:4], ['apkanalyzer', 'resources', 'xml', '--file'])
        return self.resources[command[4].lstrip('/')]

    def typed_dump(self, text):
        lines = []
        for element in ET.fromstring(text).iter():
            lines.append(f'E: {element.tag} (line=1)')
            for name, value in element.attrib.items():
                name = name.replace(gate.ANDROID, 'http://schemas.android.com/apk/res/android:')
                typed = value.replace('@ref/', '@')
                if typed not in ('true', 'false') and not typed.startswith('@') and not typed.isdecimal():
                    typed = '"' + typed + '"'
                lines.append(f'  A: {name}={typed} (Raw: "{value}")')
        return '\n'.join(lines)

    def inspect(self):
        self.build_fixture()
        return gate.inspect_apk(self.args, self.runner)

    def rejects(self, message):
        with self.assertRaisesRegex(gate.GateError, message):
            self.inspect()

    def test_safe_final_apk_report_binds_identity_and_every_variant(self):
        report = self.inspect()
        self.assertEqual(report['status'], 'passed')
        self.assertEqual(report['sourceCommit'], self.args.source_sha)
        self.assertEqual(report['apkSha256'], gate.digest(self.apk))
        self.assertEqual(report['applicationId'], self.args.application_id)
        self.assertEqual(report['versionCode'], self.args.version_code)
        self.assertEqual(report['signerCertificateSha256'], CERT)
        self.assertEqual(set(report['decodedResourcesSha256']), set(self.resources))
        self.assertEqual(len(report['exportedComponents']), 3)

    def test_cli_success_writes_bound_report_and_rejection_replaces_it(self):
        self.build_fixture()
        report = Path(self.directory.name) / 'report.json'
        arguments = ['--report', str(report)]
        for name, value in vars(self.args).items():
            arguments += ['--' + name.replace('_', '-'), str(value)]
        production_inspect = gate.inspect_apk
        with patch.object(gate, 'inspect_apk', side_effect=lambda args: production_inspect(args, self.runner)):
            self.assertEqual(gate.main(arguments), 0)
            self.assertEqual(json.loads(report.read_text())['apkSha256'], gate.digest(self.apk))
            self.manifest = self.manifest.replace('<application ', '<application android:debuggable="true" ')
            self.build_fixture()
            self.assertEqual(gate.main(arguments), 1)
            self.assertEqual(json.loads(report.read_text())['status'], 'failed')

    def test_malformed_or_unresolved_manifest_fails_closed(self):
        original = self.manifest
        for manifest in ['<manifest', original.replace('android:minSdkVersion="24"', 'android:minSdkVersion="@integer/min"'),
                         original.replace('<manifest ', '<!DOCTYPE manifest [<!ENTITY e "bad">]><manifest ')]:
            with self.subTest(manifest=manifest[:40]):
                self.manifest = manifest
                self.rejects('XML|SDK')

    def test_multiple_signers_or_missing_signature_evidence_fail(self):
        for signature in ['', self.signature + f'Signer #2 certificate SHA-256 digest: {CERT}\n']:
            with self.subTest(signature=signature):
                self.signature = signature
                self.rejects('signer')

    def test_candidate_package_and_relative_main_activity(self):
        self.manifest = self.manifest.replace('.app.preview', '.app').replace('com.dietdigidose.app.MainActivity', '.MainActivity')
        self.args.application_id = 'com.dietdigidose.app'
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_named_references_and_resource_path_shortening(self):
        self.manifest = self.manifest.replace('@ref/0x7f120001', '@xml/ddd_backup_rules')
        self.table = self.table.replace('res/xml/ddd_backup_rules.xml', 'res/a.xml')
        self.resources['res/a.xml'] = self.resources.pop('res/xml/ddd_backup_rules.xml')
        self.assertEqual(self.inspect()['status'], 'passed')

    def test_missing_network_config_cannot_rely_on_runtime_defaults(self):
        self.manifest = self.manifest.replace(' android:networkSecurityConfig="@ref/0x7f120003"', '')
        self.rejects('Explicit network security config')

    def test_compiled_manifest_boolean_cannot_disagree_with_decoded_raw_value(self):
        self.manifest = self.manifest.replace('<application ', '<application android:debuggable="false" ')
        dump = self.typed_dump(self.manifest)
        self.typed_overrides['AndroidManifest.xml'] = dump.replace('debuggable=false (Raw: "false")', 'debuggable=true (Raw: "false")')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_compiled_export_name_cannot_disagree_with_allowlisted_raw_name(self):
        dump = self.typed_dump(self.manifest)
        self.typed_overrides['AndroidManifest.xml'] = dump.replace('name="com.dietdigidose.app.preview.MainActivity" (Raw:', 'name="com.dietdigidose.app.preview.UnreviewedActivity" (Raw:', 1)
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_compiled_xml_unknown_format_or_omitted_elements_fail_closed(self):
        for dump in ['future unsupported format', 'E: manifest (line=1)']:
            with self.subTest(dump=dump):
                self.typed_overrides['AndroidManifest.xml'] = dump
                self.rejects('compiled XML|element count')

    def test_compiled_resource_reference_cannot_point_to_different_policy(self):
        dump = self.typed_dump(self.manifest)
        self.typed_overrides['AndroidManifest.xml'] = dump.replace('networkSecurityConfig=@0x7f120003', 'networkSecurityConfig=@0x7f120002')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_compiled_backup_path_cannot_disagree_with_decoded_raw_value(self):
        path = 'res/xml/ddd_backup_rules.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace('path="." (Raw: ".")', 'path="unrelated" (Raw: ".")', 1)
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_forged_raw_suffix_inside_compiled_value_is_rejected(self):
        path = 'res/xml/clipboard_provider_paths.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace('path=".clipboard/" (Raw: ".clipboard/")', 'path=".clipboard/" (Raw: "x/../../../secret" (Raw: ".clipboard/")')
        self.rejects('Ambiguous compiled security attribute')

    def test_compiled_network_policy_cannot_disagree_with_raw_value(self):
        path = 'res/xml/network_security_config.xml'
        self.typed_overrides[path] = self.typed_dump(self.resources[path]).replace('cleartextTrafficPermitted=false (Raw: "false")', 'cleartextTrafficPermitted=true (Raw: "false")')
        self.rejects('Compiled/decoded security attribute mismatch')

    def test_debuggable_testonly_and_unresolved_flags_fail(self):
        original = self.manifest
        for flag in ['debuggable="true"', 'testOnly="true"', 'debuggable="@bool/release_debug"']:
            with self.subTest(flag=flag):
                self.manifest = original.replace('<application ', '<application android:' + flag + ' ')
                self.rejects('debuggable|testOnly')

    def test_cleartext_manifest_missing_true_or_reference_fail(self):
        original = self.manifest
        for replacement in ['', 'android:usesCleartextTraffic="true"', 'android:usesCleartextTraffic="@bool/cleartext"']:
            with self.subTest(value=replacement):
                self.manifest = original.replace('android:usesCleartextTraffic="false"', replacement)
                self.rejects('Cleartext|usesCleartextTraffic')

    def test_override_in_qualified_network_resource_fails(self):
        self.resources['res/xml-v28/network_security_config.xml'] = '<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain>localhost</domain></domain-config></network-security-config>'
        self.rejects('permits cleartext')

    def test_nested_network_override_and_unresolved_boolean_fail(self):
        for value in ['true', '@bool/cleartext']:
            with self.subTest(value=value):
                self.resources['res/xml/network_security_config.xml'] = f'<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config><domain>localhost</domain><domain-config cleartextTrafficPermitted="{value}"/></domain-config></network-security-config>'
                self.rejects('cleartext')

    def test_modern_target_cannot_hide_older_runtime_cleartext_defaults(self):
        for config in ['<network-security-config/>', '<network-security-config><base-config/></network-security-config>']:
            with self.subTest(config=config):
                self.resources['res/xml/network_security_config.xml'] = config
                self.rejects('cleartext')

    def test_missing_localhost_policy_cannot_enable_newer_runtime_default(self):
        for invalid in ['', '<debug-overrides><domain>localhost</domain></debug-overrides>']:
            with self.subTest(invalid=invalid):
                self.resources['res/xml/network_security_config.xml'] = '<network-security-config><base-config cleartextTrafficPermitted="false"/>' + invalid + '</network-security-config>'
                self.rejects('Explicit localhost policy')

    def test_alternate_network_reference_is_checked(self):
        self.manifest = self.manifest.replace('@ref/0x7f120003', '@xml/another_network')
        self.table += '\n    resource 0x7f120005 xml/another_network\n      () (file) res/other.xml type=XML\n'
        self.resources['res/other.xml'] = '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>'
        self.rejects('permits cleartext')

    def test_missing_resource_alias_and_unknown_decoder_output_fail_closed(self):
        original = self.table
        for replacement in ['() @xml/other', '() @0x7f120099', '() unreadable-format', '']:
            with self.subTest(value=replacement):
                self.table = original.replace('() (file) res/xml/ddd_backup_rules.xml type=XML', replacement)
                self.rejects('Unresolved|Unsupported')
        self.table = original
        self.resources.pop('res/xml/ddd_backup_rules.xml')
        self.rejects('absent')

    def test_allowbackup_false_does_not_bypass_missing_rules(self):
        for attribute in ['fullBackupContent', 'dataExtractionRules']:
            with self.subTest(attribute=attribute):
                saved = self.manifest
                import re
                self.manifest = re.sub(r' android:' + attribute + '="[^"]*"', '', saved)
                self.rejects('reference is missing')
                self.manifest = saved

    def test_each_sensitive_domain_required_for_both_transports(self):
        key = 'res/xml/ddd_data_extraction_rules.xml'
        original = self.resources[key]
        for domain in sorted(gate.DOMAINS):
            for occurrence in [0, 1]:
                with self.subTest(domain=domain, occurrence=occurrence):
                    needle = f'<exclude domain="{domain}" path="." />'
                    before, after = original.split(needle, 1)
                    self.resources[key] = (before + after if occurrence == 0 else before + needle + after.replace(needle, '', 1))
                    self.rejects('every sensitive storage domain')
        self.resources[key] = original

    def test_legacy_and_alternate_backup_rules_fail(self):
        self.resources['res/xml/ddd_backup_rules.xml'] = '<full-backup-content><exclude domain="sharedpref" path="SecureStore"/></full-backup-content>'
        self.rejects('every sensitive storage domain')
        self.setUp()
        self.manifest = self.manifest.replace('@ref/0x7f120002', '@xml/another_backup')
        self.table += '\n    resource 0x7f120005 xml/another_backup\n      () (file) res/other.xml type=XML\n'
        self.resources['res/other.xml'] = '<data-extraction-rules><cloud-backup/></data-extraction-rules>'
        self.rejects('Both cloud-backup')

    def test_qualified_backup_variant_cannot_reenable_transfer(self):
        self.table = self.table.replace('() (file) res/xml/ddd_data_extraction_rules.xml type=XML', '() (file) res/xml/ddd_data_extraction_rules.xml type=XML\n      (v31) (file) res/xml-v31/backup.xml type=XML')
        self.resources['res/xml-v31/backup.xml'] = '<data-extraction-rules><cloud-backup/><device-transfer/></data-extraction-rules>'
        self.rejects('every sensitive storage domain')

    def test_custom_backup_agent_and_enabled_backup_fail(self):
        original = self.manifest
        self.manifest = original.replace('<application ', '<application android:backupAgent=".CustomBackup" ')
        self.rejects('Custom backup')
        self.manifest = original.replace('android:allowBackup="false"', 'android:allowBackup="true"')
        self.rejects('Backup must be disabled')

    def test_unknown_exports_including_implicit_and_aliases_fail(self):
        original = self.manifest
        for component in [
            '<activity android:name=".Debug" android:exported="true"/>',
            '<activity-alias android:name=".Alias" android:targetActivity=".MainActivity" android:exported="true"/>',
            '<provider android:name=".Leak" android:exported="true"/>',
            '<service android:name=".Implicit"><intent-filter><action android:name="oops"/></intent-filter></service>',
            '<receiver android:name=".Receiver" android:exported="true" android:enabled="false"/>',
        ]:
            with self.subTest(component=component):
                self.manifest = original.replace('</application>', component + '</application>')
                self.rejects('Unapproved exported')

    def test_known_component_cannot_expand_deep_links_or_remove_launcher(self):
        original = self.manifest
        for before, after in [('android:scheme="dietdigidose"', 'android:scheme="https"'),
                              ('android.intent.action.VIEW', 'android.intent.action.SEND'),
                              ('android.intent.category.LAUNCHER', 'android.intent.category.DEFAULT')]:
            with self.subTest(after=after):
                self.manifest = original.replace(before, after)
                self.rejects('deep-link|launcher')

    def test_profile_receiver_must_retain_permission(self):
        self.manifest = self.manifest.replace(' android:permission="android.permission.DUMP"', '')
        self.rejects('DUMP permission')

    def test_clipboard_resource_cannot_expose_private_files(self):
        self.resources['res/xml/clipboard_provider_paths.xml'] = '<paths><files-path name="clipboard_files" path="."/></paths>'
        self.rejects('dedicated cache')

    def test_private_files_and_source_maps_fail_without_secret_output(self):
        original = copy.deepcopy(self.assets)
        cases = {'assets/.env.production': b'TOKEN=never-print-me', 'assets/release.jks': b'key',
                 'assets/credentials.json': b'{}', 'assets/index.android.bundle.map': b'{}',
                 'assets/encrypted-key-asset.txt': b'-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,1234567890ABCDEF\n\n' + b'A' * 96 + b'\n-----END RSA PRIVATE KEY-----',
                 'assets/renamed-public.pem': b'-----BEGIN RSA PRIVATE KEY-----\n' + b'A' * 96 + b'\n-----END RSA PRIVATE KEY-----',
                 'assets/config.json': b'{"private_key":"-----BEGIN PRIVATE KEY-----\\n' + b'A' * 96 + b'\\n-----END PRIVATE KEY-----"}',
                 'assets/inline.js': b'//# sourceMappingURL=data:application/json;base64,aaaa'}
        for name, value in cases.items():
            with self.subTest(name=name):
                self.assets = original | {name: value}
                with self.assertRaises(gate.GateError) as caught:
                    self.inspect()
                self.assertNotIn('never-print-me', str(caught.exception))

    def test_private_key_scan_crosses_chunk_boundary(self):
        self.assets['assets/large.bin'] = b'x' * (1024 * 1024 - 12) + b'-----BEGIN PRIVATE KEY-----\n' + b'A' * 96 + b'\n-----END PRIVATE KEY-----'
        self.rejects('private key')

    def test_wrong_signature_identity_and_instrumentation_fail(self):
        self.signature = self.signature.replace(CERT, 'cd' * 32)
        self.rejects('signer')
        self.signature = f'Signer #1 certificate SHA-256 digest: {CERT}\n'
        self.args.version_code = '264102'
        self.rejects('package/version')
        self.args.version_code = '264101'
        self.manifest = self.manifest.replace('</manifest>', '<instrumentation android:name=".Test"/></manifest>')
        self.rejects('Instrumentation')

    def test_duplicate_or_traversal_archive_entries_fail(self):
        self.assets['../secret'] = b'bad'
        self.rejects('Unsafe')
        self.assets.pop('../secret')
        self.build_fixture()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            with zipfile.ZipFile(self.apk, 'a') as archive:
                archive.writestr('AndroidManifest.xml', self.manifest)
        with self.assertRaisesRegex(gate.GateError, 'Duplicate'):
            gate.inspect_apk(self.args, self.runner)

    def test_tool_failure_is_fatal_and_does_not_expose_output(self):
        self.build_fixture()
        with patch.object(gate.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'tool', output='secret')):
            with self.assertRaisesRegex(gate.GateError, 'inspection command failed') as caught:
                gate.inspect_apk(self.args)
        self.assertNotIn('secret', str(caught.exception))

    def test_apk_mutation_while_inspecting_is_rejected(self):
        self.build_fixture()
        def mutate(command):
            result = self.runner(command)
            if command[0] == 'apksigner':
                with self.apk.open('ab') as output:
                    output.write(b'changed')
            return result
        with self.assertRaisesRegex(gate.GateError, 'changed while'):
            gate.inspect_apk(self.args, mutate)

    def test_cli_tool_unavailable_removes_stale_success_report_and_exits_nonzero(self):
        self.build_fixture()
        report = Path(self.directory.name) / 'report.json'
        report.write_text('{"status":"passed"}')
        arguments = [sys.executable, str(SCRIPT), '--report', str(report)]
        for name, value in vars(self.args).items():
            arguments += ['--' + name.replace('_', '-'), str(value) if name != 'apksigner' else str(Path(self.directory.name) / 'missing-tool')]
        result = subprocess.run(arguments, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(report.read_text())['status'], 'failed')


if __name__ == '__main__':
    unittest.main()

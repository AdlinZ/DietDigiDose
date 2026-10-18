#!/usr/bin/env python3
"""Fail-closed checks of the final signed APK, using existing Android SDK tools.

No source/prebuild XML is accepted as evidence. See docs/apk-security-gate.md.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ANDROID = '{http://schemas.android.com/apk/res/android}'
ROOT = Path(__file__).resolve().parent.parent
DOMAINS = {'root', 'file', 'database', 'sharedpref', 'external',
           'device_root', 'device_file', 'device_database', 'device_sharedpref'}
PRIVATE_KEY = re.compile(
    rb'-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----\s*'
    rb'(?:(?:Proc-Type|DEK-Info|Version|Comment):[^\r\n]*[\r\n]+)*\s*'
    rb'[A-Za-z0-9+/=\s]{64,}?-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----')


class GateError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def attr(element, name, default=None):
    return element.get(ANDROID + name, default)


def boolean(value, label, default=None):
    if value is None and default is not None:
        return default
    require(value in ('true', 'false'), f'{label}: missing, unresolved or non-literal boolean')
    return value == 'true'


def xml(text, label):
    require('<!DOCTYPE' not in text.upper() and '<!ENTITY' not in text.upper(),
            f'{label}: XML declarations are not allowed')
    try:
        return ET.fromstring(text)
    except ET.ParseError as error:
        raise GateError(f'{label}: malformed decoded XML') from error


def run_tool(args):
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as error:
        # Tool diagnostics can contain asset contents. Never include them in a report.
        raise GateError(f'{Path(args[0]).name}: required inspection command failed') from error
    require(bool(result.stdout.strip()), f'{Path(args[0]).name}: empty inspection output')
    return result.stdout


def resource_table(text):
    """Index ALL XML configurations, not a guessed filename or default variant.

    AAPT2 resolves numeric manifest references and resource-path shortening. Aliases
    and future/unrecognized value formats fail closed rather than being skipped.
    """
    records, current = {}, None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith(('Package ', 'type ', 'resource ')):
            current = None
        match = re.fullmatch(r'resource (0x[0-9a-fA-F]{8}) (xml/\w+)(?: (?:PUBLIC|_PRIVATE_))?', line)
        if match:
            identifier, name = match.groups()
            require(identifier.lower() not in records and name not in records,
                    'Ambiguous XML resource table')
            current = []
            records[identifier.lower()] = records[name] = current
        elif current is not None and line and line != 'Flag disabled values:':
            current.append(line)
    require(bool(records), 'No inspectable XML resources in APK')
    return records


def check_typed_xml(root, dump, table):
    """Cross-check policy inputs against AAPT2's compiled values, not Raw text.

    apkanalyzer prefers raw attribute strings when present. AAPT2 prints compiled
    values first, so a crafted raw=false/typed=true must not satisfy the gate.
    Compare per-element in document order, never aggregate boolean counts.
    """
    names = {'package', 'cleartextTrafficPermitted', 'domain', 'path'} | {
        ANDROID + name for name in ('versionCode', 'versionName', 'minSdkVersion', 'targetSdkVersion',
                                   'debuggable', 'testOnly', 'usesCleartextTraffic', 'networkSecurityConfig',
                                   'allowBackup', 'backupAgent', 'fullBackupContent', 'dataExtractionRules',
                                   'name', 'exported', 'permission', 'authorities', 'scheme')}
    elements, current = [], None
    for line in dump.splitlines():
        line = line.strip()
        if not line or line.startswith(('N: ', 'T: ')):
            continue
        element = re.fullmatch(r'E: ([^ ]+) \(line=\d+\)', line)
        if element:
            current = (element.group(1), {})
            elements.append(current)
            continue
        attribute = re.fullmatch(r'A: ([^\s(=]+)(?:\(0x[0-9a-fA-F]{8}\))?=(.*)', line)
        require(attribute is not None and current is not None, 'Unrecognized compiled XML dump')
        name, value = attribute.groups()
        if name.startswith('http://schemas.android.com/apk/res/android:'):
            name = ANDROID + name.rsplit(':', 1)[1]
        require(name not in current[1], 'Duplicate compiled XML attribute')
        current[1][name] = value
    decoded = list(root.iter())
    require(len(decoded) == len(elements), 'Compiled/decoded XML element count differs')
    for node, (tag, attributes) in zip(decoded, elements):
        require(node.tag == tag, 'Compiled/decoded XML element order differs')
        selected = names.copy()
        if node.tag == 'meta-data' and attr(node, 'name') == 'expo.modules.clipboard.CLIPBOARD_FILE_PROVIDER_PATHS':
            selected.add(ANDROID + 'resource')
        for name in selected & (node.attrib.keys() | attributes.keys()):
            raw, encoded = node.get(name), attributes.get(name)
            require(raw is not None and encoded is not None, 'Compiled/decoded security attribute is missing')
            # AAPT2 does not escape quoted strings. Reject ambiguity before stripping
            # Raw, including a forged second Raw suffix inside the compiled string.
            parsed = re.fullmatch(r'(?:"([^"\r\n]*)"|([^\s"()]+))(?: \(Raw: "[^"\r\n]*"\))?', encoded)
            require(parsed is not None, 'Ambiguous compiled security attribute')
            typed = parsed.group(1) if parsed.group(1) is not None else parsed.group(2)
            require(not any(char in raw or char in typed for char in ('\n', '\r', '"')),
                    'Ambiguous compiled/decoded security attribute')
            if raw == typed:
                continue
            raw_ref = raw.removeprefix('@ref/').removeprefix('@')
            typed_ref = typed.removeprefix('@ref/').removeprefix('@')
            equivalent_reference = (raw.startswith('@') and typed.startswith('@') and raw_ref in table
                                    and typed_ref in table and table[raw_ref] is table[typed_ref])
            equivalent_integer = (name in {ANDROID + key for key in ('versionCode', 'minSdkVersion', 'targetSdkVersion')}
                                  and raw.isdecimal() and re.fullmatch(r'0x[0-9a-fA-F]+', typed)
                                  and int(raw) == int(typed, 16))
            require(equivalent_reference or equivalent_integer,
                    'Compiled/decoded security attribute mismatch: ' + name.removeprefix(ANDROID))


class Inspector:
    def __init__(self, apk, analyzer, aapt2, runner):
        self.apk, self.analyzer, self.aapt2, self.runner = str(apk), analyzer, aapt2, runner
        self.table = resource_table(runner([aapt2, 'dump', 'resources', self.apk]))
        self.evidence = {}
        with zipfile.ZipFile(apk) as archive:
            self.paths = set(archive.namelist())

    def resources(self, reference):
        require(isinstance(reference, str), 'Required XML resource reference is missing')
        key = reference.removeprefix('@ref/').removeprefix('@')
        if key.startswith('0x'):
            key = key.lower()
        require(key in self.table and self.table[key], 'Unresolved XML resource reference')
        paths = set()
        for value in self.table[key]:
            match = re.fullmatch(r'\([^)]*\) \(file\) ([^\s]+) type=XML', value)
            require(match is not None, 'Unsupported XML resource alias or configuration value')
            path = match.group(1)
            require(path in self.paths, 'Referenced XML resource is absent from APK')
            paths.add(path)
        for path in sorted(paths):
            text = self.runner([self.analyzer, 'resources', 'xml', '--file', '/' + path, self.apk])
            self.evidence[path] = hashlib.sha256(text.encode()).hexdigest()
            root = xml(text, path)
            self.check_typed(root, path)
            yield root

    def check_typed(self, root, path):
        dump = self.runner([self.aapt2, 'dump', 'xmltree', '--file', path, self.apk])
        check_typed_xml(root, dump, self.table)


def check_network(application, inspector):
    require(not boolean(attr(application, 'usesCleartextTraffic'), 'usesCleartextTraffic'),
            'Cleartext traffic is enabled in manifest')
    reference = attr(application, 'networkSecurityConfig')
    require(reference is not None, 'Explicit network security config is required')
    for root in inspector.resources(reference):
        require(root.tag == 'network-security-config', 'Invalid network security config root')
        bases = root.findall('base-config')
        # Older Android runtimes do not know modern target-SDK default changes.
        # Require an explicit deny in EVERY variant instead of assuming Android 9+.
        require(len(bases) == 1, 'Explicit cleartext base-config is required')
        base = boolean(bases[0].get('cleartextTrafficPermitted'), 'base-config cleartext')
        require(not base, 'Network base policy permits cleartext')
        pending, domains = list(root.findall('domain-config')), []
        while pending:
            config = pending.pop()
            domains.extend(config.findall('domain'))
            pending.extend(config.findall('domain-config'))
        require(any((node.text or '').strip() == 'localhost' for node in domains),
                'Explicit localhost policy is required to suppress newer runtime defaults')
        # Every nested domain override must be safe; absent values inherit the safe base.
        for node in root.iter():
            if 'cleartextTrafficPermitted' in node.attrib:
                require(not boolean(node.get('cleartextTrafficPermitted'), 'network cleartext'),
                        'Network configuration permits cleartext')


def check_exclusions(section):
    require(all(child.tag == 'exclude' and set(child.attrib) == {'domain', 'path'}
                and not list(child) for child in section), 'Backup rules must contain only explicit exclusions')
    excluded = {child.get('domain') for child in section if child.get('path') in ('.', './')}
    require(DOMAINS <= excluded, 'Backup rules do not exclude every sensitive storage domain')


def check_backup(application, inspector):
    require(not boolean(attr(application, 'allowBackup'), 'allowBackup'), 'Backup must be disabled')
    require(attr(application, 'backupAgent') is None, 'Custom backup agent requires security review')
    # allowBackup=false alone is not enough for some OEM device-to-device transfers.
    for root in inspector.resources(attr(application, 'fullBackupContent')):
        require(root.tag == 'full-backup-content', 'Invalid legacy backup rules')
        check_exclusions(root)
    for root in inspector.resources(attr(application, 'dataExtractionRules')):
        require(root.tag == 'data-extraction-rules', 'Invalid data extraction rules')
        require(sorted(child.tag for child in root) == ['cloud-backup', 'device-transfer'],
                'Both cloud-backup and device-transfer exclusions are required; new transfer modes need review')
        for section in root:
            check_exclusions(section)


def class_name(value, package):
    require(bool(value) and not value.startswith('@'), 'Unresolved component name')
    return package + value if value.startswith('.') else (package + '.' + value if '.' not in value else value)


def intent_filter(element):
    require(not element.attrib, 'Unreviewed exported intent-filter attributes')
    require(all(child.tag in ('action', 'category', 'data') and not list(child) for child in element),
            'Unreviewed exported intent-filter content')
    actions, categories, data = [], [], []
    for child in element:
        if child.tag in ('action', 'category'):
            require(set(child.attrib) == {ANDROID + 'name'}, 'Unresolved intent-filter name')
            (actions if child.tag == 'action' else categories).append(attr(child, 'name'))
        else:
            require(set(child.attrib) == {ANDROID + 'scheme'}, 'Unreviewed exported deep-link data')
            data.append(attr(child, 'scheme'))
    return sorted(actions), sorted(categories), sorted(data)


def check_exports(application, package, target_sdk, inspector, policy):
    allowed = {(entry['type'], entry['name'].replace('${applicationId}', package)): entry
               for entry in policy['exportedComponents']}
    evidence, seen = [], set()
    for component in application:
        if component.tag not in ('activity', 'activity-alias', 'service', 'receiver', 'provider'):
            continue
        name = class_name(attr(component, 'name'), package)
        key = (component.tag, name)
        require(key not in seen, 'Duplicate manifest component')
        seen.add(key)
        filters = component.findall('intent-filter')
        implicit = (target_sdk < 17) if component.tag == 'provider' else bool(filters)
        exported = boolean(attr(component, 'exported'), name + ' exported', implicit)
        if not exported:
            continue
        require(key in allowed, f'Unapproved exported {component.tag}: {name}')
        entry = allowed[key]
        require(bool(entry.get('reason')), 'Export allowlist is missing a justification')
        require(attr(component, 'exported') == 'true', 'Approved export must be explicit')
        if entry['kind'] == 'launcher':
            require(attr(application, 'permission') is None and attr(component, 'permission') is None,
                    'Launcher permissions would change approved launch/deep-link behavior')
            parsed = [intent_filter(item) for item in filters]
            launcher = (['android.intent.action.MAIN'], ['android.intent.category.LAUNCHER'], [])
            require(parsed.count(launcher) == 1, 'Exactly one approved launcher filter is required')
            schemes = {value.replace('${applicationId}', package) for value in entry['schemes']}
            deep_links = []
            for item in parsed:
                if item == launcher:
                    continue
                actions, categories, data = item
                require(actions == ['android.intent.action.VIEW']
                        and categories == ['android.intent.category.BROWSABLE', 'android.intent.category.DEFAULT']
                        and data and set(data) <= schemes, 'Unreviewed exported deep-link filter')
                deep_links.extend(data)
            require('dietdigidose' in deep_links, 'Approved dietdigidose deep link is missing')
        elif entry['kind'] == 'profile-installer':
            require(attr(component, 'permission') == 'android.permission.DUMP',
                    'Profile installer export must retain signature-level DUMP permission')
            parsed = [intent_filter(item) for item in filters]
            require(parsed and all(not cats and not data and actions
                                   and set(actions) <= set(entry['actions']) for actions, cats, data in parsed),
                    'Unreviewed profile installer intent-filter')
        elif entry['kind'] == 'clipboard':
            require(not filters and attr(component, 'authorities') == package + '.ClipboardFileProvider',
                    'Unreviewed clipboard provider surface')
            metadata = [node for node in component.findall('meta-data')
                        if attr(node, 'name') == 'expo.modules.clipboard.CLIPBOARD_FILE_PROVIDER_PATHS']
            require(len(metadata) == 1, 'Clipboard paths metadata must be unambiguous')
            for root in inspector.resources(attr(metadata[0], 'resource')):
                require(root.tag == 'paths' and len(root) == 1 and root[0].tag == 'cache-path'
                        and root[0].attrib == {'name': 'clipboard_files', 'path': '.clipboard/'}
                        and not list(root[0]), 'Clipboard provider may expose only its dedicated cache')
        else:
            raise GateError('Unknown exported component policy')
        evidence.append({'type': component.tag, 'name': name, 'reason': entry['reason']})
    require(any(item['name'] == package + '.MainActivity' for item in evidence), 'Approved launcher is missing')
    return evidence


def check_archive(apk):
    with zipfile.ZipFile(apk) as archive:
        seen, total = set(), 0
        for info in archive.infolist():
            name = info.filename
            require(name not in seen, 'Duplicate APK archive entry')
            seen.add(name)
            require(not name.startswith('/') and '\\' not in name and '..' not in PurePosixPath(name).parts,
                    'Unsafe APK archive entry path')
            require(not info.flag_bits & 1, 'Encrypted APK archive entry cannot be inspected')
            total += info.file_size
            require(info.file_size <= 512 * 1024 * 1024 and total <= 2 * 1024 * 1024 * 1024,
                    'APK inspection size limit exceeded')
            if info.is_dir():
                continue
            lower = name.lower()
            require(not re.search(r'(^|/)\.env($|\.)|\.(jks|keystore|p12|pfx|pk8|key)$|(^|/)(id_rsa|id_ed25519|credentials\.json)$', lower),
                    f'Forbidden credential/environment asset: {name}')
            require(not lower.endswith(('.map', '.sourcemap')), f'Unexpected source map: {name}')
            # Inspect all decompressed bytes, including renamed assets and JS bundles.
            # Markers alone are safe (e.g. crypto libraries); require PEM key material.
            tail = b''
            with archive.open(info) as stream:
                while chunk := stream.read(1024 * 1024):
                    window = (tail + chunk).replace(b'\\n', b'\n').replace(b'\\r', b'\r')
                    require(PRIVATE_KEY.search(window) is None, f'Packaged private key material: {name}')
                    require(b'sourceMappingURL=data:application/json' not in window,
                            f'Unexpected inline source map: {name}')
                    tail = window[-65536:]
        require({'AndroidManifest.xml', 'resources.arsc'} <= seen, 'Not a complete APK archive')
        return len(seen)


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inspect_apk(args, runner=run_tool):
    require(re.fullmatch(r'[0-9a-f]{40}', args.source_sha) is not None, 'Full source commit SHA is required')
    require(re.fullmatch(r'[0-9a-fA-F]{64}', args.certificate_sha256) is not None,
            'Trusted signing certificate SHA-256 is required')
    apk = Path(args.apk)
    before = digest(apk)
    entries = check_archive(apk)
    signature = runner([args.apksigner, 'verify', '--verbose', '--print-certs', str(apk)])
    signers = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$', signature, re.MULTILINE)
    require([value.lower() for value in signers] == [args.certificate_sha256.lower()],
            'APK signer does not match the trusted release certificate')
    manifest_text = runner([args.apkanalyzer, 'manifest', 'print', str(apk)])
    manifest = xml(manifest_text, 'AndroidManifest.xml')
    require(manifest.tag == 'manifest', 'Invalid APK manifest root')
    require(manifest.get('package') == args.application_id and attr(manifest, 'versionCode') == args.version_code
            and attr(manifest, 'versionName') == args.version_name, 'APK package/version differs from release identity')
    applications = manifest.findall('application')
    require(len(applications) == 1, 'APK must have exactly one application')
    application = applications[0]
    require(not manifest.findall('instrumentation'), 'Instrumentation must not ship in release APK')
    for flag in ('debuggable', 'testOnly'):
        require(not boolean(attr(application, flag), flag, False), f'{flag} must not be enabled')
    sdks = manifest.findall('uses-sdk')
    require(len(sdks) == 1, 'SDK policy is missing or ambiguous')
    minimum, target = attr(sdks[0], 'minSdkVersion', ''), attr(sdks[0], 'targetSdkVersion', '')
    require(minimum.isdecimal() and target.isdecimal() and int(minimum) >= 24 and int(target) >= 28,
            'Unsupported or unresolved SDK policy requires review')
    inspector = Inspector(apk, args.apkanalyzer, args.aapt2, runner)
    inspector.check_typed(manifest, 'AndroidManifest.xml')
    check_network(application, inspector)
    check_backup(application, inspector)
    policy = json.loads((ROOT / 'scripts/apk-security-policy.json').read_text())
    exports = check_exports(application, args.application_id, int(target), inspector, policy)
    require(digest(apk) == before, 'APK changed while being inspected')
    return {
        'schemaVersion': 1, 'status': 'passed', 'sourceCommit': args.source_sha,
        'apkSha256': before, 'sizeBytes': apk.stat().st_size,
        'applicationId': args.application_id, 'versionCode': args.version_code, 'versionName': args.version_name,
        'signerCertificateSha256': args.certificate_sha256.lower(),
        'policySha256': digest(ROOT / 'scripts/apk-security-policy.json'),
        'manifestSha256': hashlib.sha256(manifest_text.encode()).hexdigest(),
        'decodedResourcesSha256': inspector.evidence, 'archiveEntriesInspected': entries,
        'exportedComponents': exports,
        'checks': ['signature', 'identity', 'release-flags', 'cleartext-policy', 'backup-exclusions',
                   'exported-components', 'packaged-secret-and-source-map-patterns'],
        'limitations': 'Static artifact gate only; ordinary-device TLS, backup/restore and same-signature upgrade tests remain required.',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('apk', 'report', 'source-sha', 'application-id', 'version-code', 'version-name', 'certificate-sha256'):
        parser.add_argument('--' + name, required=True)
    for name in ('apkanalyzer', 'aapt2', 'apksigner'):
        parser.add_argument('--' + name, default=name)
    args = parser.parse_args(argv)
    report = Path(args.report)
    require(report.resolve() != Path(args.apk).resolve(), 'Report must not overwrite APK')
    # A failed re-run must not leave a stale passing attestation behind.
    report.unlink(missing_ok=True)
    try:
        result = inspect_apk(args)
    except (GateError, OSError, zipfile.BadZipFile, RuntimeError) as error:
        result = {'schemaVersion': 1, 'status': 'failed', 'error': str(error)}
        report.write_text(json.dumps(result, indent=2) + '\n')
        print('APK security gate failed: ' + str(error), file=sys.stderr)
        return 1
    report.write_text(json.dumps(result, indent=2) + '\n')
    print(f"APK security gate passed: {result['apkSha256']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

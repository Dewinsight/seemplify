#!/usr/bin/env python3
"""Bound derived deployment storage without touching containers or volumes."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

APP_REPOSITORIES = {"recruiter-backend", "recruiter-frontend", "candidate-portal", "identity-provider", "leave-backend", "leave-frontend", "performance-backend", "performance-frontend", "payroll-backend", "payroll-frontend", "time-backend", "time-frontend", "ai-interview-backend", "ai-interview-frontend", "marketing", "knowledge-runtime", "approver", "chatgpt-gateway", "mail-api", "mail-relay", "turn-api"}
RELEASES = Path('/opt/seemplify/releases')
ARCHIVES = Path('/var/backups/seemplify/release-source-archives')
GATEWAY_ARCHIVES = Path('/var/backups/seemplify/chatgpt-gateway-deployments')

def prune_archives(root, pattern, apply=False):
    """Keep one complete archive per category, regardless of free disk space."""
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Unsafe deployment archive directory')
    files = [p for p in root.iterdir() if re.fullmatch(pattern, p.name)
             and not p.is_symlink() and p.is_file()]
    files.sort(key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
    if len(files) < 2:
        return []
    # Fully read the retained tar before unlinking any predecessor. Incomplete
    # .partial writes cannot become candidates and corrupt replacements fail shut.
    subprocess.run(['tar', '-tzf', str(files[0])], stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, check=True)
    removed = []
    for older in files[1:]:
        if older.resolve().parent != root.resolve() or older.is_symlink():
            raise ValueError('Archive path changed during retention')
        if apply:
            older.unlink()
        removed.append(older.name)
    return removed

def command(args):
    return subprocess.check_output(args, text=True)

def select_images(images, used, keep=3):
    protected = set(used)
    groups = {}
    for image in images:
        for tag in image.get('RepoTags') or []:
            groups.setdefault(tag.split(':')[0], {})[image['Id']] = image
    for group in groups.values():
        protected.update(image['Id'] for image in sorted(group.values(), key=lambda row: row['Created'], reverse=True)[:keep])
    selected = []
    for image in images:
        tags = image.get('RepoTags') or []
        if not tags or image['Id'] in protected:
            continue
        matches = [re.fullmatch(r'seemplify/([^:]+):hostinger-[a-f0-9]{7,40}', tag) for tag in tags]
        if all(match and match[1] in APP_REPOSITORIES for match in matches):
            selected.append(image)
    return selected

def eligible_release(folder, protected, references, newest, now):
    if folder.is_symlink() or not folder.is_dir() or folder.resolve().parent != RELEASES.resolve():
        return False
    if not re.fullmatch(r'[a-f0-9]{40}', folder.name) or folder.name in newest or now - folder.stat().st_mtime < 86400:
        return False
    if any(revision.startswith(folder.name) or folder.name.startswith(revision) for revision in protected if revision):
        return False
    if not ((folder/'recruiter').is_dir() or (folder/'Identityprovider').is_dir()):
        return False
    if any((folder/name).exists() for name in ['lms', 'milo', 'workspace', 'experienments2']):
        return False
    target = folder.resolve()
    return not any(Path(os.path.abspath(str(ref))).is_relative_to(target) for ref in references)

def current_references(containers):
    refs = [mount['Source'] for row in containers for mount in row.get('Mounts', []) if mount.get('Source')]
    for process in Path('/proc').glob('[0-9]*'):
        try:
            refs.append(str((process/'cwd').resolve()))
            text = (process/'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            refs.extend(re.findall(r'/opt/seemplify/releases/[a-f0-9]{40}(?:/[^ \x00]*)?', text))
        except OSError:
            pass
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        parts = line.split()
        if len(parts) > 4:
            refs.append(parts[4])
    return refs

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--min-free-gib', type=int, default=35)
    parser.add_argument('--archive-limit', type=int, default=10)
    args = parser.parse_args()
    if not 25 <= args.min_free_gib <= 60 or not 1 <= args.archive_limit <= 200:
        raise ValueError('Storage limits are outside the supported range.')
    import fcntl
    lock = os.open('/run/lock/seemplify-production-deploy.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(json.dumps({'skipped': 'production deployment is active'}))
        return
    before = shutil.disk_usage('/').free
    retired = {
        'source': prune_archives(ARCHIVES, r'[a-f0-9]{40}\.tar\.gz', args.apply),
        'gateway': prune_archives(GATEWAY_ARCHIVES, r'predeploy-[a-f0-9]{40}\.tar\.gz', args.apply),
    }
    if shutil.disk_usage('/').free >= args.min_free_gib * 1024**3:
        print(json.dumps({'sufficientHeadroom': True, 'retiredArchives': retired,
                          'freeGiB': round(shutil.disk_usage('/').free/1024**3, 2)}))
        return
    ids = list(dict.fromkeys(command(['docker','image','ls','-q','--no-trunc']).splitlines()))
    images = json.loads(command(['docker','image','inspect'] + ids))
    container_ids = command(['docker','ps','-aq']).splitlines()
    containers = json.loads(command(['docker','inspect'] + container_ids)) if container_ids else []
    selected = select_images(images, {row['Image'] for row in containers})
    report = {'unusedImageTags': [tag for row in selected for tag in row['RepoTags']], 'archivedReleases': [], 'retiredArchives': retired, 'containersRemoved': 0, 'volumesRemoved': 0, 'applied': args.apply}
    if args.apply:
        for image in selected:
            # The lock excludes every canonical Seemplify deployment. Docker
            # also refuses deletion if an independent container takes the image.
            subprocess.run(['docker','image','rm'] + image['RepoTags'], check=True, capture_output=True)
    protected = {(row['Config'].get('Labels') or {}).get('org.opencontainers.image.revision', '') for row in containers}
    refs = current_references(containers)
    folders = list(RELEASES.iterdir())
    newest = {path.name for path in sorted(folders, key=lambda item: item.stat().st_mtime, reverse=True)[:5]}
    for folder in sorted(folders, key=lambda item: item.stat().st_mtime):
        if len(report['archivedReleases']) >= args.archive_limit or shutil.disk_usage('/').free >= args.min_free_gib * 1024**3:
            break
        if not eligible_release(folder, protected, refs, newest, time.time()):
            continue
        report['archivedReleases'].append(folder.name)
        if not args.apply:
            continue
        ARCHIVES.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = ARCHIVES/(folder.name + '.tar.gz')
        temporary = ARCHIVES/(folder.name + '.partial.tar.gz')
        if not target.exists():
            with temporary.open('wb') as out:
                subprocess.run(['tar','--acls','--xattrs','--numeric-owner','-I','gzip -1','-C',str(RELEASES),'-cf','-',folder.name], stdout=out, stderr=subprocess.PIPE, check=True)
            temporary.chmod(0o600)
            os.replace(temporary, target)
        # Compare every archived file against the original before removing
        # this inactive source copy. Retention bounds these derived copies.
        subprocess.run(['tar','--compare','-zf',str(target),'-C',str(RELEASES)], check=True, capture_output=True)
        assert eligible_release(folder, protected, current_references(containers), newest, time.time())
        assert folder.resolve().parent == RELEASES.resolve() and not folder.is_symlink()
        shutil.rmtree(folder)
    if args.apply:
        report['retiredArchives']['source'] += prune_archives(ARCHIVES, r'[a-f0-9]{40}\.tar\.gz', True)
    report['freeGiB'] = round(shutil.disk_usage('/').free/1024**3, 2)
    report['freedGiB'] = round((shutil.disk_usage('/').free-before)/1024**3, 2)
    print(json.dumps(report))

if __name__ == '__main__':
    main()

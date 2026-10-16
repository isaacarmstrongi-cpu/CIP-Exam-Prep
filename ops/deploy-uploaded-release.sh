#!/usr/bin/env bash
set -euo pipefail
umask 022
archive=${1:?Pass the uploaded archive path}
revision=${2:?Pass the full Git revision}
checksum=${3:?Pass the SHA256 from the local release manifest}
[[ $revision =~ ^[a-f0-9]{40}$ && $checksum =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid release identity.' >&2; exit 1; }
[[ -f $archive && ! -L $archive ]] || { echo 'Archive must be a regular file.' >&2; exit 1; }
[[ $(sha256sum -- "$archive" | cut -d ' ' -f 1) == "$checksum" ]] || { echo 'Archive checksum does not match.' >&2; exit 1; }
export PATH=/opt/procip-node-v24.15.0/bin:$PATH
node --env-file=/etc/procip/procip.env -e "if(process.env.ENROLLMENT_OPEN!=='false')throw Error('Close enrollment before this maintenance deployment.');"
python3 - "$archive" <<'PY'
import sys,tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1],'r:gz') as archive:
    for member in archive.getmembers():
        path=PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe archive member; release refused.')
        if path.parts and (path.parts[0] in ['private','node_modules','.git'] or path.parts[0].startswith('.env')):
            raise SystemExit('Private runtime content must not be packaged.')
PY
release=/opt/procip-app/releases/$revision
[[ ! -e $release && -L /opt/procip-app/current ]] || { echo 'Release exists or current service is not configured.' >&2; exit 1; }
previous=$(readlink -f /opt/procip-app/current)
[[ $previous == /opt/procip-app/releases/* ]] || { echo 'Unexpected current release path.' >&2; exit 1; }
mkdir -m 755 "$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
cd "$release"
npm ci --omit=dev --ignore-scripts --no-fund --no-audit
npm test
DATABASE_PATH=/var/lib/procip/students.sqlite BACKUP_DIRECTORY=/var/backups/procip node paid/backup.mjs
DATABASE_PATH=/var/lib/procip-sandbox/students.sqlite BACKUP_DIRECTORY=/var/backups/procip-sandbox node paid/backup.mjs
rollback() {
    trap - ERR
    ln -sfn "$previous" /opt/procip-app/current
    systemctl restart procip procip-sandbox
    echo 'New service check failed. Previous code restored; additive database tables retained.' >&2
}
trap rollback ERR
ln -s "$release" "/opt/procip-app/.current-$revision"
mv -Tf "/opt/procip-app/.current-$revision" /opt/procip-app/current
systemctl restart procip procip-sandbox
origin=$(node --env-file=/etc/procip/procip.env -p 'process.env.PUBLIC_ORIGIN')
curl --retry 4 --retry-connrefused --retry-delay 1 --fail --silent "$origin/mcip/api/session" |
    node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=JSON.parse(s);if(a.enrollment!==false||a.registrationOpen!==false)process.exit(1);});"
install -m 644 public-site/styles.css /var/www/html/mcip/styles.css
install -m 644 public-site/app.mjs /var/www/html/mcip/app.mjs
install -d -m 755 /var/www/html/mcip/assets
install -m 644 public-site/assets/learning-journey.jpg /var/www/html/mcip/assets/learning-journey.jpg
install -m 644 public-site/index.html /var/www/html/mcip/index.html
trap - ERR
echo "Verified release $revision deployed; enrollment remains closed."
echo 'Existing Stripe/email credentials and prior releases were preserved.'

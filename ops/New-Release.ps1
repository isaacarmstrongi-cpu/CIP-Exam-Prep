param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../private/releases'))
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
Push-Location $repository
try {
    git diff --quiet HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Commit the reviewed changes before packaging a release.' }
    $untracked = @(git ls-files --others --exclude-standard)
    if ($untracked.Count) { throw 'Review untracked files before packaging a release.' }
    $revision = (git rev-parse HEAD).Trim()
    if ($revision -notmatch '^[a-f0-9]{40}$') { throw 'Could not determine the release revision.' }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $archive = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) "procip-$revision.tar.gz"
    if (Test-Path -LiteralPath $archive) { throw 'This release archive already exists; keep the original or choose a different output directory.' }
    git archive --format=tar.gz --output=$archive HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed.' }
    node -e 'const {execFileSync}=require("node:child_process");const shell=execFileSync("tar",["-xOf",process.argv[1],"ops/deploy-uploaded-release.sh"]);if(shell.includes(13))throw Error("Deployment script must use LF line endings in the archive.");' $archive
    if ($LASTEXITCODE -ne 0) { throw 'Release archive contains incompatible shell line endings.' }
    $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [ordered]@{revision=$revision;sha256=$checksum;archive=[System.IO.Path]::GetFileName($archive)} |
        ConvertTo-Json | Set-Content -LiteralPath "$archive.json" -Encoding utf8
    Write-Output "Release archive: $archive"
    Write-Output "Revision: $revision"
    Write-Output "SHA256: $checksum"
    Write-Output 'Upload this private archive using your existing SSH account. No GitHub credential is needed on the VPS.'
} finally { Pop-Location }

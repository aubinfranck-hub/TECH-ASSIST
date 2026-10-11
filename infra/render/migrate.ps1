# Lance infra/render/consolidate-into-ntic.sh dans Docker (image postgres:18) depuis
# Windows PowerShell. Les URL sont demandees au clavier (saisie masquee) et passees au
# conteneur par variables d'environnement : rien n'est ecrit sur le disque.
# (Fichier volontairement sans accents : Windows PowerShell 5.1 lit mal l'UTF-8 sans BOM.)
#
# Depuis la racine du depot, dans une fenetre PowerShell normale (pas l'ISE) :
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\infra\render\migrate.ps1 -Check juriscoach
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\infra\render\migrate.ps1 juriscoach
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\infra\render\migrate.ps1 skindiag etravail foncier360
#
# -Check ne modifie rien. Runbook : docs/consolidation-bases-render.md
param(
  [switch]$Check,
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$Projects
)
$ErrorActionPreference = 'Stop'

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Assert-ExternalUrl([string]$Value, [string]$What) {
  if ($Value -notmatch '^postgres(ql)?://') {
    throw "$What : l'URL doit commencer par postgresql:// (copie l'URL 'External' dans Connect)."
  }
  if ($Value -match '@[^./@]+/') {
    throw "$What : c'est l'URL 'Internal' (utilisable seulement dans Render). Copie l'URL 'External'."
  }
}

if (-not (Test-Path 'infra/render/consolidate-into-ntic.sh')) {
  throw "Lance ce script depuis la racine du depot TECH-ASSIST (le dossier qui contient 'infra')."
}
foreach ($p in $Projects) {
  if ($p -notmatch '^[a-z][a-z0-9_]*$') {
    throw "Nom de projet invalide : '$p' (minuscules, chiffres et _ seulement)."
  }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker introuvable : installe et lance Docker Desktop."
}
$ErrorActionPreference = 'Continue'
docker info *> $null
$dockerOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $dockerOk) {
  throw "Docker ne repond pas : demarre Docker Desktop, attends qu'il soit pret, puis relance."
}

$names = @('NTIC_ADMIN_URL')
try {
  Write-Host "Colle chaque URL 'External' (Render > la base > Connect > External)."
  Write-Host "La saisie est masquee et rien n'est ecrit sur le disque."
  $url = Read-Secret "URL External de ntic-shared-db"
  Assert-ExternalUrl $url 'ntic-shared-db'
  Set-Item -Path 'Env:NTIC_ADMIN_URL' -Value $url

  $dockerArgs = @('run', '--rm', '-e', 'NTIC_ADMIN_URL')
  foreach ($p in $Projects) {
    $name = "SRC_$($p.ToUpperInvariant())_URL"
    $url = Read-Secret "URL External de la base source '$p'"
    Assert-ExternalUrl $url $p
    Set-Item -Path "Env:$name" -Value $url
    $names += $name
    $dockerArgs += @('-e', $name)
  }
  $dockerArgs += @('-v', "$((Get-Location).Path):/work", '-w', '/work', 'postgres:18',
                   'bash', 'infra/render/consolidate-into-ntic.sh')
  if ($Check) { $dockerArgs += '--check' }
  $dockerArgs += $Projects

  $ErrorActionPreference = 'Continue'
  & docker @dockerArgs
  $code = $LASTEXITCODE
}
finally {
  foreach ($n in $names) { Remove-Item -Path "Env:$n" -ErrorAction SilentlyContinue }
}
exit $code
